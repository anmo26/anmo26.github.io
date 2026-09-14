#!/bin/bash
# publish-setup.sh — connect this garden to a GitHub repo and push it live.
#
#   ./publish-setup.sh YOUR-GITHUB-USERNAME
#   ./publish-setup.sh YOUR-GITHUB-USERNAME --dry-run
#
# Read PUBLISHING.md first. Run this AFTER you have created the empty repo on
# github.com (public, no README, no .gitignore, no license).
#
# This script never asks you for a password or a token. Git does that itself,
# in your terminal. Nobody else should ever see what you type there.
#
# Options:
#   --dry-run        print every step, change nothing, push nothing
#   --ssh            use an SSH remote instead of HTTPS (needs a key on file)
#   --repo NAME      use a repo other than USERNAME.github.io
#   --replace-remote allow replacing an existing, different "origin"

set -euo pipefail

# Always operate on the folder this script lives in, never the shell's cwd.
cd "$(dirname "$0")"

say()  { printf '%s\n' "$*"; }
fail() { printf '\nERROR: %s\n' "$1" >&2; shift; for l in "$@"; do printf '  %s\n' "$l" >&2; done; exit 1; }

USER_NAME=""
REPO=""
DRY_RUN=0
USE_SSH=0
REPLACE_REMOTE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)        DRY_RUN=1 ;;
    --ssh)            USE_SSH=1 ;;
    --replace-remote) REPLACE_REMOTE=1 ;;
    --repo)           REPO="${2:-}"; shift ;;
    -h|--help)        sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)               fail "unknown option: $1" "run: ./publish-setup.sh --help" ;;
    *)                if [ -z "$USER_NAME" ]; then USER_NAME="$1"; else fail "too many arguments: $1"; fi ;;
  esac
  shift
done

# ---------------------------------------------------------------- username

if [ -z "$USER_NAME" ]; then
  say "usage: ./publish-setup.sh YOUR-GITHUB-USERNAME"
  say ""
  say "example:  ./publish-setup.sh anmo26"
  say ""
  say "Use your GitHub username exactly as it appears in your profile URL:"
  say "  https://github.com/USERNAME  <- that part"
  say ""
  say "Add --dry-run to see what would happen without changing anything."
  say "Full instructions: PUBLISHING.md"
  exit 1
fi

# GitHub usernames: letters, digits and single hyphens, 1-39 characters.
case "$USER_NAME" in
  *[!A-Za-z0-9-]*) fail "'$USER_NAME' is not a valid GitHub username." \
                        "It should be just the username - no @, no spaces, no URL." \
                        "Example: anmo26, not https://github.com/anmo26" ;;
esac
if [ ${#USER_NAME} -gt 39 ]; then
  fail "'$USER_NAME' is too long to be a GitHub username (max 39 characters)."
fi

[ -n "$REPO" ] || REPO="$USER_NAME.github.io"

# The clean root URL only happens when the repo is named USERNAME.github.io.
# Any other name lives in a subfolder.
LOWER_USER=$(printf '%s' "$USER_NAME" | tr '[:upper:]' '[:lower:]')
LOWER_REPO=$(printf '%s' "$REPO" | tr '[:upper:]' '[:lower:]')
if [ "$LOWER_REPO" = "$LOWER_USER.github.io" ]; then
  URL="https://$LOWER_USER.github.io"
else
  URL="https://$LOWER_USER.github.io/$REPO/"
fi

if [ "$USE_SSH" -eq 1 ]; then
  REMOTE_URL="git@github.com:$USER_NAME/$REPO.git"
else
  REMOTE_URL="https://github.com/$USER_NAME/$REPO.git"
fi

# --------------------------------------------------------- sanity of the repo

command -v git >/dev/null 2>&1 || fail "git is not installed." \
  "Install Apple's command line tools with:  xcode-select --install"

if [ ! -d .git ]; then
  fail "this folder is not a git repository: $(pwd)" \
       "publish-setup.sh must sit inside the garden folder and be run as:" \
       "  cd \"$(pwd)\" && ./publish-setup.sh $USER_NAME"
fi

if [ ! -f garden.config.json ]; then
  fail "garden.config.json is missing from $(pwd)" \
       "This does not look like the garden folder. Check where you are."
fi

if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  fail "this repository has no commits yet." \
       "There is nothing to publish. Make a first commit:" \
       "  git add -A && git commit -m 'first planting'"
fi

if [ "$USE_SSH" -eq 1 ] && [ ! -f "$HOME/.ssh/id_ed25519" ] && [ ! -f "$HOME/.ssh/id_rsa" ]; then
  fail "--ssh was given but there is no SSH key in $HOME/.ssh" \
       "Making and registering an SSH key is extra work you do not need." \
       "Just drop --ssh and use HTTPS. Git will ask for your username and a" \
       "Personal Access Token instead. See PUBLISHING.md."
fi

# ------------------------------------------------------------------- report

say "folder:  $(pwd)"
say "remote:  $REMOTE_URL"
say "branch:  main"
say "site:    $URL"
if [ "$LOWER_REPO" != "$LOWER_USER.github.io" ]; then
  say ""
  say "NOTE: the repo is not named $LOWER_USER.github.io, so the site lives in a"
  say "      subfolder, not at the clean root address."
fi
say ""

DIRTY=$(git status --porcelain)
if [ -n "$DIRTY" ]; then
  say "Uncommitted changes are present. They will NOT be pushed:"
  printf '%s\n' "$DIRTY" | sed 's/^/  /'
  say ""
  say "Commit them first if you want them live:"
  say "  git add -A && git commit -m 'update'"
  say ""
fi

FILE_COUNT=$(git ls-files | wc -l | tr -d ' ')
say "$FILE_COUNT tracked files will become PUBLIC when this pushes."
say "Run ./preflight.sh to see exactly which ones."
say ""

# ------------------------------------------------------------------ dry run

if [ "$DRY_RUN" -eq 1 ]; then
  say "--dry-run: stopping here. Nothing was changed and nothing was pushed."
  say ""
  say "Without --dry-run this script would:"
  if git remote | grep -qx 'origin'; then
    EXISTING=$(git remote get-url origin)
    if [ "$EXISTING" = "$REMOTE_URL" ]; then
      say "  - leave the existing 'origin' alone (it already matches)"
    else
      say "  - STOP. 'origin' already points somewhere else:"
      say "      existing: $EXISTING"
      say "      asked for: $REMOTE_URL"
      say "    Nothing would be pushed. Re-run with the username from the"
      say "    existing URL, or add --replace-remote to change it on purpose."
      exit 0
    fi
  else
    say "  - add a remote named 'origin' -> $REMOTE_URL"
  fi
  say "  - rename the current branch to 'main'"
  say "  - run: git push -u origin main"
  say "  - on success only, set publish=true and url=$URL in garden.config.json"
  exit 0
fi

# ------------------------------------------------------------------- remote

if git remote | grep -qx 'origin'; then
  EXISTING=$(git remote get-url origin)
  if [ "$EXISTING" = "$REMOTE_URL" ]; then
    say "origin is already set to $REMOTE_URL - leaving it alone."
  elif [ "$REPLACE_REMOTE" -eq 1 ]; then
    say "replacing origin:"
    say "  was: $EXISTING"
    say "  now: $REMOTE_URL"
    git remote set-url origin "$REMOTE_URL"
  else
    fail "this repo already has a remote called 'origin', pointing somewhere else." \
         "" \
         "  existing: $EXISTING" \
         "  you asked for: $REMOTE_URL" \
         "" \
         "Nothing has been changed. Decide which one is right:" \
         "" \
         "  - If the existing one is correct, run this script with that username:" \
         "      ./publish-setup.sh <the username in the existing URL>" \
         "  - If it is wrong or was set by mistake, replace it on purpose:" \
         "      ./publish-setup.sh $USER_NAME --replace-remote" \
         "  - To just look at it:  git remote -v"
  fi
else
  git remote add origin "$REMOTE_URL"
  say "added origin -> $REMOTE_URL"
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  say "renaming branch '$CURRENT_BRANCH' to 'main'"
  git branch -M main
fi

# --------------------------------------------------------------------- push

say ""
say "pushing..."
say "If git asks for a password, it wants your Personal Access Token."
say "Type it into this terminal only. Never give it to anyone, including any"
say "AI assistant. See PUBLISHING.md for how to create one."
say ""

PUSH_LOG=$(mktemp -t garden-push)
# Do not let a failed push kill the script - we want to explain the failure.
set +e
git push -u origin main 2>&1 | tee "$PUSH_LOG"
PUSH_STATUS=${PIPESTATUS[0]}
set -e

if [ "$PUSH_STATUS" -ne 0 ]; then
  OUT=$(cat "$PUSH_LOG")
  rm -f "$PUSH_LOG"
  say ""
  say "------------------------------------------------------------"
  say "THE PUSH FAILED. Nothing was turned on."
  say "garden.config.json was not touched, so the watcher will not"
  say "try to publish. Your site is still private."
  say "------------------------------------------------------------"
  say ""
  case "$OUT" in
    *"fetch first"*|*"non-fast-forward"*|*"Updates were rejected"*|*"behind its remote"*)
      say "Cause: the GitHub repo already has something in it."
      say ""
      say "This happens when you tick 'Add a README file' (or a .gitignore or a"
      say "license) while creating the repo. The repo needs to be completely empty."
      say ""
      say "Easiest fix: delete that repo on GitHub and make a new empty one."
      say "  https://github.com/$USER_NAME/$REPO/settings"
      say "  scroll to the bottom -> Delete this repository"
      say "Then create it again with every 'Initialize this repository' box"
      say "UNTICKED, and run this script again."
      ;;
    *"Repository not found"*|*"does not appear to be a git repository"*|*"remote: Not Found"*)
      say "Cause: GitHub cannot find $USER_NAME/$REPO."
      say ""
      say "Check all three:"
      say "  1. The repo exists: https://github.com/$USER_NAME/$REPO"
      say "  2. The username is spelled exactly right (it is case-sensitive in"
      say "     the URL you typed: $USER_NAME)."
      say "  3. The repo is named exactly $REPO"
      say ""
      say "If the repo is private, GitHub Pages needs a paid plan. Make it public."
      ;;
    *"Authentication failed"*|*"could not read Username"*|*"Invalid username or password"*|*"403"*)
      say "Cause: GitHub did not accept your login."
      say ""
      say "Your normal GitHub password does NOT work here. Git needs a Personal"
      say "Access Token used in place of the password. See PUBLISHING.md,"
      say "section 'Authentication'."
      say ""
      say "If you already saved a wrong token in the Mac keychain, clear it:"
      say "  printf 'protocol=https\\nhost=github.com\\n\\n' | git credential-osxkeychain erase"
      say "then run this script again and paste the correct token."
      ;;
    *"Permission denied (publickey)"*)
      say "Cause: SSH was used but GitHub does not have your key."
      say ""
      say "Use HTTPS instead - it is simpler and needs no key:"
      say "  ./publish-setup.sh $USER_NAME --replace-remote"
      ;;
    *"Could not resolve host"*|*"unable to access"*|*"timed out"*)
      say "Cause: no network connection to github.com."
      say "Check your internet and try again."
      ;;
    *)
      say "Read the git message above. PUBLISHING.md has a 'When it goes wrong'"
      say "section covering the usual causes."
      ;;
  esac
  exit 1
fi
rm -f "$PUSH_LOG"

# Confirm the push really landed before we change any settings.
if ! git ls-remote --exit-code --heads origin main >/dev/null 2>&1; then
  fail "git reported success but 'main' is not on the remote." \
       "Nothing was turned on. Check https://github.com/$USER_NAME/$REPO"
fi

# ------------------------------------------------- turn publishing on (last)

if ! command -v node >/dev/null 2>&1; then
  say ""
  say "Pushed. But node is not installed, so garden.config.json was left alone."
  say "Edit it by hand: set \"publish\": true and \"url\": \"$URL\""
else
  node - "$URL" <<'NODE'
const fs = require('fs');
const url = process.argv[2];
const p = 'garden.config.json';
let c;
try {
  c = JSON.parse(fs.readFileSync(p, 'utf8'));
} catch (e) {
  console.error(`could not read ${p}: ${e.message}`);
  console.error(`set "publish": true and "url": "${url}" by hand.`);
  process.exit(1);
}
c.publish = true;
c.url = url;
// Write to a temp file and rename, so a crash cannot leave a half-written config.
const tmp = p + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(c, null, 2) + '\n');
fs.renameSync(tmp, p);
console.log('\npublishing turned on in garden.config.json');
NODE
fi

say ""
say "Pushed. The code is on GitHub. The site is NOT live yet."
say ""
say "Last step - turn on Pages:"
say "  1. open https://github.com/$USER_NAME/$REPO/settings/pages"
say "  2. Source: 'Deploy from a branch'"
say "  3. Branch: main    Folder: / (root)    then Save"
say "  4. wait about a minute, then open $URL"
say ""
say "Publishing is now ON. From here, the watcher (./live.sh) commits and"
say "pushes every change in this folder. Anything you drop in here becomes"
say "public within about a minute. Read the privacy note in PUBLISHING.md."
say ""
say "then run:  ./live.sh"
say "your site: $URL"
