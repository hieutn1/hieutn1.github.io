-- Live cells: attach the browser runtime to every HTML page and pass it the
-- settings from the `livecells:` key in _quarto.yml (or a page's front matter).
--
--   pyodide:  where to load Pyodide from, for running cells inside the browser.
--             Leave it out to allow only kernels on the reader's computer.
--   packages: Pyodide packages to load before the first cell runs.
--   server:   the default address shown in the "Use Python on my computer" form.
--   kernel:   the Jupyter kernel to start on that server.
--   enabled:  false switches the runtime off for a page.

local function to_string(value)
  if value == nil then return nil end
  return pandoc.utils.stringify(value)
end

local function json_string(s)
  return '"' .. s:gsub('\\', '\\\\'):gsub('"', '\\"'):gsub('\n', '\\n'):gsub('</', '<\\/') .. '"'
end

local function to_list(value)
  local out = {}
  if value == nil then return out end
  if pandoc.utils.type(value) == "List" then
    for _, item in ipairs(value) do table.insert(out, pandoc.utils.stringify(item)) end
  else
    for item in pandoc.utils.stringify(value):gmatch("[^,%s]+") do table.insert(out, item) end
  end
  return out
end

function Meta(meta)
  if not quarto.doc.is_format("html") then
    return meta
  end

  local cfg = meta.livecells or {}
  local enabled = cfg.enabled == nil or pandoc.utils.stringify(cfg.enabled) ~= "false"
  if not enabled then
    return meta
  end

  local server = to_string(cfg.server) or "http://127.0.0.1:8888"
  local kernel = to_string(cfg.kernel) or "python3"
  local pyodide = to_string(cfg.pyodide) or ""
  local packages = {}
  for _, name in ipairs(to_list(cfg.packages)) do table.insert(packages, json_string(name)) end

  quarto.doc.add_html_dependency({
    name = "livecells",
    version = "0.2.0",
    scripts = { { path = "livecells.js", afterBody = true } },
    stylesheets = { "livecells.css" },
  })

  quarto.doc.include_text("in-header", string.format(
    '<script>window.LIVECELLS_CONFIG = {"server": %s, "kernelName": %s, "pyodide": %s, "packages": [%s]};</script>',
    json_string(server), json_string(kernel), json_string(pyodide), table.concat(packages, ", ")))

  return meta
end
