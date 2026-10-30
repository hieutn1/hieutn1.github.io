/*
 * Live cells: turn the rendered Python cells of a Quarto page into cells that
 * can be edited and run again.
 *
 * Two kinds of Python can sit behind the cells, and both look the same to the
 * rest of this file (start, execute, interrupt, restart, shutdown):
 *
 *   BrowserPython  Pyodide, a build of CPython for WebAssembly, running in a Web
 *                  Worker inside the page. Nothing to install. NumPy, SciPy and
 *                  Matplotlib are downloaded the first time and cached by the browser.
 *   KernelClient   a real Jupyter kernel, on the reader's computer (start_kernel.py)
 *                  or on a course server, spoken to with the standard Jupyter protocol.
 *
 * Outputs from both are Jupyter messages (stream, execute_result, display_data,
 * error), so a single renderer draws them.
 */
(function () {
  "use strict";

  const CONFIG = Object.assign(
    { server: "http://127.0.0.1:8888", kernelName: "python3", pyodide: "", packages: [] },
    window.LIVECELLS_CONFIG || {},
    window.LIVECELLS_OVERRIDE || {}       // for testing against a local copy of Pyodide
  );

  // ------------------------------------------------------------------ utils
  const store = {
    get(key) { try { return window.localStorage.getItem("livecells:" + key); } catch (e) { return null; } },
    set(key, value) { try { window.localStorage.setItem("livecells:" + key, value); } catch (e) { /* storage blocked */ } },
    del(key) { try { window.localStorage.removeItem("livecells:" + key); } catch (e) { /* storage blocked */ } },
  };

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(16) + Math.random().toString(16).slice(2);
  }

  function stripAnsi(s) {
    return String(s).replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
  }

  // Apply carriage returns the way a terminal would (progress bars and the like).
  function applyCarriageReturns(s) {
    return s.split("\n").map(line => {
      const parts = line.split("\r");
      return parts[parts.length - 1] === "" && parts.length > 1 ? parts[parts.length - 2] : parts[parts.length - 1];
    }).join("\n");
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    (children || []).forEach(c => node.appendChild(c));
    return node;
  }

  const nextFrame = () => new Promise(resolve => setTimeout(resolve, 0));

  // ---------------------------------------------------- Jupyter kernel client
  class KernelClient {
    constructor(baseUrl, token) {
      this.kind = "kernel";
      this.base = baseUrl.replace(/\/+$/, "");
      this.token = token || "";
      this.session = uuid();
      this.pending = new Map();
      this.kernelId = null;
      this.ws = null;
      this.chain = Promise.resolve();
      this.onStatus = () => {};
      this.onClose = () => {};
    }

    async api(path, method, body) {
      const headers = { "Content-Type": "application/json" };
      if (this.token) headers["Authorization"] = "token " + this.token;
      const response = await fetch(this.base + path, {
        method: method || "GET",
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        const hint = response.status === 403 ? " (is the token right?)" : "";
        throw new Error(`${method || "GET"} ${path} returned ${response.status}${hint}`);
      }
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    }

    async start() {
      const kernel = await this.api("/api/kernels", "POST", { name: CONFIG.kernelName });
      this.kernelId = kernel.id;
      await this.openSocket();
    }

    openSocket() {
      return new Promise((resolve, reject) => {
        const wsBase = this.base.replace(/^http/, "ws");
        const url = `${wsBase}/api/kernels/${this.kernelId}/channels?session_id=${this.session}` +
          (this.token ? `&token=${encodeURIComponent(this.token)}` : "");
        const ws = new WebSocket(url);
        let opened = false;
        this.ws = ws;
        ws.onopen = () => { opened = true; resolve(); };
        ws.onerror = () => { if (!opened) reject(new Error("the kernel connection was refused")); };
        ws.onclose = () => {
          this.failPending("The connection to the kernel closed.");
          this.onClose();
        };
        ws.onmessage = event => {
          if (typeof event.data === "string") this.handle(JSON.parse(event.data));
        };
      });
    }

    handle(msg) {
      const type = msg.header && msg.header.msg_type;
      if (msg.channel === "iopub" && type === "status") this.onStatus(msg.content.execution_state);
      const parent = msg.parent_header && msg.parent_header.msg_id;
      const job = parent && this.pending.get(parent);
      if (!job || msg.channel !== "iopub") return;
      if (type === "status") {
        if (msg.content.execution_state === "idle") {
          this.pending.delete(parent);
          job.resolve();
        }
      } else {
        job.onOutput(msg);
      }
    }

    failPending(reason) {
      this.pending.forEach(job => job.reject(new Error(reason)));
      this.pending.clear();
    }

    // Requests are queued so cells always run one after another, in order.
    execute(code, onOutput) {
      const run = () => new Promise((resolve, reject) => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          reject(new Error("Not connected to a kernel."));
          return;
        }
        const msgId = uuid();
        this.pending.set(msgId, { resolve, reject, onOutput });
        this.ws.send(JSON.stringify({
          header: {
            msg_id: msgId, username: "livecells", session: this.session,
            msg_type: "execute_request", version: "5.3", date: new Date().toISOString(),
          },
          parent_header: {},
          metadata: {},
          content: {
            code, silent: false, store_history: true, user_expressions: {},
            allow_stdin: false, stop_on_error: true,
          },
          channel: "shell",
          buffers: [],
        }));
      });
      const result = this.chain.then(run, run);
      this.chain = result.catch(() => {});
      return result;
    }

    interrupt() { return this.api(`/api/kernels/${this.kernelId}/interrupt`, "POST"); }

    async restart() {
      this.failPending("The kernel was restarted.");
      await this.api(`/api/kernels/${this.kernelId}/restart`, "POST");
    }

    shutdown(keepalive) {
      if (!this.kernelId) return;
      const headers = this.token ? { "Authorization": "token " + this.token } : {};
      try { if (this.ws) this.ws.onclose = null; this.ws && this.ws.close(); } catch (e) { /* already closed */ }
      return fetch(`${this.base}/api/kernels/${this.kernelId}`, { method: "DELETE", headers, keepalive: !!keepalive })
        .catch(() => {});
    }
  }

  // ------------------------------------------------------ Python in the browser
  // Runs inside a module Web Worker. It must not use anything from the enclosing scope,
  // because it is turned into source text and started from a Blob.
  function workerMain() {
    let py = null;
    let current = null;
    const post = message => self.postMessage(message);
    const emit = (msgType, content) => post({ type: "output", id: current, msgType, content });
    const writer = name => {
      const decoder = new TextDecoder();
      return {
        isatty: true,            // so Python flushes every line instead of buffering a whole cell
        write(buffer) {
          const text = decoder.decode(buffer, { stream: true });
          if (text) emit("stream", { name, text });
          return buffer.length;
        },
      };
    };

    self.onmessage = async event => {
      const m = event.data;
      if (m.type === "init") {
        try {
          const { loadPyodide } = await import(m.indexURL + "pyodide.mjs");
          py = await loadPyodide({ indexURL: m.indexURL, packages: m.packages, env: { MPLBACKEND: "agg" } });
          py.setStdout(writer("stdout"));
          py.setStderr(writer("stderr"));
          py.globals.set("_lc_emit_js", (msgType, json) => emit(msgType, JSON.parse(json)));
          await py.runPythonAsync(m.setup);
          post({ type: "ready" });
        } catch (err) {
          post({ type: "failed", error: String((err && err.message) || err) });
        }
      } else if (m.type === "run") {
        current = m.id;
        try {
          // Fetch any other Pyodide package the cell imports, such as scipy or scikit-image.
          await py.loadPackagesFromImports(m.code, {
            messageCallback: text => { if (/^Loading /.test(text)) post({ type: "progress", text }); },
            errorCallback: text => post({ type: "progress", text }),
          });
          const run = py.globals.get("_lc_run");
          try { await run(m.code); } finally { run.destroy(); }
        } catch (err) {
          const text = String((err && err.message) || err);
          emit("error", { ename: "Error", evalue: text, traceback: [text] });
        }
        post({ type: "done", id: m.id });
      }
    };
  }

  // Python side of the browser runtime: display figures and results the way Jupyter does,
  // and keep tracebacks short. Names start with _lc_ to stay out of the reader's way.
  const PY_SETUP = String.raw`
import sys, io, json, base64, traceback, linecache, warnings
import matplotlib
matplotlib.use("agg")
warnings.filterwarnings("ignore", category=matplotlib.MatplotlibDeprecationWarning)
import matplotlib.pyplot as plt
from pyodide.code import eval_code_async

plt.rcParams["figure.figsize"] = (7, 5)      # the size Quarto uses for the figures in the built pages
plt.rcParams["figure.dpi"] = 96

_lc_count = 0

def _lc_emit(kind, content):
    sys.stdout.flush()
    sys.stderr.flush()
    _lc_emit_js(kind, json.dumps(content))

def _lc_flush_figures():
    for num in plt.get_fignums():
        fig = plt.figure(num)
        buffer = io.BytesIO()
        fig.savefig(buffer, format="png", bbox_inches="tight", dpi=2 * fig.dpi)   # sharp on high-density screens
        png = buffer.getvalue()
        width = int.from_bytes(png[16:20], "big") // 2                           # shown at half its pixel width
        _lc_emit("display_data", {"data": {"image/png": base64.b64encode(png).decode("ascii"), "text/plain": repr(fig)},
                                  "metadata": {"image/png": {"width": width}}})
    plt.close("all")

def _lc_show(*args, **kwargs):
    _lc_flush_figures()

plt.show = _lc_show

def _lc_traceback(err):
    if isinstance(err, SyntaxError) and str(err.filename or "").startswith("<cell"):
        return "".join(traceback.format_exception_only(type(err), err)).rstrip()
    tb = err.__traceback__
    while tb is not None and not tb.tb_frame.f_code.co_filename.startswith("<cell"):
        tb = tb.tb_next
    if tb is None:
        lines = traceback.format_exception_only(type(err), err)
    else:
        lines = traceback.format_exception(type(err), err, tb)
    return "".join(lines).rstrip()

async def _lc_run(code):
    global _lc_count
    _lc_count += 1
    name = f"<cell {_lc_count}>"
    linecache.cache[name] = (len(code), None, code.splitlines(True), name)
    try:
        result = await eval_code_async(code, globals(), filename=name)
    except BaseException as err:
        _lc_emit("error", {"ename": type(err).__name__, "evalue": str(err), "traceback": [_lc_traceback(err)]})
        _lc_flush_figures()
        return False
    if result is not None:
        globals()["_"] = result
        _lc_emit("execute_result", {"data": {"text/plain": repr(result)}, "metadata": {}})
    _lc_flush_figures()
    sys.stdout.flush()
    sys.stderr.flush()
    return True
`;

  class BrowserPython {
    constructor(indexURL, packages) {
      this.kind = "browser";
      this.indexURL = indexURL.replace(/\/*$/, "/");
      this.packages = packages || [];
      this.worker = null;
      this.pending = new Map();
      this.chain = Promise.resolve();
      this.onStatus = () => {};
      this.onClose = () => {};
      this.onProgress = () => {};
    }

    start() {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(new Blob(["(" + workerMain.toString() + ")()"], { type: "text/javascript" }));
        const worker = new Worker(url, { type: "module" });    // Pyodide only runs in module workers
        this.worker = worker;
        let ready = false;
        this.onStatus("starting");
        worker.onmessage = event => {
          const m = event.data;
          if (m.type === "ready") {
            ready = true;
            URL.revokeObjectURL(url);
            this.onStatus("idle");
            resolve();
          } else if (m.type === "failed") {
            URL.revokeObjectURL(url);
            this.stopWorker();
            reject(new Error(m.error));
          } else if (m.type === "progress") {
            this.onProgress(m.text);
          } else if (m.type === "output") {
            const job = this.pending.get(m.id);
            if (job) job.onOutput({ header: { msg_type: m.msgType }, content: m.content });
          } else if (m.type === "done") {
            const job = this.pending.get(m.id);
            if (job) { this.pending.delete(m.id); job.resolve(); }
            if (!this.pending.size) this.onStatus("idle");
          }
        };
        worker.onerror = event => {
          if (event.preventDefault) event.preventDefault();
          const reason = event.message || "Python stopped unexpectedly.";
          this.failPending(reason);
          if (!ready) { this.stopWorker(); reject(new Error(reason)); }
        };
        worker.postMessage({ type: "init", indexURL: this.indexURL, packages: this.packages, setup: PY_SETUP });
      });
    }

    execute(code, onOutput) {
      const run = () => new Promise((resolve, reject) => {
        if (!this.worker) { reject(new Error("Python is not running.")); return; }
        const id = uuid();
        this.pending.set(id, { resolve, reject, onOutput });
        this.onStatus("busy");
        this.worker.postMessage({ type: "run", id, code });
      });
      const result = this.chain.then(run, run);
      this.chain = result.catch(() => {});
      return result;
    }

    failPending(reason) {
      this.pending.forEach(job => job.reject(new Error(reason)));
      this.pending.clear();
    }

    stopWorker() {
      if (this.worker) this.worker.terminate();
      this.worker = null;
    }

    // A worker cannot be interrupted in the middle of a computation without
    // SharedArrayBuffer, which needs headers that static hosts do not send.
    // Stopping therefore means starting a fresh Python.
    interrupt() { return this.restart(); }

    async restart() {
      this.failPending("Python was restarted.");
      this.stopWorker();
      this.onStatus("restarting");
      await this.start();
    }

    shutdown() {
      this.failPending("Python was shut down.");
      this.stopWorker();
    }
  }

  // ---------------------------------------------------------------- outputs
  function renderMessage(area, msg) {
    const type = msg.header.msg_type;
    const content = msg.content;
    if (type === "stream") {
      appendStream(area, content.name, content.text);
    } else if (type === "execute_result" || type === "display_data") {
      area._stream = null;
      appendMime(area, content.data || {}, content.metadata || {});
    } else if (type === "error") {
      area._stream = null;
      const text = stripAnsi((content.traceback || []).join("\n")) || `${content.ename}: ${content.evalue}`;
      area.appendChild(el("div", { class: "cell-output cell-output-error" }, [
        el("pre", {}, [el("code", { text })]),
      ]));
    } else if (type === "clear_output") {
      area.innerHTML = "";
      area._stream = null;
    }
  }

  function appendStream(area, name, text) {
    const last = area._stream;
    if (last && last.name === name) {
      last.raw += text;
      last.code.textContent = applyCarriageReturns(stripAnsi(last.raw));
      return;
    }
    const code = el("code", { text: applyCarriageReturns(stripAnsi(text)) });
    const kind = name === "stderr" ? "cell-output-stderr" : "cell-output-stdout";
    area.appendChild(el("div", { class: "cell-output " + kind }, [el("pre", {}, [code])]));
    area._stream = { name, raw: text, code };
  }

  function appendMime(area, data, metadata) {
    const box = el("div", { class: "cell-output cell-output-display" });
    const image = type => {
      const img = el("img", { src: `data:${type};base64,` + data[type], alt: "output image" });
      const width = metadata[type] && metadata[type].width;
      if (width) img.setAttribute("width", width);           // retina figures carry their display width
      return img;
    };
    if (data["image/png"]) {
      box.appendChild(image("image/png"));
    } else if (data["image/jpeg"]) {
      box.appendChild(image("image/jpeg"));
    } else if (data["image/svg+xml"]) {
      box.innerHTML = data["image/svg+xml"];
    } else if (data["text/html"]) {
      box.innerHTML = data["text/html"];
    } else if (data["text/plain"] !== undefined) {
      box.appendChild(el("pre", {}, [el("code", { text: stripAnsi(data["text/plain"]) })]));
    } else {
      return;
    }
    area.appendChild(box);
  }

  // ------------------------------------------------------------------ cells
  const cells = [];
  let client = null;        // the Python behind the cells, of either kind
  let starting = null;      // a promise while Python is being started

  function findCells() {
    document.querySelectorAll("main div.cell").forEach(cellEl => {
      if (cellEl.classList.contains("no-live")) return;
      const source = cellEl.querySelector("div.sourceCode.cell-code");
      const code = source && source.querySelector("code.python, code.sourceCode.python");
      if (!code) return;
      cells.push(makeCell(cellEl, source, code));
    });
  }

  function makeCell(cellEl, source, code) {
    const cell = { el: cellEl, source, code, original: code.textContent, editor: null, output: null, cleared: false };
    cell.runButton = el("button", { class: "lc-btn lc-run", type: "button", title: "Run this cell (Shift+Enter in the editor)", text: "Run", onclick: () => runCell(cell) });
    cell.runAllButton = el("button", { class: "lc-btn", type: "button", title: "Run every cell from the top of the page down to this one", text: "Run from top", onclick: () => runThrough(cell) });
    cell.editButton = el("button", { class: "lc-btn", type: "button", text: "Edit", onclick: () => edit(cell) });
    cell.resetButton = el("button", { class: "lc-btn", type: "button", text: "Reset", hidden: "", onclick: () => reset(cell) });
    cell.state = el("span", { class: "lc-state" });
    cell.toolbar = el("div", { class: "lc-toolbar" }, [cell.runButton, cell.runAllButton, cell.editButton, cell.resetButton, cell.state]);
    source.parentNode.insertBefore(cell.toolbar, source);
    return cell;
  }

  function currentCode(cell) {
    return cell.editor ? cell.editor.value : cell.original;
  }

  function edit(cell) {
    if (cell.editor) { cell.editor.focus(); return; }
    const editor = el("textarea", { class: "lc-editor", spellcheck: "false", autocapitalize: "off", autocomplete: "off", "aria-label": "Edit the code of this cell" });
    editor.value = cell.original;
    const fit = () => { editor.style.height = "auto"; editor.style.height = editor.scrollHeight + 2 + "px"; };
    editor.addEventListener("input", fit);
    editor.addEventListener("keydown", event => {
      if (event.key === "Enter" && event.shiftKey) { event.preventDefault(); runCell(cell); }
      if (event.key === "Tab") {
        event.preventDefault();
        const s = editor.selectionStart, e = editor.selectionEnd;
        editor.value = editor.value.slice(0, s) + "    " + editor.value.slice(e);
        editor.selectionStart = editor.selectionEnd = s + 4;
        fit();
      }
    });
    cell.source.hidden = true;
    cell.source.parentNode.insertBefore(editor, cell.source.nextSibling);
    cell.editor = editor;
    cell.editButton.hidden = true;
    cell.resetButton.hidden = false;
    fit();
    editor.focus();
  }

  function reset(cell) {
    if (cell.editor) cell.editor.remove();
    cell.editor = null;
    cell.source.hidden = false;
    cell.editButton.hidden = false;
    cell.resetButton.hidden = true;
  }

  function outputArea(cell) {
    if (!cell.cleared) {
      // Remove the outputs that were baked in when the page was rendered.
      Array.from(cell.el.children)
        .filter(child => Array.from(child.classList).some(c => c.startsWith("cell-output")))
        .forEach(child => child.remove());
      cell.cleared = true;
    }
    if (!cell.output) {
      cell.output = el("div", { class: "lc-output" });
      const anchor = cell.el.querySelector(":scope > details") || cell.editor || cell.source;
      const after = anchor.closest(".cell > *") || anchor;
      after.parentNode.insertBefore(cell.output, after.nextSibling);
    }
    cell.output.innerHTML = "";
    cell.output._stream = null;
    return cell.output;
  }

  // Make sure some Python is running, starting the in-browser one if nothing else is.
  async function ensurePython() {
    if (starting) { await starting; return !!client; }
    if (client) return true;
    if (!CONFIG.pyodide) {
      panel.open("Connect to a Python kernel first, then press Run again.");
      return false;
    }
    await startBrowser();
    return !!client;
  }

  async function runCell(cell, internal) {
    if (!internal && (starting || !client)) {
      cell.state.textContent = "waiting for Python…";
      const ok = await ensurePython();
      cell.state.textContent = "";
      if (!ok) return false;
    }
    if (!client) return false;
    // A Python that has just started knows none of the variables made by the cells above,
    // so the first Run brings those cells along, the way "Run from top" does.
    if (!internal && client.fresh) return runThrough(cell);
    const area = outputArea(cell);
    const quiet = cell.el.classList.contains("lc-quiet");
    cell.el.classList.add("lc-running");
    cell.el.classList.remove("lc-failed");
    cell.state.textContent = "running…";
    await nextFrame();                    // let the page show "running…" before Python takes over
    let failed = false;
    try {
      await client.execute(currentCode(cell), msg => {
        const type = msg.header.msg_type;
        if (type === "error") failed = true;
        if (quiet && type === "execute_result") return;
        renderMessage(area, msg);
      });
    } catch (err) {
      failed = true;
      area.appendChild(el("div", { class: "cell-output cell-output-error" }, [el("pre", {}, [el("code", { text: err.message })])]));
    }
    cell.el.classList.remove("lc-running");
    cell.el.classList.toggle("lc-failed", failed);
    cell.state.textContent = failed ? "stopped with an error" : "done";
    return !failed;
  }

  async function runThrough(lastCell) {
    if (!(await ensurePython())) return false;
    client.fresh = false;
    for (const cell of cells) {
      const ok = await runCell(cell, true);
      if (!ok || cell === lastCell) return ok;
    }
    return true;
  }

  async function runAll() {
    if (cells.length) await runThrough(cells[cells.length - 1]);
  }

  // Setup cells marked lc-autorun create the files and helpers that many cells depend on.
  async function runAutorun() {
    for (const cell of cells.filter(c => c.el.classList.contains("lc-autorun"))) {
      await runCell(cell, true);
    }
  }

  // ------------------------------------------------------------------ panel
  const panel = (() => {
    const dot = el("span", { class: "lc-dot" });
    const label = el("span", { class: "lc-label", text: "Python: not running" });
    const startButton = el("button", { class: "lc-btn lc-run", type: "button", text: "Start", title: "Run Python inside this page. Nothing to install.", onclick: () => ensurePython() });
    const localButton = el("button", { class: "lc-btn", type: "button", text: "My computer", title: "Run the cells with Python on your own computer instead", onclick: () => toggleForm() });
    const runAllButton = el("button", { class: "lc-btn", type: "button", text: "Run all", hidden: "", onclick: () => runAll() });
    const stopButton = el("button", { class: "lc-btn", type: "button", text: "Interrupt", hidden: "", onclick: () => interrupt() });
    const restartButton = el("button", { class: "lc-btn", type: "button", text: "Restart", hidden: "", onclick: () => restart() });
    const disconnectButton = el("button", { class: "lc-btn", type: "button", text: "Disconnect", hidden: "", onclick: () => disconnect(true) });

    const serverInput = el("input", { type: "url", class: "lc-input", "aria-label": "Server address" });
    const tokenInput = el("input", { type: "password", class: "lc-input", "aria-label": "Token" });
    const message = el("p", { class: "lc-message", "aria-live": "polite" });
    const form = el("form", { class: "lc-form", hidden: "" }, [
      el("p", { class: "lc-help", text: "Run  python start_kernel.py  on your computer. It opens this page connected to your Python. Or paste the address and token it prints." }),
      el("label", {}, [document.createTextNode("Server"), serverInput]),
      el("label", {}, [document.createTextNode("Token"), tokenInput]),
      el("div", { class: "lc-form-buttons" }, [
        el("button", { class: "lc-btn lc-primary", type: "submit", text: "Connect" }),
        el("button", { class: "lc-btn", type: "button", text: "Cancel", onclick: () => { form.hidden = true; } }),
      ]),
    ]);
    form.addEventListener("submit", event => {
      event.preventDefault();
      connect(serverInput.value.trim(), tokenInput.value.trim());
    });

    const root = el("aside", { class: "lc-panel", "aria-label": "Python" }, [
      el("div", { class: "lc-bar" }, [dot, label, startButton, runAllButton, stopButton, restartButton, disconnectButton, localButton]),
      message,
      form,
    ]);

    let kind = null;
    const where = () => kind === "browser" ? "Python in this browser" : kind === "kernel" ? "Python on your computer" : "Python";

    function toggleForm() {
      serverInput.value = store.get("server") || CONFIG.server;
      tokenInput.value = store.get("token") || "";
      form.hidden = !form.hidden;
      if (!form.hidden) serverInput.focus();
    }

    function setConnected(on, newKind) {
      kind = on ? newKind : null;
      const browser = kind === "browser";
      startButton.hidden = on || !CONFIG.pyodide;
      localButton.textContent = CONFIG.pyodide ? "My computer" : "Connect";
      localButton.hidden = on && !browser;
      [runAllButton, restartButton, stopButton].forEach(b => { b.hidden = !on; });
      disconnectButton.hidden = !on || browser;
      stopButton.textContent = browser ? "Stop" : "Interrupt";
      stopButton.title = browser ? "Stop the running cell. In the browser this restarts Python." : "Interrupt the running cell";
      form.hidden = true;
      root.classList.toggle("lc-connected", on);
      if (!on) { dot.className = "lc-dot"; label.textContent = "Python: not running"; }
    }

    function status(state) {
      dot.className = "lc-dot lc-" + state;
      label.textContent = where() + ": " + (state === "idle" ? "ready" : state === "starting" ? "starting…" : state);
    }

    let fadeTimer = null;
    function say(text, fadeAfterMs) {
      clearTimeout(fadeTimer);
      message.textContent = text || "";
      message.hidden = !text;
      if (text && fadeAfterMs) fadeTimer = setTimeout(() => say(""), fadeAfterMs);
    }

    return {
      root, setConnected, status, say,
      open(text) { say(text); if (!client) { form.hidden = true; toggleForm(); } },
      starting(newKind) {
        kind = newKind;
        startButton.hidden = true;
        status("starting");
      },
    };
  })();

  function adopt(candidate) {
    if (client && client !== candidate) client.shutdown();
    client = candidate;
    client.fresh = true;
    client.onStatus = state => panel.status(state);
    client.onClose = () => { client = null; panel.setConnected(false); panel.say("The kernel connection closed."); };
    panel.setConnected(true, candidate.kind);
    panel.status("idle");
  }

  function startBrowser() {
    const job = (async () => {
      const candidate = new BrowserPython(CONFIG.pyodide, CONFIG.packages);
      candidate.onProgress = text => panel.say(text);
      panel.starting("browser");
      panel.say("Downloading Python with NumPy, SciPy and Matplotlib. The first time takes a little while (about 40 MB), and the browser keeps a copy for next time.");
      try {
        await candidate.start();
      } catch (err) {
        panel.setConnected(false);
        panel.say("Could not start Python in this browser (" + err.message + "). You can run the code with Python on your own computer instead.");
        return;
      }
      adopt(candidate);
      panel.say("Python is running in this browser. Creating the test files the code uses…");
      await runAutorun();
      panel.say("Ready. The first cell you run also runs the cells above it, so everything it needs is defined.", 15000);
    })();
    starting = job.finally(() => { starting = null; });
    return starting;
  }

  function connect(server, token, quiet) {
    const job = (async () => {
      panel.say(quiet ? "" : "Starting a kernel…");
      const candidate = new KernelClient(server, token);
      try {
        await candidate.start();
      } catch (err) {
        let detail = err.message;
        if (err instanceof TypeError) {
          // The browser hides the reason for a failed cross-origin request. An opaque
          // request tells us at least whether anything is listening at that address.
          let reachable = false;
          try { await fetch(server.replace(/\/+$/, "") + "/api", { mode: "no-cors" }); reachable = true; } catch (e) { /* nothing there */ }
          detail = reachable
            ? "the server answered but refused. Check the token, and that start_kernel.py was started for this page's address."
            : `nothing answered at ${server}. Is start_kernel.py running?`;
        }
        if (quiet && CONFIG.pyodide) {
          // Remembered from an earlier visit, and gone now. Fall back to Python in the browser.
          store.del("autoconnect");
          panel.say("Python on your computer did not answer, so the cells will use Python in this browser.", 10000);
        } else {
          panel.say("Could not connect: " + detail);
        }
        return;
      }
      adopt(candidate);
      store.set("server", server);
      store.set("token", token);
      store.set("autoconnect", "1");
      panel.say("Connected. The first cell you run also runs the cells above it, so everything it needs is defined.", 15000);
      await runAutorun();
    })();
    starting = job.finally(() => { starting = null; });
    return starting;
  }

  function disconnect(forget) {
    if (client) client.shutdown();
    client = null;
    if (forget) store.del("autoconnect");
    panel.setConnected(false);
    panel.say("");
  }

  async function restart() {
    if (!client) return;
    const browser = client.kind === "browser";
    panel.say(browser ? "Starting a fresh Python…" : "Restarting the kernel…");
    try {
      await client.restart();
      client.fresh = true;
      panel.status("idle");
      if (browser) {
        await runAutorun();             // a fresh browser Python also has a fresh, empty file system
        panel.say("Python restarted and the setup cells ran again. The next cell you run brings the cells above it along.");
      } else {
        panel.say("Kernel restarted. The next cell you run brings the cells above it along.");
      }
    } catch (err) {
      panel.say("Restart failed: " + err.message);
    }
  }

  async function interrupt() {
    if (!client) return;
    if (client.kind === "browser") return restart();
    try { await client.interrupt(); } catch (err) { panel.say("Interrupt failed: " + err.message); }
  }

  // ------------------------------------------------------------------- boot
  function boot() {
    findCells();
    if (!cells.length) return;
    document.body.appendChild(panel.root);
    panel.setConnected(false);
    panel.say("");

    const params = new URLSearchParams(window.location.search);
    if (params.get("kernel")) {
      const server = params.get("kernel");
      const token = params.get("token") || "";
      params.delete("kernel");
      params.delete("token");
      const clean = window.location.pathname + (params.toString() ? "?" + params : "") + window.location.hash;
      window.history.replaceState(null, "", clean);       // keep the token out of the address bar
      connect(server, token);
    } else if (store.get("autoconnect") && store.get("server")) {
      connect(store.get("server"), store.get("token") || "", true);
    }

    window.addEventListener("pagehide", () => { if (client) client.shutdown(true); });
  }

  window.LiveCells = { KernelClient, BrowserPython, runAll, cells, get client() { return client; } };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
