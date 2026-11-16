#!/usr/bin/env bash
# macOS / Linux counterpart of start.cmd: start the local service on 127.0.0.1:8000 in the background.
# Double-click in Finder, or run ./start.command in Terminal. Stop it with stop.command.
set -euo pipefail
cd "$(dirname "$0")"
project_root="$PWD"
python_exe="$project_root/.venv/bin/python"
server_script="$project_root/scripts/serve.py"
runtime_dir="$project_root/.runtime"

if [ ! -x "$python_exe" ]; then
  echo "Run setup.command first to install the project environment."; exit 1
fi
if "$python_exe" -c 'import socket,sys; s=socket.socket(); s.settimeout(0.7); sys.exit(0 if s.connect_ex(("127.0.0.1",8000))==0 else 1)'; then
  echo "Port 8000 is already in use. No process was stopped."
  echo "Check http://127.0.0.1:8000 or close the existing service yourself."; exit 1
fi

mkdir -p "$runtime_dir"
nohup "$python_exe" "$server_script" >"$runtime_dir/server.out.log" 2>"$runtime_dir/server.err.log" </dev/null &
pid=$!
# Record pid + start time + command so stop.command only stops this exact process.
started="$(ps -p "$pid" -o lstart= | sed 's/^ *//')"
printf '%s\n%s\n%s\n' "$pid" "$started" "$server_script" >"$runtime_dir/server.pid"

for _ in $(seq 1 30); do
  sleep 0.5
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "Service exited. Check .runtime/server.err.log."; exit 1
  fi
  if curl -fsS --max-time 2 http://127.0.0.1:8000/api/health 2>/dev/null | grep -q '"mode":"mock"'; then
    echo "Ready: http://127.0.0.1:8000"
    echo "API docs: http://127.0.0.1:8000/docs"
    echo "Use stop.command to stop this project service."
    [ "$(uname)" = "Darwin" ] && open "http://127.0.0.1:8000/#/home"
    exit 0
  fi
done
echo "Startup timed out. Check .runtime/server.err.log and run stop.command before retrying."
exit 1
