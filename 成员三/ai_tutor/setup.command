#!/usr/bin/env bash
# macOS / Linux counterpart of setup.cmd: create .venv and install the locked dependencies.
# Double-click in Finder, or run ./setup.command in Terminal.
set -euo pipefail
cd "$(dirname "$0")"

python_bin=""
for candidate in python3.12 python3.13 python3; do
  if command -v "$candidate" >/dev/null 2>&1 &&
     "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)' 2>/dev/null; then
    python_bin="$candidate"; break
  fi
done
if [ -z "$python_bin" ]; then
  echo "Setup failed: Python 3.12 or newer was not found."
  echo "Install it from https://www.python.org/downloads/ (or: brew install python@3.12), then run this again."
  exit 1
fi

echo "Using $("$python_bin" --version) at $(command -v "$python_bin")"
mkdir -p .tmp
export TMPDIR="$PWD/.tmp"
"$python_bin" -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
echo "Ready. Run start.command next."
