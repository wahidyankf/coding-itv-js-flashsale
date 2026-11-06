// Fails when docs/reference/openapi.json is not what the routes of flash-be produce now.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const committed = "docs/reference/openapi.json";
const dir = mkdtempSync(path.join(tmpdir(), "openapi-"));
const fresh = path.join(dir, "openapi.json");
try {
	execFileSync(
		"npm",
		["run", "--silent", "openapi", "-w", "flash-be", "--", fresh],
		{
			stdio: "inherit",
		},
	);
	if (readFileSync(fresh, "utf8") !== readFileSync(committed, "utf8")) {
		console.error(`${committed} is out of date. Run: npm run openapi:generate`);
		process.exitCode = 1;
	} else {
		console.log(`${committed} is up to date`);
	}
} finally {
	rmSync(dir, { recursive: true, force: true });
}
