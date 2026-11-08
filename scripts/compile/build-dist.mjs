// The `build` script of flash-be, typekit and flash-commons: `node ../../scripts/build/build-dist.mjs`, run in the
// package folder. It runs `tsc -p tsconfig.build.json`, then deletes what that build did not write (see prune-dist.mjs).
// It never empties `dist` first, because other builds and type checks read these folders while this one runs.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import {
	parseEmittedFiles,
	pruneDist,
	withoutEmittedFiles,
} from "./prune-dist.mjs";

const OUT_DIR = "dist";
const FAILED = 1;
// The package only exports its library entry, so the compiler script is found next to it.
const tsc = path.join(
	path.dirname(createRequire(import.meta.url).resolve("typescript")),
	"../bin/tsc",
);

const build = spawnSync(
	process.execPath,
	[tsc, "-p", "tsconfig.build.json", "--listEmittedFiles"],
	{ encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] },
);
process.stdout.write(withoutEmittedFiles(build.stdout ?? ""));

const emitted = parseEmittedFiles(build.stdout ?? "");
if (build.status !== 0) {
	process.exit(build.status ?? FAILED);
}
// No emitted files means the list was not read, and pruning on it would delete a good build.
if (emitted.length === 0) {
	process.stderr.write(
		"build-dist: tsc listed no emitted files, so nothing was pruned\n",
	);
	process.exit(FAILED);
}
pruneDist(path.resolve(OUT_DIR), emitted);
