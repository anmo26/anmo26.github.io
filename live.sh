#!/bin/sh
# live.sh — watch the folder, rebuild on every change, and publish.
# Leave this running in a terminal window while you add things to the folder.
cd "$(dirname "$0")" || exit 1
exec node src/watch.js "$@"
