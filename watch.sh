#!/bin/sh
# Regrow the garden whenever anything in it changes.
# Needs fswatch:  brew install fswatch
cd "$(dirname "$0")" || exit 1
node src/grow.js "$@"
fswatch -o -r --exclude 'index\.html$' . | while read -r _; do
  echo "--- change detected, regrowing"
  node src/grow.js "$@"
done
