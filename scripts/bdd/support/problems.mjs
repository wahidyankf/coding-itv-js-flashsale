// The defects the checker must reject, each with a phrase its failure message must contain. Every test layer reads
// this one list, so the three layers cannot disagree about which defects exist.
export const DEFECT_PROBLEMS = [
	["unit binding missing", "Liveness returns ok: no unit binding"],
	[
		"integration binding missing",
		"Liveness returns ok: no integration binding",
	],
	["unused binding", "unused unit binding: Ghost"],
	["template title", "dynamic scenario title"],
	["e2e step missing", 'no e2e step matches "a client asks for liveness"'],
	["e2e step unused", "unused e2e step"],
	["README link missing", "liveness.feature: not linked from README.md"],
	[
		"exemption comment missing",
		"Liveness returns ok: missing Exemption(e2e) comment",
	],
	["comment above a Background", "not directly above a scenario's tags"],
	["comment without proof", "malformed exemption comment"],
	[
		"proof names a missing scenario",
		"alternative-proof scenario not found: Ghost",
	],
	["exemption tag on the Feature", "exemption tag on Feature"],
	["unknown exemption tag", "unknown exemption tag @unit-exempt"],
	[
		"integration exemption still bound",
		"bound at integration although @integration-exempt",
	],
];
