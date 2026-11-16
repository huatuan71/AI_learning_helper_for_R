#!/usr/bin/env bash
# macOS / Linux counterpart of stop.cmd: stop only the service that start.command launched.
set -euo pipefail
cd "$(dirname "$0")"
state_file="$PWD/.runtime/server.pid"

if [ ! -f "$state_file" ]; then echo "No project service record."; exit 0; fi
{ read -r pid; read -r started; read -r script; } <"$state_file"
if ! kill -0 "$pid" 2>/dev/null; then
  rm -f "$state_file"; echo "Project service is already stopped."; exit 0
fi
actual_started="$(ps -p "$pid" -o lstart= | sed 's/^ *//')"
command_line="$(ps -p "$pid" -o command=)"
if [ "$actual_started" != "$started" ] || [[ "$command_line" != *"$script"* ]]; then
  echo "Process identity does not match this project. Nothing was stopped."; exit 1
fi
kill "$pid"
for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
rm -f "$state_file"
echo "Project service stopped."
