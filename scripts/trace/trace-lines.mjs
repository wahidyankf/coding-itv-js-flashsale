// The pure part of the trace script (scripts/trace/trace.mjs): which arguments it takes, and which log lines it keeps
// and in what order. No I/O, so the tests next to it need no Docker.
// `npm run prod:trace` builds flash-commons and typekit first, so the imports resolve to their dist.
import { isUuid } from "@flash/flash-commons";
import { Err, Ok } from "@flash/typekit";

// The compose file the trace reads by default: the production stack.
export const DEFAULT_FILE = "compose.prod.yaml";

// The services one request passes through, whose logs the trace reads. Postgres and Redis log no request id.
export const TRACED_SERVICES = [
	"nginx",
	"flash-web",
	"flash-be-1",
	"flash-be-2",
	"flash-be-3",
];

// How to call the trace, printed with every refusal of the arguments.
export const USAGE =
	"usage: npm run prod:trace -- <request id> [--project <name>] [--file <compose file>]";

// The options that take a value, by flag, and the field each one fills.
const OPTIONS = { "--project": "project", "--file": "file" };

// A line of `docker compose logs --timestamps`: the service prefix, a bar, then the time the line was written.
const TIMED_LINE = /^\S+\s+\|\s(\d{4}-\d{2}-\d{2}T\S+)\s/;
// Sorts after every timestamp, so a line with no time of its own comes last.
const NO_TIME = "~";

// Orders two times by their characters. The timestamps have one fixed width, so this is time order; a locale order is
// not, because it puts `~` before the digits.
function byTime(a, b) {
	if (a.time < b.time) return -1;
	if (a.time > b.time) return 1;
	return 0;
}

// Reads the arguments of the trace: one request id, which must be a UUID, and an optional project and compose file.
// Returns the settings, or a sentence that says what is wrong. The id is kept in lower case, as the stack writes it.
export function parseTraceArgs(argv) {
	const settings = { id: undefined, project: undefined, file: DEFAULT_FILE };
	const ids = [];
	for (let index = 0; index < argv.length; index += 1) {
		const word = argv[index];
		if (word.startsWith("--")) {
			const field = OPTIONS[word];
			if (field === undefined) return new Err(`unknown option ${word}`);
			const value = argv[index + 1];
			if (value === undefined || value.startsWith("--")) {
				return new Err(`${word} needs a value`);
			}
			settings[field] = value;
			index += 1;
		} else {
			ids.push(word);
		}
	}
	if (ids.length !== 1) return new Err("give one request id");
	const [id] = ids;
	if (!isUuid(id)) return new Err(`not a UUID: "${id}"`);
	return new Ok({ ...settings, id: id.toLowerCase() });
}

// The lines of `docker compose logs --timestamps` that hold the id, in the order they were written. Each line keeps its
// compose prefix, which names the service. Compose prints the services side by side, so the lines are sorted by time.
export function linesWithId(output, id) {
	const wanted = id.toLowerCase();
	return output
		.split("\n")
		.filter((line) => line.toLowerCase().includes(wanted))
		.map((line) => ({ line, time: TIMED_LINE.exec(line)?.[1] ?? NO_TIME }))
		.sort(byTime)
		.map(({ line }) => line);
}
