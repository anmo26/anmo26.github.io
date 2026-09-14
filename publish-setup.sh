#!/bin/sh
# publish-setup.sh — connect this garden to a GitHub repo and push it live.
#
#   ./publish-setup.sh YOUR-GITHUB-USERNAME
#
# Run this AFTER you have created the empty repo on github.com.
# It does not handle any credentials; git will prompt you for those.

set -e
cd "$(dirname "$0")"

USER="$1"
if [ -z "$USER" ]; then
  echo "usage: ./publish-setup.sh YOUR-GITHUB-USERNAME"
  echo
  echo "example:  ./publish-setup.sh anmoli"
  exit 1
fi

REPO="$USER.github.io"
URL="https://$USER.github.io"

echo "repo:  git@github.com:$USER/$REPO.git"
echo "site:  $URL"
echo

if git remote | grep -q '^origin$'; then
  echo "origin already set, updating it"
  git remote set-url origin "git@github.com:$USER/$REPO.git"
else
  git remote add origin "git@github.com:$USER/$REPO.git"
fi

git branch -M main
echo "pushing..."
git push -u origin main

# Record the live URL so the watcher can print it, and turn publishing on.
node - "$URL" <<'NODE'
const fs = require('fs');
const url = process.argv[2];
const p = 'garden.config.json';
const c = JSON.parse(fs.readFileSync(p, 'utf8'));
c.publish = true;
c.url = url;
fs.writeFileSync(p, JSON.stringify(c, null, 2) + '\n');
console.log('\npublishing turned on in garden.config.json');
NODE

echo
echo "now turn on Pages:"
echo "  https://github.com/$USER/$REPO/settings/pages"
echo "  Source: Deploy from a branch -> main -> / (root) -> Save"
echo
echo "then run:  ./live.sh"
echo "your site: $URL"
