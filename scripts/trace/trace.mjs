// Traces one request through the production stack by its request id: the lines nginx, flash-web and the API instances
// logged for it, in time order. The id is the `x-request-id` of the reply the browser or the caller got.
// Usage: npm run prod:trace -- <request id> [--project <name>] [--file <compose file>]
//   e.g. npm run prod:trace -- <id> --project flash-smoke   (the stack of `npm run smoke:prod`, while it runs)
import path from "node:path";
import { attempt } from "@flash/typekit";
import { composeFor } from "../smoke/docker.mjs";
import {
	linesWithId,
	parseTraceArgs,
	TRACED_SERVICES,
	USAGE,
} from "./trace-lines.mjs";

// The exit codes: the arguments were wrong, or the logs hold no line with the id.
const EXIT = { usage: 2, notFound: 1 };

const root = path.resolve(import.meta.dirname, "../..");

const parsed = parseTraceArgs(process.argv.slice(2));
if (parsed.isErr()) {
	console.error(`prod:trace: ${parsed.error}`);
	console.error(USAGE);
	process.exit(EXIT.usage);
}
const { id, project, file } = parsed.value;
const where = project === undefined ? file : `${file} (project ${project})`;

const stack = composeFor({ root, env: process.env, project, file });
// Compose prints its own reason on a failure, such as a service the file does not have, before this line.
const read = attempt(
	() => stack.run("logs", "--no-color", "--timestamps", ...TRACED_SERVICES),
	Error,
);
if (read.isErr()) {
	console.error(`prod:trace: could not read the logs of ${where}`);
	process.exit(EXIT.notFound);
}

if (read.value.trim() === "") {
	console.error(
		`prod:trace: the logs of ${where} are empty. Is the stack running?`,
	);
	process.exit(EXIT.notFound);
}
const lines = linesWithId(read.value, id);
if (lines.length === 0) {
	console.error(
		`prod:trace: no line of ${TRACED_SERVICES.join(", ")} in ${where} holds the request id ${id}`,
	);
	process.exit(EXIT.notFound);
}
for (const line of lines) console.log(line);
