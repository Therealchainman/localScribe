#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

APP_URL="http://127.0.0.1:8000/"

if [[ ! -d ".venv" ]]; then
  echo "Missing virtual environment at $SCRIPT_DIR/.venv"
  echo
  echo "Set it up first:"
  echo "  python3 -m venv .venv"
  echo "  source .venv/bin/activate"
  echo "  pip install -r requirements.txt"
  echo
  read -k 1 "?Press any key to close..."
  echo
  exit 1
fi

if [[ ! -f ".venv/bin/activate" ]]; then
  echo "Virtual environment exists, but .venv/bin/activate is missing."
  read -k 1 "?Press any key to close..."
  echo
  exit 1
fi

source ".venv/bin/activate"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is not available in this environment."
  read -k 1 "?Press any key to close..."
  echo
  exit 1
fi

(
  sleep 2
  open "$APP_URL"
) >/dev/null 2>&1 &

echo "Starting Local Scribe at $APP_URL"
echo "Leave this window open while using the app."
echo

python3 manage.py runserver 127.0.0.1:8000
