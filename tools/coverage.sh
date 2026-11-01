#!/usr/bin/env bash
#
# Coverage gate for both sides, with the thresholds in one place so that
# `make coverage-gate` locally and the CI job give the same answer. A gate
# you cannot reproduce on your own machine is a gate people learn to
# ignore, and then to delete.
#
# Overridable so a bisect or a spike is not blocked by a number:
#   GO_MIN=70 JS_MIN=70 tools/coverage.sh

set -uo pipefail

# Raised as the suite grew, and deliberately a notch under where it
# actually sits: a floor set to the exact current number turns every
# unrelated refactor into a coverage failure, and a floor nobody can
# move without thinking is a floor people lower.
GO_MIN=${GO_MIN:-86}
JS_MIN=${JS_MIN:-89}
BUILD_DIR=${BUILD_DIR:-build}
GO=${GO:-go}
NODE=${NODE:-node}

mkdir -p "$BUILD_DIR"
report="$BUILD_DIR/coverage.txt"
: >"$report"

fail=0

say() { printf '%s\n' "$*" | tee -a "$report"; }

# --- Go
#
# cmd/server is excluded from the figure. It is main(): flag parsing, a
# listener and a signal handler, and the only way to cover it is to start
# the process, which is what `make smoke` already does end to end. Counting
# it would mean either a permanently depressed number or tests that assert
# nothing in order to raise one.
say "— go —"
if ! $GO test ./... -coverprofile="$BUILD_DIR/go.cover.all" -covermode=atomic >/dev/null 2>&1; then
  say "go tests failed; coverage is not meaningful"
  exit 1
fi
grep -v '^github.com/rom/rivets_n_ruin/cmd/server' "$BUILD_DIR/go.cover.all" >"$BUILD_DIR/go.cover"

$GO tool cover -func="$BUILD_DIR/go.cover" | awk '$1 != "total:" && $3+0 < 60 {
  printf "  thin: %s %s %s\n", $1, $2, $3
}' | sort -t'(' -k2 | head -20 | tee -a "$report"

go_pct=$($GO tool cover -func="$BUILD_DIR/go.cover" | awk '/^total:/ {gsub("%","",$3); print $3}')
say "  total ${go_pct}%  (floor ${GO_MIN}%, cmd/server excluded — see tools/coverage.sh)"
awk -v got="$go_pct" -v min="$GO_MIN" 'BEGIN { exit !(got + 0 < min + 0) }' && {
  say "  FAIL: go coverage ${go_pct}% is below ${GO_MIN}%"
  fail=1
}

# --- JavaScript
say ""
say "— javascript —"
js_out=$($NODE --test --experimental-test-coverage test/*.test.mjs 2>&1)
js_status=$?
if [ $js_status -ne 0 ]; then
  printf '%s\n' "$js_out" | grep -E '^not ok' | head -20 | tee -a "$report"
  say "js tests failed; coverage is not meaningful"
  exit 1
fi

# The summary line looks like:
#   # all files             |  69.64 |    87.16 |   74.16 |
js_pct=$(printf '%s\n' "$js_out" \
  | sed -n '/start of coverage report/,/end of coverage report/p' \
  | awk -F'|' '/^# all files/ { gsub(/ /,"",$2); print $2 }')

if [ -z "$js_pct" ]; then
  say "  could not read a coverage figure out of node's report"
  exit 1
fi

printf '%s\n' "$js_out" \
  | sed -n '/start of coverage report/,/end of coverage report/p' \
  | awk -F'|' '/^# src\// { gsub(/ /,"",$2); gsub(/ /,"",$1);
      if ($2 + 0 < 60) printf "  thin: %s %s%%\n", substr($1,3), $2 }' \
  | head -20 | tee -a "$report"

say "  total ${js_pct}%  (floor ${JS_MIN}%)"
awk -v got="$js_pct" -v min="$JS_MIN" 'BEGIN { exit !(got + 0 < min + 0) }' && {
  say "  FAIL: js coverage ${js_pct}% is below ${JS_MIN}%"
  fail=1
}

say ""
if [ "$fail" -ne 0 ]; then
  say "coverage gate failed"
  exit 1
fi
say "coverage gate passed"
