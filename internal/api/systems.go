package api

// The permanent systems a pilot can own, mirrored from the game.
//
// The game defines these in src/shop.js and the server has never needed
// to know them: a hangar is a map of id to level, and the store clamps
// the level and stores whatever id it is given. That is right for the
// pilot's own client, which can only send ids its own code knows.
//
// The operator tool is the case it is wrong for. An operator granting
// somebody a system has to type an id, and a typo there writes a
// system the game will never read — the kind of fault that looks like
// the grant simply did not work. So the list lives here too, and a
// parity test keeps it in step with src/shop.js, the same arrangement
// internal/validate uses for the game's physics constants.
//
// Name and tiers are here for the page to render: an operator should
// pick EXTRA MOUNT from a list and see that it stops at 2, not look up
// `mount` and guess.
type System struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Tiers int    `json:"tiers"`
}

var Systems = []System{
	{"magnet", "LODESTONE", 3},
	{"plating", "ABLATIVE PLATING", 1},
	{"autoloader", "AUTOLOADER", 1},
	{"scavenger", "SCAVENGER RIG", 3},
	{"afterburner", "AFTERBURNER", 1},
	{"reclaimer", "RECLAIMER", 1},
	{"mount", "EXTRA MOUNT", 2},
	{"drone", "DRONE WING", 2},
	{"pointdef", "POINT DEFENCE", 1},
	{"regen", "CELL REGENERATOR", 2},
	{"rear", "REAR BATTERY", 1},
	{"lance", "SPINAL LANCE", 2},
	{"siege", "SIEGE FRAME", 1},
}
