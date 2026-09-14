#!/bin/sh
# Serve the garden at http://localhost:8000
cd "$(dirname "$0")" || exit 1
echo "serving $(pwd) at http://localhost:8000"
exec python3 -m http.server 8000
