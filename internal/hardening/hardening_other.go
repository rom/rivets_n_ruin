//go:build !linux && !darwin

package hardening

// Everywhere else gets the portable checks and an honest list of what
// was not applied. Naming the platform matters: "unavailable" with no
// reason is the kind of line people stop reading.
// Supported mirrors the Linux build's reporting so callers and tests do
// not need a build tag of their own.
func Supported() bool { return false }

func applyPlatform(cfg Config, rep *Report) error {
	rep.Skipped = append(rep.Skipped,
		"no_new_privs, non-dumpable and a filesystem sandbox "+
			"(this platform exposes none of them to a Go stdlib binary)")
	return nil
}
