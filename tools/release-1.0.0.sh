#!/usr/bin/env bash
#
# Publish Rivets 'n Ruin 1.0.0.
#
# Everything here was run and verified in the session that wrote this
# script, except the three network calls at the end, which that session
# was not permitted to make: tag pushes and release creation are both
# refused for it at the API gateway.
#
# Builds in a throwaway pristine checkout of the release commit, not in
# your working tree. That is not tidiness: Go stamps VCS state into every
# binary, and building with so much as one untracked file present marks
# the artifact vcs.modified=true and changes its checksum. The first cut
# of this script built in place and shipped binaries that described
# themselves as built from a dirty tree.
#
# Can be run from anywhere, including from inside the repository.
#
#   ./release-1.0.0.sh            build and verify, change nothing remote
#   ./release-1.0.0.sh --publish  the above, then tag and publish
#
set -euo pipefail

COMMIT=bc5137ccc41085f9c714070a279a15c55c0a3ae0   # Merge pull request #31
VERSION=1.0.0
REPO=rom/rivets_n_ruin
PUBLISH=${1:-}
NOTES=$(cd "$(dirname "$0")" && pwd)/RELEASE-NOTES-1.0.0.md

say() { printf '\n== %s\n' "$*"; }

ORIGIN=$(git rev-parse --show-toplevel 2>/dev/null || echo "https://github.com/$REPO")

say "cloning $COMMIT into a pristine tree"
BUILD=$(mktemp -d)
trap 'rm -rf "$BUILD"' EXIT
git clone --quiet --no-checkout "$ORIGIN" "$BUILD/src"
cd "$BUILD/src"
git checkout --quiet "$COMMIT"
[ -z "$(git status --porcelain)" ] || { echo "the fresh clone is dirty; refusing" >&2; exit 1; }

say "building the dist tree"
make dist >/dev/null
test -d build/dist/docs   || { echo "docs missing from the dist tree" >&2; exit 1; }
test -d build/dist/deploy || { echo "deploy missing from the dist tree" >&2; exit 1; }

say "packaging"
rm -rf build/rel && mkdir -p build/rel
( cd build
  mv dist "rivets-n-ruin-$VERSION-linux-amd64"
  tar czf "rel/rivets-n-ruin-$VERSION-linux-amd64.tar.gz" "rivets-n-ruin-$VERSION-linux-amd64"
  mv "rivets-n-ruin-$VERSION-linux-amd64" dist )

say "cross-compiling the server"
for t in linux/amd64 linux/arm64 darwin/amd64 darwin/arm64; do
  os=${t%/*}; arch=${t#*/}
  CGO_ENABLED=0 GOOS=$os GOARCH=$arch \
    go build -trimpath -ldflags '-s -w' -o "build/rel/rnr-server-$VERSION-$os-$arch" ./cmd/server
  printf '   %s\n' "$t"
done
( cd build/rel && sha256sum ./* > SHA256SUMS.txt )

# The bug this release exists to not ship. Running the archive the way
# its own README says to used to put the snapshot — password hashes and
# the token table — somewhere the static handler would serve it. Proven
# against the actual archive rather than the source tree, because the
# archive is what people download.
say "verifying the snapshot is not reachable over HTTP"
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
tar xzf "build/rel/rivets-n-ruin-$VERSION-linux-amd64.tar.gz" -C "$work"
( cd "$work/rivets-n-ruin-$VERSION-linux-amd64"
  ./rnr-server -addr 127.0.0.1:8499 -save-interval 2s >"$work/log" 2>&1 &
  echo $! > "$work/pid"
  sleep 2
  curl -sf -X POST http://127.0.0.1:8499/api/auth/register \
    -H 'content-type: application/json' \
    -d '{"name":"RELEASEGATE","password":"hunter2hunter2"}' >/dev/null
  sleep 4
  test -f data/rnr.json || { echo "no snapshot was written; the check proves nothing" >&2; exit 1; }

  fail=0
  for u in /data/rnr.json /data/rnr.json.runs /data/ /src/../data/rnr.json; do
    code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:8499$u")
    printf '   %-30s %s\n' "$u" "$code"
    [ "$code" = 404 ] || { echo "   LEAK: $u answered $code" >&2; fail=1; }
  done
  for u in / /src/game.js /docs/boss-01-thewarden.png /api/health; do
    code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:8499$u")
    printf '   %-30s %s\n' "$u" "$code"
    [ "$code" = 200 ] || { echo "   BROKEN: $u answered $code" >&2; fail=1; }
  done
  kill "$(cat "$work/pid")" 2>/dev/null || true
  [ "$fail" -eq 0 ] || { echo "release gate failed — not publishing" >&2; exit 1; }
)

say "artifacts"
cat build/rel/SHA256SUMS.txt

if [ "$PUBLISH" != "--publish" ]; then
  say "built and verified. Re-run with --publish to tag and release."
  exit 0
fi

# Back to the real repository: the clone above is about to be deleted,
# and a tag pushed from it would go nowhere useful.
cd "$ORIGIN"

say "tagging and publishing"
git tag -a "v$VERSION" "$COMMIT" -F - <<'TAG'
Rivets 'n Ruin 1.0.0

Twenty-five hulls, eight boss shapes, a backend with anti-cheat and
platform hardening, and a test suite that has caught more bugs than
play has.
TAG
git push origin "v$VERSION"
gh release create "v$VERSION" --repo "$REPO" --target "$COMMIT" \
  --title "Rivets 'n Ruin $VERSION" \
  --notes-file "$NOTES" \
  "$BUILD/src/build/rel"/*
say "published: https://github.com/$REPO/releases/tag/v$VERSION"
