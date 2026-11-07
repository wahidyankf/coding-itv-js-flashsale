// The one place that talks to the load stack: `docker compose` on this app's compose.yaml, and the commands run inside
// its containers (psql, redis-cli). Every compose call goes through here, so the compose file, the exec arguments and
// the report paths are each written once. Part of the load runner in scripts/.
import { spawnSync } from "node:child_process";
import path from "node:path";

const APP_ROOT = path.resolve(import.meta.dirname, "..");
// The compose file of the load stack. Every docker compose call names it.
export const COMPOSE_FILE = path.join(APP_ROOT, "compose.yaml");
// Where the reports go. compose.yaml mounts the same folder into the k6 container as /reports.
export const REPORTS_DIR = path.resolve(
	APP_ROOT,
	"../../generated-reports/load",
);

// 256 MiB. A long k6 log and the container logs come back through one call, so the buffer is large.
const MAX_COMPOSE_OUTPUT_BYTES = 268_435_456;
// Stops the stack and removes its volumes and orphan containers. A run begins with it and ends with it, unless --keep.
export const TEAR_DOWN_ARGS = ["down", "-v", "--remove-orphans"];
// psql as the flash role on the flash database: unaligned output, no headers. The query is the last argument.
const PSQL_ARGS = ["psql", "-U", "flash", "-d", "flash", "-tA", "-c"];

// The outcome of one docker compose command. A failed command has a status here rather than an exception, so cleanup
// can still run after it.
export type ComposeResult = {
	status: number | null;
	stdout: string;
	stderr: string;
};

// The `docker compose` arguments of one command run inside a service's container, without a terminal (`-T`).
export function execArgs(
	service: string,
	command: readonly string[],
): string[] {
	return ["exec", "-T", service, ...command];
}

// The arguments after `docker` for one `docker compose` command on this stack.
export function composeArgs(args: readonly string[]): string[] {
	return ["compose", "-f", COMPOSE_FILE, ...args];
}

// The `docker compose` arguments of one psql query inside the postgres container.
export function psqlArgs(query: string): string[] {
	return execArgs("postgres", [...PSQL_ARGS, query]);
}

// Runs one `docker compose` command and waits for it. The output is captured, and a failed command is a status, not
// an exception, so cleanup can run after a failure.
export function composeExec(args: readonly string[]): ComposeResult {
	const run = spawnSync("docker", composeArgs(args), {
		encoding: "utf8",
		maxBuffer: MAX_COMPOSE_OUTPUT_BYTES,
	});
	return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

// Runs one `docker compose` command that must succeed, and returns its output. A failed command throws.
export function composeOutput(args: readonly string[]): string {
	const run = composeExec(args);
	if (run.status !== 0) {
		throw new Error(`docker compose ${args.join(" ")} failed:\n${run.stderr}`);
	}
	return run.stdout;
}

// Runs one query inside the postgres container and returns its output, trimmed.
export function psql(query: string): string {
	return composeOutput(psqlArgs(query)).trim();
}

// Stops or starts the redis container. The chaos timers and the run's cleanup both use it.
export function composeRedis(action: "start" | "stop"): ComposeResult {
	return composeExec([action, "redis"]);
}

// The k6 summary file of a profile. k6 writes it to /reports in its container, which is REPORTS_DIR on the host.
export function k6SummaryFile(name: string): string {
	return `${name}-k6.json`;
}

// The host path of a file in the reports folder.
export function reportPath(file: string): string {
	return path.join(REPORTS_DIR, file);
}
