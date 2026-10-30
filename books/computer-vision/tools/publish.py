"""Quarto runs this after every render (see `post-render` in _quarto.yml).

It tidies the rendered pages and copies the finished book into the website, at
notes/computer-vision/book/, the folder that GitHub Pages serves. It also copies
start_kernel.py and requirements.txt next to the course page, where readers download them.
"""
import os
import re
import shutil
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
BOOK = PROJECT / os.environ.get("QUARTO_PROJECT_OUTPUT_DIR", "_book")
SITE = PROJECT.parent.parent / "notes" / "computer-vision" / "book"

# Quarto adds a polyfill for very old browsers next to MathJax. Modern browsers do not need it,
# and leaving it out keeps every page free of requests to other sites until the reader runs code.
POLYFILL = re.compile(r'\s*<script src="https://cdnjs\.cloudflare\.com/polyfill/[^"]*"></script>')
for page in BOOK.rglob("*.html"):
    text = page.read_text(encoding="utf-8")
    tidy = POLYFILL.sub("", text)
    if tidy != text:
        page.write_text(tidy, encoding="utf-8")

if SITE.exists():
    shutil.rmtree(SITE)
shutil.copytree(BOOK, SITE)
for name in ("start_kernel.py", "requirements.txt"):
    shutil.copy2(PROJECT / name, SITE.parent / name)
print(f"Copied the book to {SITE.relative_to(PROJECT.parent.parent).as_posix()}/")
