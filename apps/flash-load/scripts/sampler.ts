// Samples Postgres while k6 runs: how many sessions wait for a lock, how many are active, and how many sit inside a
// transaction. A hot sale row or an exhausted pool shows up here. The sampler asks again as soon as each answer is in,
// so the number of samples depends on how fast psql answers. Part of the load runner in scripts/.
import { spawn } from "node:child_process";
import { composeArgs, psqlArgs } from "./compose.ts";

// One reading of the Postgres sessions, taken while k6 runs. The report keeps the worst value of each count.
export type Sample = { locked: number; active: number; idle: number };

// A running sampler. stop() ends the asking and returns every sample, so the report can show how the database behaved.
export type Sampler = {
	// Stops asking and resolves with every sample taken so far.
	stop(): Promise<Sample[]>;
};

const SESSIONS_QUERY =
	"select count(*) filter (where wait_event_type = 'Lock'), count(*) filter (where state = 'active'), " +
	"count(*) filter (where state = 'idle in transaction') from pg_stat_activity where datname = 'flash'";

// Starts asking Postgres for the session counts until stop() is called.
export function startSampler(): Sampler {
	const samples: Sample[] = [];
	let sampling = true;
	const loop = (async () => {
		while (sampling) {
			const sample = parseSample(await probeSessions());
			if (sample) samples.push(sample);
		}
	})();
	return {
		async stop() {
			sampling = false;
			await loop;
			return samples;
		},
	};
}

// One probe: a psql call in the postgres container. Resolves with its output.
function probeSessions(): Promise<string> {
	return new Promise((resolve) => {
		const probe = spawn("docker", composeArgs(psqlArgs(SESSIONS_QUERY)), {
			stdio: ["ignore", "pipe", "ignore"],
		});
		let out = "";
		probe.stdout.on("data", (chunk: Buffer) => {
			out += chunk.toString();
		});
		probe.on("close", () => resolve(out));
	});
}

// Reads the three counts from one line of psql output, "locked|active|idle". Undefined when the line has another shape.
export function parseSample(out: string): Sample | undefined {
	const match = /^(\d+)\|(\d+)\|(\d+)$/m.exec(out);
	if (!match) return undefined;
	return {
		locked: Number(match[1]),
		active: Number(match[2]),
		idle: Number(match[3]),
	};
}
