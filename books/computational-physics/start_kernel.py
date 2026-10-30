#!/usr/bin/env python3
"""Run the code of the Computational Physics notes with Python on your own computer.

The notes run their code inside the browser by default. Use this script when you
would rather use your own Python, for speed or for packages the browser cannot
load (PyTorch, for example). Install the packages first:

    pip install -r requirements.txt

This launches a Jupyter server on your computer, locked down so that only the
notes' web address may talk to it, and only with a fresh secret token. It then
opens the notes with the server's address and token in the link, so the page
connects by itself.

    python start_kernel.py                                  # the notes on hieutnn.github.io
    python start_kernel.py --book http://localhost:4200     # a copy served by quarto preview

Everything the code in the book writes (test images, videos and so on) goes
into the folder given by --workspace. Press Ctrl+C to stop the server.
"""
import argparse
import json
import os
import secrets
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

BOOK = "https://hieutnn.github.io/notes/computational-statistical-physics/book"
CHAPTER = "01-scientific-computing.html"
REQUIRED = {"jupyter_server": "jupyter_server", "ipykernel": "ipykernel"}


def check_requirements():
    missing = []
    for module, package in REQUIRED.items():
        try:
            __import__(module)
        except ImportError:
            missing.append(package)
    if missing:
        sys.exit("Missing packages: " + ", ".join(missing) +
                 "\nInstall everything the book needs with:\n    pip install -r requirements.txt")


def wait_until_up(base, token, seconds=30):
    request = urllib.request.Request(base + "/api/status", headers={"Authorization": "token " + token})
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(request, timeout=2) as response:
                return json.load(response)
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            time.sleep(0.4)
    return None


def port_is_free(port):
    """True if nothing is listening on the port and we could bind to it ourselves."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.3)
        if probe.connect_ex(("127.0.0.1", port)) == 0:
            return False                                  # something is already serving there
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        try:
            probe.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def choose_port(requested):
    if requested is not None:
        if not port_is_free(requested):
            sys.exit(f"Port {requested} is already in use. Pick another with --port, or leave --port out "
                     "and a free one is chosen for you.")
        return requested
    for port in range(8888, 8988):
        if port_is_free(port):
            if port != 8888:
                print(f"Port 8888 is busy (perhaps another Jupyter is running), so using port {port}.")
            return port
    sys.exit("Could not find a free port between 8888 and 8987. Choose one with --port.")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--book", default=BOOK,
                        help=f"where the notes are served from (default: {BOOK})")
    parser.add_argument("--chapter", default=CHAPTER, help=f"page to open (default: {CHAPTER})")
    parser.add_argument("--port", type=int, default=None,
                        help="port for the Python server (default: the first free port from 8888 up)")
    parser.add_argument("--workspace", default="workspace", help="folder the code runs in (default: ./workspace)")
    parser.add_argument("--no-browser", action="store_true", help="print the link instead of opening it")
    args = parser.parse_args()

    check_requirements()

    book = urllib.parse.urlsplit(args.book)
    if book.scheme not in ("http", "https") or not book.netloc:
        sys.exit("--book must be a web address such as http://localhost:4200")
    origin = f"{book.scheme}://{book.netloc}"
    local_book = book.hostname in ("localhost", "127.0.0.1")

    token = secrets.token_urlsafe(24)
    workspace = Path(args.workspace).resolve()
    workspace.mkdir(parents=True, exist_ok=True)
    port = choose_port(args.port)
    server = f"http://127.0.0.1:{port}"

    command = [
        sys.executable, "-m", "jupyter_server",
        "--ServerApp.ip=127.0.0.1",                      # reachable from this computer only
        f"--ServerApp.port={port}",
        "--ServerApp.port_retries=0",
        "--ServerApp.open_browser=False",
        f"--ServerApp.root_dir={workspace}",
        f"--IdentityProvider.token={token}",
        "--ServerApp.terminals_enabled=False",           # code cells only, no shell terminals
    ]
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        command.append("--allow-root")                    # e.g. inside a Docker container
    if local_book:
        # A book served from this computer may use localhost or 127.0.0.1 and any port.
        command.append(r"--ServerApp.allow_origin_pat=https?://(localhost|127\.0\.0\.1)(:\d+)?")
    else:
        command.append(f"--ServerApp.allow_origin={origin}")

    print(f"Starting a Python kernel server in {workspace} ...")
    process = subprocess.Popen(command)
    try:
        if wait_until_up(server, token) is None:
            process.terminate()
            sys.exit(f"The server did not start on port {port}. Try another with --port 8899.")

        query = urllib.parse.urlencode({"kernel": server, "token": token})
        link = f"{args.book.rstrip('/')}/{args.chapter}?{query}"
        print("\nReady. Open the notes with this link (it connects by itself):\n")
        print("    " + link + "\n")
        print("Or press \"My computer\" in the Python panel of the chapter and enter")
        print(f"    server: {server}")
        print(f"    token:  {token}\n")
        print("Press Ctrl+C to stop.")
        if not args.no_browser:
            webbrowser.open(link)
        process.wait()
    except KeyboardInterrupt:
        print("\nStopping the kernel server.")
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()


if __name__ == "__main__":
    main()
