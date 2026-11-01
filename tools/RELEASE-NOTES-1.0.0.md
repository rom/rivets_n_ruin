Twenty-five hulls, eight boss shapes, a backend with anti-cheat and platform hardening, and a test suite that has caught more bugs than play has.

A side-scrolling shoot 'em up in the Uridium / Jets'n'Guns line. Canvas 2D, plain ES modules, no build step and no client dependencies; the server is Go with nothing but the standard library.

## Running it

Download the archive, extract it, and run the binary from inside:

```bash
tar xzf rivets-n-ruin-1.0.0-linux-amd64.tar.gz
cd rivets-n-ruin-1.0.0-linux-amd64
./rnr-server
```

Then open http://127.0.0.1:8000/. Nothing else is needed — the tree carries the game, the docs and a hardened systemd unit.

For anything that will take real players, put the snapshot outside the web root; the server says so at startup if you have not:

```bash
./rnr-server -data /var/lib/rivets-n-ruin/rnr.json
```

## Artifacts

| file | what |
| --- | --- |
| `rivets-n-ruin-1.0.0-linux-amd64.tar.gz` | ready to run: binary, game, docs, unit file |
| `rnr-server-1.0.0-linux-amd64` | server only |
| `rnr-server-1.0.0-linux-arm64` | server only |
| `rnr-server-1.0.0-darwin-amd64` | server only |
| `rnr-server-1.0.0-darwin-arm64` | server only |
| `SHA256SUMS.txt` | checksums for all of the above |

The server-only builds are static and `CGO_ENABLED=0`; point them at the game with `-dir`.

## Security

Two fixes landed while this release was being packaged, both found by running the artifact rather than by reading the code.

**The persistence snapshot was served over HTTP.** `-dir` defaults to `.` and `-data` to `data/rnr.json` underneath it, so running the tree as documented put the snapshot in the served directory, where `GET /data/rnr.json` returned it — PBKDF2 password hashes and the token table included. The `0600` file mode did nothing about it, because the web server is the file's owner. The static handler now refuses the snapshot, its sidecars and the directory holding it, resolving paths the way `net/http` does so a traversal cannot walk around it.

**The archive was not self-contained.** It carried none of the 63 images its own README references, nor the systemd unit the README points at.

If you built from source between the `1.0.0` version bump and this tag, your server has the first of those. This tag does not.

## Hardening

On Linux the server drops what it can back to the kernel after binding: Landlock, `PR_SET_NO_NEW_PRIVS` and `PR_SET_DUMPABLE`, each applied across every thread — the per-thread flags were the subtle part, and getting it wrong reported success while hardening one thread in eight. macOS does what it can and says plainly what is unavailable rather than pretending. `deploy/rivets-n-ruin.service` covers what a process cannot do to itself.

---

Built reproducibly from `bc5137c` in a pristine checkout (Go 1.24.7, `CGO_ENABLED=0 -trimpath`). Verify with `sha256sum -c SHA256SUMS.txt`.
