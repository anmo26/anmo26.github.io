#!/usr/bin/env bash
# ============================================================================
# guestbook-api — smoke test
#
#   ./test.sh <base-url> [allowed-origin]
#
# e.g.
#   ./test.sh https://garden-guestbook.yourname.workers.dev https://anmo.garden
#   ./test.sh http://127.0.0.1:8787                                  # the mock
#
# Talks to a live deployment with curl and checks the same things the browser
# will care about. Nothing here needs node, jq or any other tool.
#
# HEADS UP: this posts real notes, and the rate-limit check deliberately
# burns this machine's hourly allowance. Set ADMIN_TOKEN in the environment
# and the script deletes everything it created on the way out:
#
#   ADMIN_TOKEN=your-token ./test.sh https://... https://anmo.garden
#
# To try it without touching the live guestbook, start the local mock first:
#   node mock/harness.js --serve
#   ./test.sh http://127.0.0.1:8787 https://anmo.garden
# ============================================================================

set -uo pipefail

BASE="${1:-}"
ORIGIN="${2:-https://anmo.garden}"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"

if [ -z "$BASE" ]; then
  echo "usage: ./test.sh <base-url> [allowed-origin]" >&2
  exit 2
fi
BASE="${BASE%/}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
CREATED=()

blue()  { printf '\n\033[1m%s\033[0m\n' "$1"; }
check() { # check <label> <expected> <actual>
  if [ "$2" = "$3" ]; then
    PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"
  else
    FAIL=$((FAIL + 1)); printf '  FAIL %s (expected %s, got %s)\n' "$1" "$2" "$3"
  fi
}
contains() { # contains <label> <needle> <file>
  if grep -q -- "$2" "$3"; then
    PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"
  else
    FAIL=$((FAIL + 1)); printf '  FAIL %s (did not find %s)\n' "$1" "$2"
    printf '         body: %s\n' "$(head -c 300 "$3")"
  fi
}

# req <method> <path> <origin|-> <body-file|-> [extra curl args...]
# Writes the body to $TMP/body and headers to $TMP/head; echoes the status.
req() {
  local method="$1" path="$2" origin="$3" bodyfile="$4"; shift 4
  local args=(-sS -o "$TMP/body" -D "$TMP/head" -w '%{http_code}' -X "$method")
  [ "$origin" != "-" ] && args+=(-H "Origin: $origin")
  if [ "$bodyfile" != "-" ]; then
    args+=(-H 'Content-Type: application/json' --data-binary "@$bodyfile")
  fi
  curl "${args[@]}" "$@" "$BASE$path"
}

header() { # header <name> -> value, lowercased name, empty if absent
  tr -d '\r' < "$TMP/head" | awk -v k="$1" 'BEGIN{IGNORECASE=1} tolower($1)==tolower(k)":" {sub(/^[^:]*: ?/,""); print}'
}

NOTE_ID="smoke-$(date +%s)-$RANDOM"

echo "guestbook-api smoke test"
echo "  base:   $BASE"
echo "  origin: $ORIGIN"
echo "  note:   $NOTE_ID"

# --------------------------------------------------------------- preflight
blue "1. CORS preflight"
STATUS=$(req OPTIONS / "$ORIGIN" - -H 'Access-Control-Request-Method: POST')
check "OPTIONS returns 204" "204" "$STATUS"
check "allow-origin echoes the site, not '*'" "$ORIGIN" "$(header access-control-allow-origin)"
check "allow-methods includes POST" "0" "$(header access-control-allow-methods | grep -qi post; echo $?)"

# ------------------------------------------------------------------- write
blue "2. POST a note"
cat > "$TMP/note.json" <<JSON
{"id":"$NOTE_ID","name":"smoke test","body":"posted by test.sh at $(date -u +%FT%TZ)",
 "at":$(date +%s)000,"colour":3,"x":120,"y":80,"replies":[]}
JSON

STATUS=$(req POST / "$ORIGIN" "$TMP/note.json")
if [ "$STATUS" = "429" ]; then
  echo "  --"
  echo "  This IP has already used its hourly note allowance — which does prove"
  echo "  the rate limiter works, but the rest of the test cannot run. Wait for"
  echo "  the hour to roll over and try again."
  exit 1
fi
check "POST returns 201" "201" "$STATUS"
contains "the response carries the id the client chose" "$NOTE_ID" "$TMP/body"
CREATED+=("$NOTE_ID")

# -------------------------------------------------------------------- read
blue "3. GET it back"
STATUS=$(req GET / "$ORIGIN" -)
check "GET returns 200" "200" "$STATUS"
contains 'the payload is shaped { "notes": [...] }' '"notes"' "$TMP/body"
contains "the new note is in the list" "$NOTE_ID" "$TMP/body"

# ------------------------------------------------------------------ update
blue "4. PUT a reply"
REPLY="hello back $RANDOM"
cat > "$TMP/reply.json" <<JSON
{"id":"$NOTE_ID","name":"smoke test","body":"posted by test.sh",
 "at":$(date +%s)000,"colour":3,"x":300,"y":200,
 "replies":[{"name":"tester","body":"$REPLY","at":$(date +%s)000}]}
JSON

STATUS=$(req PUT "/$NOTE_ID" "$ORIGIN" "$TMP/reply.json")
check "PUT /<id> returns 200" "200" "$STATUS"
contains "the reply comes back on the note" "$REPLY" "$TMP/body"

STATUS=$(req GET / "$ORIGIN" -)
contains "the reply was actually stored" "$REPLY" "$TMP/body"
contains "the drag position was stored" '"x":300' "$TMP/body"

# -------------------------------------------------------------- validation
blue "5. Validation"
{ printf '{"id":"too-big","name":"x","body":"'; head -c 4000 /dev/zero | tr '\0' 'a'; printf '","at":0,"colour":0,"x":0,"y":0,"replies":[]}'; } > "$TMP/big.json"
STATUS=$(req POST / "$ORIGIN" "$TMP/big.json")
check "a body over ~2KB is refused with 413" "413" "$STATUS"

printf '{"id":"nan-test","name":"x","body":"hi","at":0,"colour":0,"x":"over there","y":0,"replies":[]}' > "$TMP/nan.json"
STATUS=$(req POST / "$ORIGIN" "$TMP/nan.json")
check "a non-numeric x is refused with 400" "400" "$STATUS"

printf 'not json at all' > "$TMP/junk.json"
STATUS=$(req POST / "$ORIGIN" "$TMP/junk.json")
check "malformed json is refused with 400" "400" "$STATUS"

# --------------------------------------------------------------- bad origin
blue "6. CORS rejects an origin that is not on the list"
STATUS=$(req POST / "https://evil.example" "$TMP/note.json")
check "a POST from an unknown origin is refused with 403" "403" "$STATUS"
check "...and gets no allow-origin header" "" "$(header access-control-allow-origin)"

STATUS=$(req GET / "https://evil.example" -)
check "a GET from an unknown origin is refused too" "403" "$STATUS"

STATUS=$(req OPTIONS / "https://evil.example" - -H 'Access-Control-Request-Method: POST')
check "preflight from an unknown origin gets no allow-origin" "" "$(header access-control-allow-origin)"

# -------------------------------------------------------------- moderation
blue "7. Moderation is behind the token"
STATUS=$(req DELETE "/$NOTE_ID" "$ORIGIN" -)
check "DELETE without a token is 401" "401" "$STATUS"

STATUS=$(req DELETE "/$NOTE_ID" "$ORIGIN" - -H 'Authorization: Bearer definitely-not-the-token')
check "DELETE with a wrong token is 401" "401" "$STATUS"

# ------------------------------------------------------------- rate limits
blue "8. Rate limiting (this uses up the hourly allowance on purpose)"
LIMITED=0
for i in 1 2 3 4 5 6 7; do
  ID="smoke-rl-$(date +%s)-$i-$RANDOM"
  sed "s/\"id\":\"[^\"]*\"/\"id\":\"$ID\"/" "$TMP/note.json" > "$TMP/rl.json"
  STATUS=$(req POST / "$ORIGIN" "$TMP/rl.json")
  printf '  attempt %s -> %s\n' "$i" "$STATUS"
  if [ "$STATUS" = "201" ]; then CREATED+=("$ID"); fi
  if [ "$STATUS" = "429" ]; then LIMITED=1; break; fi
done
check "repeated posting is eventually refused with 429" "1" "$LIMITED"
if [ "$LIMITED" = "1" ]; then
  RA="$(header retry-after)"
  check "the 429 carries a Retry-After header" "0" "$([ -n "$RA" ]; echo $?)"
  echo "         retry after: ${RA:-none} seconds"
fi

# ----------------------------------------------------------------- cleanup
blue "9. Cleanup"
if [ -n "$ADMIN_TOKEN" ]; then
  for id in "${CREATED[@]}"; do
    STATUS=$(req DELETE "/$id" "$ORIGIN" - -H "Authorization: Bearer $ADMIN_TOKEN")
    printf '  deleted %s -> %s\n' "$id" "$STATUS"
  done
  check "the notes this test made are gone" "0" "0"
else
  echo "  ADMIN_TOKEN not set, so these test notes are still in the guestbook:"
  for id in "${CREATED[@]}"; do echo "    $id"; done
  echo "  Delete them with:"
  echo "    ADMIN_TOKEN=... ./test.sh $BASE $ORIGIN    # re-runs and cleans up"
  echo "  or one at a time:"
  echo "    curl -X DELETE -H \"Authorization: Bearer \$ADMIN_TOKEN\" $BASE/<id>"
fi

# ------------------------------------------------------------------ report
echo
echo "======================================================"
echo "$PASS passed, $FAIL failed"
echo "======================================================"
[ "$FAIL" -eq 0 ] || exit 1
