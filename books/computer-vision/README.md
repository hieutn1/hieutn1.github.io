# Computer Vision: the book's source

This folder is the source of the Computer Vision notes at
<https://hieutnn.github.io/notes/computer-vision/book/>. It is a [Quarto](https://quarto.org) book with two
extra pieces:

* **A LaTeX-style theme.** Latin Modern text, Computer Modern typewriter code, numbered sections and
  amsthm-style exercise boxes. Everything about the look is set in one "preamble" file.
* **Live cells.** Every Python cell was run when the book was rendered, so the pages read fine on their own.
  Each cell also gets *Run*, *Run from top* and *Edit* buttons. By default the code runs inside the reader's
  browser with [Pyodide](https://pyodide.org), which downloads Python, NumPy, OpenCV and Matplotlib the first
  time (about 35 MB, then cached). Readers who want their own Python, for speed or for packages such as
  PyTorch, run `start_kernel.py` and the page uses that instead.

## Folder layout

```
_quarto.yml                      book settings: chapters, page widths, live-cell settings
index.qmd                        Preface
01-programming-with-images.qmd   Chapter 1, Programming with Images (Exercises 1.1.1 to 1.4.6)
references.qmd                   References
theme/textbook.scss              the preamble: fonts, sizes, colours, justification
theme/textbook.theme             colours for syntax highlighting
fonts/                           Latin Modern Roman and CMU Typewriter web fonts
mathjax/                         a local copy of MathJax, so the maths works without other sites
_extensions/livecells/           the live-cell runtime (a Lua filter, one JavaScript file, one stylesheet)
tools/publish.py                 runs after every render and copies the book into the website
start_kernel.py                  starts a locked-down Jupyter server on the reader's computer
requirements.txt                 the Python packages the code needs
_freeze/                         stored results of the code, so rendering skips chapters that have not changed
```

## Writing and publishing

1. Install Quarto with the installer from <https://quarto.org/docs/get-started/>, or on Windows with
   `winget install --id Posit.Quarto --exact` (avoid `pip install quarto-cli` on Windows: it runs into the
   limit on path length). Install the Python packages with `pip install -r requirements.txt`.

2. Edit a chapter and watch it rebuild as you save:

   ```bash
   quarto preview --port 4200
   ```

3. When it reads well, render the whole book. This runs the code of any chapter that changed, writes the pages
   to `_book/`, and `tools/publish.py` then copies them to `../../notes/computer-vision/book/`, which is what the
   website serves. It also copies `start_kernel.py` and `requirements.txt` next to the course page.

   ```bash
   quarto render
   ```

4. From the top of the repository, run the site's tests and commit. Commit both this folder (including
   `_freeze/`) and `notes/computer-vision/`.

   ```bash
   npm test
   git add books/computer-vision notes/computer-vision && git commit -m "Update the Computer Vision notes"
   ```

**A new chapter** is a new `.qmd` file, such as `02-filtering.qmd`, starting with a level-one heading
(`# Filtering`). List it under both `render:` and `chapters:` in `_quarto.yml`, before `references.qmd`. Then add a
line for it on the course page, `notes/computer-vision/index.html`, which has a commented example.

## Writing cells

Write prose in Markdown, maths in `$...$` or `$$...$$`, and code in executable cells. Sections are numbered by
Quarto; give a heading an id to refer to it, and `@sec-...` prints "Section 1.2.4" with a link.

````markdown
## Orientation {#sec-orientation}

As we saw in @sec-rows-columns-x-and-y, ...

```{python}
#| code-fold: true
#| code-summary: "Setup: create the test files"
#| classes: lc-autorun
...
```
````

The live-cell runtime understands a few cell classes, set with a `classes:` cell option (one class per cell).

| Class | Effect |
| --- | --- |
| `lc-autorun` | Runs as soon as Python starts. Use it for setup that creates files the chapter needs. |
| `lc-quiet` | A live run does not echo the value of the last line (use with `#| output: false`). |
| `no-live` | The cell stays static, with no buttons. |
| `lc-exercise`, `lc-check` | Styling only. They mark an exercise's starter cell and its check cell. |

Exercises are numbered by hand after their subsection, in a div with an id:

```markdown
::: {#ex-1-2-3 .exercise}
[**Exercise 1.2.3 (A shape summary)**]{.theorem-title} Gather @sec-binary into one function ...
:::
```

## Changing the look

Open `theme/textbook.scss`. The block at the top is the preamble.

```scss
$tb-body-font:   "Latin Modern Roman", ...;   // \usepackage{lmodern}
$tb-font-size:   1.2rem;                      // \documentclass[11pt]
$tb-justify:     true;                        // ragged right if false
$tb-paper:       #fcfbf7;
$tb-accent:      #8a2a2b;                     // section numbers, exercise rule
$tb-link:        #1f4a7d;                     // \hypersetup{linkcolor=...}
```

Change a value and save, and every page follows. Text width and margins live under `grid:` in `_quarto.yml`.

## How the live cells work

**In the browser.** The first time a reader presses *Run* (or *Start* in the panel at the bottom right), the
page starts Pyodide in a Web Worker, so the page stays responsive while code runs, and loads the packages listed
under `livecells: packages` in `_quarto.yml`. The setup cells marked `lc-autorun` run first, and the first cell a
reader runs also runs the cells above it, so the variables it needs exist. A cell that imports another package
Pyodide provides (scipy, scikit-image, pandas) has it fetched on the spot. Pyodide comes from the jsDelivr CDN,
at the version pinned in `_quarto.yml`. Nothing is requested from another site until a reader runs code.

A browser cannot interrupt a computation without special server headers that GitHub Pages does not send, so
*Stop* starts a fresh Python, and the setup cells run again.

**On the reader's computer.** `start_kernel.py` starts an ordinary Jupyter server and opens the chapter with the
server's address and token in the link, so the page connects by itself. The server

* listens on `127.0.0.1` only, so other machines cannot reach it;
* uses a fresh random token each time, which the page must present;
* only accepts requests from the notes' own address (`--book`, the website by default);
* has shell terminals switched off, so only code cells can run.

The code then runs with the reader's own permissions, as in Jupyter. Some browsers ask for permission when a
page from the internet talks to a server on the same computer; the reader allows it for hieutnn.github.io. To use
a copy served by `quarto preview` instead, run `python start_kernel.py --book http://localhost:4200`.

## Limitations

* Each page starts its own Python, which stops when the page is closed.
* Edits to cells are not saved when the page is reloaded.
* Interactive widgets (`ipywidgets`) and `input()` are not supported.
* Python in the browser is slower than native Python, and cannot install packages that Pyodide does not provide
  (PyTorch, for example).

## Credits and licences

* Pyodide: Mozilla Public License 2.0, loaded from the jsDelivr CDN.
* Latin Modern fonts: GUST Font License, from the [latex.css](https://github.com/vincentdoerig/latex-css) package (MIT).
* CMU Typewriter Text: SIL Open Font License, from the [computer-modern](https://www.npmjs.com/package/computer-modern) package (MIT).
* MathJax 3: Apache License 2.0 (`mathjax/LICENSE`).
