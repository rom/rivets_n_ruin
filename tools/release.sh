#!/usr/bin/env bash
#
# Build, attack and publish a release.
#
# Builds in a throwaway pristine checkout of the release commit, not in
# your working tree. That is not tidiness: Go stamps VCS state into
# every binary, and building with so much as one untracked file present
# marks the artifact vcs.modified=true and changes its checksum. An
# earlier version built in place and shipped binaries that described
# themselves as built from a dirty tree.
#
# Takes the version rather than hard-coding it. The first one was
# release-1.0.0.sh, which answered the question "what do we do for
# 1.1.0" with "copy the file", and a release process you copy is one
# that drifts.
#
#   tools/release.sh 1.1.0                  build and verify, change nothing
#   tools/release.sh 1.1.0 --publish        the above, then tag and publish
#   tools/release.sh 1.1.0 <sha> --publish  from a commit other than origin/rom
#
set -euo pipefail

REPO=rom/rivets_n_ruin
HERE=$(cd "$(dirname "$0")" && pwd)

VERSION=${1:-}
if [ -z "$VERSION" ]; then
  echo "usage: $0 <version> [commit] [--publish]" >&2
  exit 1
fi
shift

COMMIT=""
PUBLISH=""
for arg in "$@"; do
  case "$arg" in
    --publish) PUBLISH=--publish ;;
    *) COMMIT=$arg ;;
  esac
done

NOTES=$HERE/RELEASE-NOTES-$VERSION.md
if [ ! -f "$NOTES" ]; then
  echo "no release notes at $NOTES — write them first; a release with no notes is a tag" >&2
  exit 1
fi

say() { printf '\n== %s\n' "$*"; }

ORIGIN=$(git rev-parse --show-toplevel 2>/dev/null || echo "https://github.com/$REPO")

# Default to whatever is on the default branch right now, resolved to a
# sha so the rest of the run cannot drift if someone pushes mid-build.
if [ -z "$COMMIT" ]; then
  git -C "$ORIGIN" fetch --quiet origin rom
  COMMIT=$(git -C "$ORIGIN" rev-parse origin/rom)
fi

# The version in the source has to match the one being released, or the
# splash screen and the tag disagree and nobody can tell which build
# they are looking at.
declared=$(grep -oE "VERSION = '[^']+'" "$ORIGIN/src/config.js" | head -1 | cut -d"'" -f2)
if [ "$declared" != "$VERSION" ]; then
  echo "src/config.js says $declared, you asked for $VERSION" >&2
  exit 1
fi

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
# Never through a proxy. The gate talks to a server on loopback, and a
# machine with http_proxy set — a CI runner, a corporate laptop, this
# container — sends even 127.0.0.1 through it and gets a refusal that
# looks exactly like the server failing to start.
#
# A function, NOT an exported no_proxy. Exporting it applies to every
# later command in the script including `git push`, which on a machine
# whose credentials are injected by that same proxy then cannot
# authenticate — the publish failed with "could not read Username" and
# the cause was four lines up from the thing that broke.
curl() { command curl --noproxy '*' "$@"; }
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
  # The gate is only worth anything if the credential it is hunting for
  # is actually on disk. The default layout moved when the server split
  # its roots, and this check kept passing against a file that no longer
  # existed until it was made to say so.
  test -s accounts/accounts.json \
    || { echo "no account database was written; the check proves nothing" >&2; exit 1; }
  grep -q pbkdf2 accounts/accounts.json \
    || { echo "the account database holds no hash; the check proves nothing" >&2; exit 1; }

  fail=0
  # Everything the server writes, plus the spellings that reach it by
  # another route, plus the pre-split paths in case a build ever goes
  # back to them.
  for u in /accounts/accounts.json /accounts/ /accounts /state/scores.json \
           /state/runs.json /state/ /src/../accounts/accounts.json \
           //accounts/accounts.json /data/rnr.json; do
    # Follow redirects and judge where the request LANDS. net/http
    # cleans a doubled slash with a 301, so //accounts/accounts.json
    # answers 301 and then 404 — refusing the hop rather than the
    # destination would fail the gate on a path that is already closed.
    code=$(curl -sL -o "$work/body" -w '%{http_code}' "http://127.0.0.1:8499$u")
    printf '   %-34s %s\n' "$u" "$code"
    [ "$code" = 404 ] || { echo "   LEAK: $u answered $code" >&2; fail=1; }
    # The status is a proxy for the thing that matters. This is the
    # thing that matters.
    if grep -q pbkdf2 "$work/body" 2>/dev/null; then
      echo "   LEAK: $u returned a password hash" >&2; fail=1
    fi
  done
  for u in / /src/game.js /src/game.css /docs/boss-01-thewarden.png /api/health; do
    code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:8499$u")
    printf '   %-34s %s\n' "$u" "$code"
    [ "$code" = 200 ] || { echo "   BROKEN: $u answered $code" >&2; fail=1; }
  done
  kill "$(cat "$work/pid")" 2>/dev/null || true
  [ "$fail" -eq 0 ] || { echo "release gate failed — not publishing" >&2; exit 1; }
)

# The toolchain goes in the log, because the checksums below only
# reproduce under the same one. Someone rebuilding with a different Go
# gets a different binary from identical source, which looks exactly
# like a tampered download. Caught while verifying 1.1.0: the release
# was built with go1.27.2 and the notes claimed 1.24.7.
say "built with $(go version)"

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
# A tag may already be here from a run whose push failed. Reuse it if
# it names the right commit and refuse if it does not, rather than
# dying with "already exists" and leaving the operator to work out
# which of the two it is. Hit twice while publishing 1.1.0: the push
# is the step most likely to fail, and it is the step after this one.
if existing=$(git rev-parse -q --verify "refs/tags/v$VERSION^{commit}"); then
  if [ "$existing" != "$COMMIT" ]; then
    echo "a local tag v$VERSION already points at $existing, not $COMMIT." >&2
    echo "delete it (git tag -d v$VERSION) if it is a leftover, or publish that commit." >&2
    exit 1
  fi
  say "reusing the existing v$VERSION tag"
else
  git tag -a "v$VERSION" "$COMMIT" -F - <<TAG
Rivets 'n Ruin $VERSION

$(head -1 "$NOTES")
TAG
fi
git push origin "v$VERSION"
gh release create "v$VERSION" --repo "$REPO" --target "$COMMIT" \
  --title "Rivets 'n Ruin $VERSION" \
  --notes-file "$NOTES" \
  "$BUILD/src/build/rel"/*
say "published: https://github.com/$REPO/releases/tag/v$VERSION"
