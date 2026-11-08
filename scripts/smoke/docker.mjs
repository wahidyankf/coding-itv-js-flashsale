// The Docker side of the production smoke test (scripts/smoke/prod.mjs): a free host port for the stack, the compose
// commands of one project, and how Docker sees the container of a service.
import { execFileSync, spawnSync } from "node:child_process";
import net from "node:net";

// The most a command may print. The logs of a whole walk pass Node's default of 1 MiB, which would stop the run.
const MAX_OUTPUT_BYTES = 67_108_864; // 64 MiB

// A host port nothing listens on now, so the smoke stack never takes the port of a stack that is already running.
export async function freePort() {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			server.close(() => resolve(port));
		});
	});
}

// The compose commands of one project and file, run from `root` with `env`, so every step talks to the same stack. With
// no `project`, compose takes the name the file gives.
export function composeFor({ root, env, project, file }) {
	const named = project === undefined ? [] : ["-p", project];
	const args = (words) => ["compose", ...named, "-f", file, ...words];

	// Runs a command and returns what it printed. A failed command throws, which stops the walk.
	const run = (...words) =>
		execFileSync("docker", args(words), {
			cwd: root,
			env,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "inherit"],
			maxBuffer: MAX_OUTPUT_BYTES,
		});

	// Runs a command whose failure is an answer, not a stop: says whether it exited with 0.
	const succeeds = (...words) =>
		spawnSync("docker", args(words), { cwd: root, env, stdio: "ignore" })
			.status === 0;

	// How often Docker has started the container of a service again, and whether it is running and healthy now.
	const state = (service) => {
		const id = run("ps", "-a", "-q", service).trim();
		const [restarts, status, health] = execFileSync(
			"docker",
			[
				"inspect",
				"-f",
				"{{.RestartCount}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}",
				id,
			],
			{ encoding: "utf8" },
		)
			.trim()
			.split(" ");
		return {
			restarts: Number(restarts),
			up: status === "running" && health === "healthy",
		};
	};

	return { run, succeeds, state };
}
