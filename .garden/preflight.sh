#!/bin/bash
# preflight.sh — look before you publish.
#
#   ./.garden/preflight.sh          summary
#   ./.garden/preflight.sh --list   summary, plus every file that would go public
#
# READ-ONLY. This script reports. It never commits, pushes, or edits anything.

set -uo pipefail
cd "$(dirname "$0")/.."

LIST=0
[ "${1:-}" = "--list" ] && LIST=1

WARN=0
warn() { WARN=$((WARN + 1)); printf '  WARNING: %s\n' "$1"; }

hr() { printf '%s\n' "------------------------------------------------------------"; }

human() { # bytes -> readable
  awk -v b="$1" 'BEGIN{
    if (b >= 1073741824) printf "%.2f GB", b/1073741824;
    else if (b >= 1048576) printf "%.1f MB", b/1048576;
    else if (b >= 1024) printf "%.1f KB", b/1024;
    else printf "%d B", b;
  }'
}

hr
printf 'preflight: %s\n' "$(pwd)"
hr

if [ ! -d .git ]; then
  echo "  WARNING: this folder is not a git repository. Nothing to check."
  exit 1
fi

# ------------------------------------------------------- 1. working tree

echo
echo "1. working tree"
DIRTY=$(git status --porcelain)
if [ -z "$DIRTY" ]; then
  echo "  clean - everything is committed."
else
  COUNT=$(printf '%s\n' "$DIRTY" | wc -l | tr -d ' ')
  warn "$COUNT uncommitted change(s). These are NOT on GitHub yet."
  printf '%s\n' "$DIRTY" | sed 's/^/    /'
  echo "    commit them with:  git add -A && git commit -m 'update'"
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
echo "  branch: $BRANCH"
[ "$BRANCH" = "main" ] || warn "GitHub Pages will be set to serve 'main'. You are on '$BRANCH'."

if git rev-parse --verify HEAD >/dev/null 2>&1; then
  echo "  commits: $(git rev-list --count HEAD)"
else
  warn "no commits yet - there is nothing to publish."
fi

# ------------------------------------------------ 2. what becomes public

echo
echo "2. what becomes public"

TOTAL=0
FILES=0
BIG_LIST=""
BIGGEST_NAME=""
BIGGEST_SIZE=0

while IFS= read -r f; do
  [ -f "$f" ] || continue
  SZ=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f" 2>/dev/null || echo 0)
  FILES=$((FILES + 1))
  TOTAL=$((TOTAL + SZ))
  if [ "$SZ" -gt "$BIGGEST_SIZE" ]; then BIGGEST_SIZE=$SZ; BIGGEST_NAME=$f; fi
  # GitHub hard-rejects files over 100 MB, warns over 50 MB.
  if [ "$SZ" -gt 104857600 ]; then
    BIG_LIST="$BIG_LIST
    OVER 100 MB (will be REJECTED): $f ($(human "$SZ"))"
  elif [ "$SZ" -gt 52428800 ]; then
    BIG_LIST="$BIG_LIST
    over 50 MB (GitHub will complain): $f ($(human "$SZ"))"
  fi
  [ "$LIST" -eq 1 ] && printf '    %10s  %s\n' "$(human "$SZ")" "$f"
done < <(git ls-files)

echo "  $FILES tracked files, $(human "$TOTAL") total."
[ -n "$BIGGEST_NAME" ] && echo "  largest: $BIGGEST_NAME ($(human "$BIGGEST_SIZE"))"
[ "$LIST" -eq 1 ] || echo "  run ./.garden/preflight.sh --list to see every file."
echo "  Every one of these is readable by anyone once you push."

UNTRACKED=$(git ls-files --others --exclude-standard | wc -l | tr -d ' ')
if [ "$UNTRACKED" -gt 0 ]; then
  warn "$UNTRACKED untracked file(s) are not counted above, but 'git add -A'"
  echo "    (which the watcher runs when publishing is on) would make them public too:"
  git ls-files --others --exclude-standard | sed 's/^/      /'
  echo "    Move anything private out of this folder, or add it to .gitignore."
  echo "    NOTE: .gardenignore only hides files from the rendered page."
  echo "    It does NOT keep them out of the repo. Only .gitignore does that."
fi

# ---------------------------------------------------- 3. size limits

echo
echo "3. size limits"
if [ -n "$BIG_LIST" ]; then
  warn "files that break GitHub's per-file limits:"
  printf '%s\n' "$BIG_LIST"
  echo "    Remove them from the folder, or add them to .gitignore."
else
  echo "  no file is over 50 MB. (GitHub's hard limit is 100 MB per file.)"
fi

REPO_BYTES=$(du -sk .git 2>/dev/null | awk '{print $1 * 1024}')
REPO_BYTES=${REPO_BYTES:-0}
echo "  repository history (.git): $(human "$REPO_BYTES")"
if [ "$REPO_BYTES" -gt 858993459 ]; then       # > 0.8 GB
  warn "approaching GitHub's 1 GB soft limit for a repository."
elif [ "$REPO_BYTES" -gt 536870912 ]; then     # > 0.5 GB
  echo "  over half of GitHub's 1 GB soft limit - keep an eye on it."
else
  echo "  well under GitHub's 1 GB soft limit."
fi

# ------------------------------------------------------- 4. remote

echo
echo "4. remote"
if git remote | grep -qx 'origin'; then
  ORIGIN=$(git remote get-url origin)
  echo "  origin: $ORIGIN"
  case "$ORIGIN" in
    git@*) echo "  uses SSH - needs an SSH key registered with GitHub." ;;
    https://*) echo "  uses HTTPS - git will ask for a Personal Access Token." ;;
  esac
  if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
    echo "  tracking: $(git rev-parse --abbrev-ref --symbolic-full-name '@{u}')"
  else
    echo "  this branch has never been pushed."
  fi
else
  echo "  no remote configured - nothing has been published."
  echo "  run ./.garden/publish-setup.sh YOUR-GITHUB-USERNAME when you are ready."
fi

# ------------------------------------------------------- 5. pages setup

echo
echo "5. pages setup"
if [ -f .nojekyll ]; then
  echo "  .nojekyll present - good. Files and folders starting with _ will serve."
else
  warn ".nojekyll is missing. GitHub will run Jekyll and may hide files."
  echo "    fix with:  touch .nojekyll && git add .nojekyll && git commit -m 'add .nojekyll'"
fi

if [ -f index.html ]; then
  echo "  index.html present - the site has a front page."
else
  warn "no index.html at the top level. The site will 404."
  echo "    regenerate it with:  node .garden/src/grow.js"
fi

if [ -f .garden/garden.config.json ]; then
  PUB=$(grep -o '"publish"[[:space:]]*:[[:space:]]*[a-z]*' .garden/garden.config.json | awk -F: '{gsub(/ /,"",$2); print $2}')
  URLV=$(grep -o '"url"[[:space:]]*:[[:space:]]*[^,]*' .garden/garden.config.json | head -1 | cut -d: -f2- | sed 's/^[[:space:]]*//')
  echo "  .garden/garden.config.json: publish=${PUB:-unknown} url=${URLV:-unknown}"
  if [ "${PUB:-}" = "true" ]; then
    warn "publishing is ON. The watcher auto-commits and pushes every change."
    echo "    Anything you put in this folder goes public within about a minute."
  fi
fi

# ------------------------------------------------------------ summary

echo
hr
if [ "$WARN" -eq 0 ]; then
  echo "preflight: no problems found."
else
  echo "preflight: $WARN warning(s) above. Read them before you push."
fi
echo "This script changed nothing."
hr
