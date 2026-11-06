// Runs one load profile end to end: starts the stack, seeds a sale, runs k6, then checks Postgres and Redis.
// Usage: node scripts/run.ts <smoke|full|chaos|burst|contention> [--keep]
// The verdict comes from Postgres and Redis, not from what k6 says it did. k6 is compared with them.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
	LIMITS,
	PROFILE_NAMES,
	PROFILES,
	type Profile,
	type ProfileName,
} from "../k6/profiles.ts";
import { bundleShop } from "./bundle.ts";

const MS_PER_SECOND = 1000;
// 256 MiB. A long k6 log and the container logs come back through one call, so the buffer is large.
const MAX_COMPOSE_OUTPUT_BYTES = 268_435_456;
// The instances cache the current sale for up to a second; the run waits a little longer before it starts k6.
const SALE_CACHE_SETTLE_MS = 2500;
// After k6 ends, the stack gets this long to finish what it had in flight before the data is read.
const STACK_SETTLE_MS = 2000;
// The seeded sale lasts longer than any profile.
const SEED_DURATION_MINUTES = 30;
// The API instances in apps/flash-load/compose.yaml.
const INSTANCE_COUNT = 3;

const root = path.resolve(import.meta.dirname, "..");
const reports = path.resolve(root, "../../generated-reports/load");

const args = process.argv.slice(2);
const keep = args.includes("--keep");
// Runs the profile without stopping Redis, as a control for the chaos profile.
const calm = args.includes("--calm");
const requested = args.find((arg) => !arg.startsWith("--"));
if (!requested || !PROFILE_NAMES.includes(requested as ProfileName)) {
	console.error(
		`Usage: node scripts/run.ts <${PROFILE_NAMES.join("|")}> [--keep] [--calm]`,
	);
	process.exit(2);
}
const name = requested as ProfileName;
const profile: Profile = PROFILES[name];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function docker(...words: string[]): {
	status: number | null;
	stdout: string;
	stderr: string;
} {
	const run = spawnSync(
		"docker",
		["compose", "-f", path.join(root, "compose.yaml"), ...words],
		{ encoding: "utf8", maxBuffer: MAX_COMPOSE_OUTPUT_BYTES },
	);
	return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

function must(...words: string[]): string {
	const run = docker(...words);
	if (run.status !== 0) {
		throw new Error(`docker compose ${words.join(" ")} failed:\n${run.stderr}`);
	}
	return run.stdout;
}

const sql = (query: string) =>
	must(
		"exec",
		"-T",
		"postgres",
		"psql",
		"-U",
		"flash",
		"-d",
		"flash",
		"-tA",
		"-c",
		query,
	).trim();

type Row = { check: string; expected: string; actual: string; pass: boolean };
const rows: Row[] = [];
function judge(check: string, expected: string, actual: string, pass: boolean) {
	rows.push({ check, expected, actual, pass });
}

function metric(
	summary: unknown,
	key: string,
	field: string,
): number | undefined {
	const entry = (
		summary as { metrics?: Record<string, Record<string, unknown>> }
	).metrics?.[key];
	const values = (entry?.values ?? entry) as
		| Record<string, unknown>
		| undefined;
	const value = values?.[field];
	return typeof value === "number" ? value : undefined;
}

async function main(): Promise<number> {
	mkdirSync(reports, { recursive: true });
	console.log(`load: profile ${name}`, JSON.stringify(profile));

	must("down", "-v", "--remove-orphans");
	console.log("load: building and starting the stack");
	must("up", "-d", "--build", "--wait");

	const seeded = must(
		"exec",
		"-T",
		"flash-be-1",
		"node",
		"dist/seed-sale.js",
		"--stock",
		String(profile.stock),
		"--hold-seconds",
		String(profile.holdSeconds),
		"--admit-per-second",
		String(profile.admitPerSecond),
		"--duration-minutes",
		String(SEED_DURATION_MINUTES),
	);
	const saleId = /seeded sale (\S+)/.exec(seeded)?.[1];
	if (!saleId)
		throw new Error(`the seed command printed no sale id: ${seeded}`);
	console.log(
		`load: sale ${saleId}, stock ${profile.stock}, ${profile.users} shoppers`,
	);
	// The instances read the current sale on a short cache; give them a moment.
	await sleep(SALE_CACHE_SETTLE_MS);

	// Chaos: stop Redis and start it again while shoppers are arriving.
	const timers: NodeJS.Timeout[] = [];
	const events: string[] = [];
	if (profile.redisStopsAtSeconds !== undefined && !calm) {
		timers.push(
			setTimeout(() => {
				events.push(`Redis stopped at +${profile.redisStopsAtSeconds}s`);
				docker("stop", "redis");
			}, profile.redisStopsAtSeconds * MS_PER_SECOND),
		);
	}
	if (profile.redisStartsAtSeconds !== undefined && !calm) {
		timers.push(
			setTimeout(() => {
				events.push(`Redis started at +${profile.redisStartsAtSeconds}s`);
				docker("start", "redis");
			}, profile.redisStartsAtSeconds * MS_PER_SECOND),
		);
	}

	// While k6 runs, ask Postgres over and over how many sessions wait for a lock, how many are active and how many sit
	// inside a transaction. A hot sale row or an exhausted pool shows up here.
	const samples: Array<{ locked: number; active: number; idle: number }> = [];
	let sampling = true;
	const sampler = (async () => {
		while (sampling) {
			const probe = spawn(
				"docker",
				[
					"compose",
					"-f",
					path.join(root, "compose.yaml"),
					"exec",
					"-T",
					"postgres",
					"psql",
					"-U",
					"flash",
					"-d",
					"flash",
					"-tA",
					"-c",
					`select count(*) filter (where wait_event_type = 'Lock'), count(*) filter (where state = 'active'),
						count(*) filter (where state = 'idle in transaction')
						from pg_stat_activity where datname = 'flash'`,
				],
				{ stdio: ["ignore", "pipe", "ignore"] },
			);
			let out = "";
			probe.stdout.on("data", (chunk: Buffer) => {
				out += chunk.toString();
			});
			await new Promise((resolve) => probe.on("close", resolve));
			const match = /^(\d+)\|(\d+)\|(\d+)$/m.exec(out);
			if (match) {
				samples.push({
					locked: Number(match[1]),
					active: Number(match[2]),
					idle: Number(match[3]),
				});
			}
		}
	})();

	// k6 runs one file, so the script is bundled first.
	await bundleShop();
	console.log("load: running k6");
	const log: string[] = [];
	const k6 = spawn(
		"docker",
		[
			"compose",
			"-f",
			path.join(root, "compose.yaml"),
			"run",
			"--rm",
			"-T",
			"k6",
			"run",
			"--summary-export",
			`/reports/${name}-k6.json`,
			"-e",
			`PROFILE=${name}`,
			"-e",
			`SALE_ID=${saleId}`,
			"/scripts/.bundle/shop.js",
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	for (const stream of [k6.stdout, k6.stderr]) {
		stream.on("data", (chunk: Buffer) => {
			process.stdout.write(chunk);
			log.push(chunk.toString());
		});
	}
	const k6Exit = await new Promise<number | null>((resolve) =>
		k6.on("close", resolve),
	);
	for (const timer of timers) clearTimeout(timer);
	sampling = false;
	await sampler;
	writeFileSync(path.join(reports, `${name}-k6.log`), log.join(""));
	// If k6 ended before the timers ran, Redis must still come back before the checks.
	if (profile.redisStopsAtSeconds !== undefined) docker("start", "redis");
	await sleep(STACK_SETTLE_MS);

	// k6 writes its summary when it finishes. Without it the load generator failed, which says nothing about the system:
	// for example it ran out of memory while starting virtual users.
	if (!existsSync(path.join(reports, `${name}-k6.json`))) {
		throw new Error(
			`k6 produced no summary (exit code ${k6Exit}); see generated-reports/load/${name}-k6.log. ` +
				"The load generator failed, so this run says nothing about the system.",
		);
	}

	// What Postgres says.
	const [stock = 0, sold = 0] = sql(
		`select stock, sold from sales where id = '${saleId}'`,
	)
		.split("|")
		.map(Number);
	const purchases = Number(
		sql(`select count(*) from purchases where sale_id = '${saleId}'`),
	);
	const twice = Number(
		sql(
			`select count(*) from (select user_id from purchases where sale_id = '${saleId}' group by user_id having count(*) > 1) d`,
		),
	);

	// What k6 says.
	const summary: unknown = JSON.parse(
		readFileSync(path.join(reports, `${name}-k6.json`), "utf8"),
	);
	const k6Purchased = metric(summary, "purchased", "count") ?? 0;
	const rateLimited = metric(summary, "rate_limited", "count") ?? 0;
	const serverErrors = metric(summary, "server_errors", "count") ?? 0;
	const reserveP95 = metric(
		summary,
		"http_req_duration{name:reserve}",
		"p(95)",
	);
	const purchaseP95 = metric(
		summary,
		"http_req_duration{name:purchase}",
		"p(95)",
	);

	// A generator that cannot start every planned shopper has not applied the planned load.
	const dropped = metric(summary, "dropped_iterations", "count") ?? 0;
	judge(
		"k6 started every planned shopper",
		"0 dropped",
		String(dropped),
		dropped === 0,
	);
	judge(
		"no oversell: sold is at most the stock",
		`<= ${stock}`,
		String(sold),
		sold <= stock,
	);
	judge(
		"the sold count equals the purchases",
		String(purchases),
		String(sold),
		sold === purchases,
	);
	judge("no shopper bought twice", "0", String(twice), twice === 0);
	judge(
		"k6 and Postgres agree on purchases",
		String(purchases),
		String(k6Purchased),
		k6Purchased === purchases,
	);
	judge("the stock sold out", String(stock), String(sold), sold === stock);
	judge(
		"the shopper who floods the queue is limited",
		"> 0 replies of 429",
		String(rateLimited),
		rateLimited > 0,
	);

	const redisUp = docker(
		"exec",
		"-T",
		"redis",
		"redis-cli",
		"ping",
	).stdout.includes("PONG");
	if (redisUp) {
		const buyers = Number(
			must(
				"exec",
				"-T",
				"redis",
				"redis-cli",
				"scard",
				`sale:${saleId}:buyers`,
			).trim(),
		);
		if (profile.judgeSpeed) {
			judge(
				"Redis and Postgres agree on buyers",
				String(purchases),
				String(buyers),
				buyers === purchases,
			);
		} else {
			console.log(
				`load: Redis lists ${buyers} buyers after the restart (not judged)`,
			);
		}
	}

	if (profile.judgeSpeed) {
		const fast = (value: number | undefined, limit: number) =>
			value !== undefined && value < limit;
		judge(
			"reserve p95",
			`< ${LIMITS.reserveP95Ms} ms`,
			`${reserveP95?.toFixed(1)} ms`,
			fast(reserveP95, LIMITS.reserveP95Ms),
		);
		judge(
			"purchase p95",
			`< ${LIMITS.purchaseP95Ms} ms`,
			`${purchaseP95?.toFixed(1)} ms`,
			fast(purchaseP95, LIMITS.purchaseP95Ms),
		);
		judge(
			"server errors",
			String(LIMITS.serverErrors),
			String(serverErrors),
			serverErrors <= LIMITS.serverErrors,
		);
	}

	// How the instances shared the work.
	const spread = Array.from(
		{ length: INSTANCE_COUNT },
		(_, index) => index + 1,
	).map((n) => {
		const logs = docker("logs", "--no-log-prefix", `flash-be-${n}`).stdout;
		return logs.split('"incoming request"').length - 1;
	});

	const lines = [
		`# Load run: ${name}`,
		"",
		`Sale ${saleId}. Stock ${stock}, ${profile.users} shoppers at ${profile.arrivalsPerSecond} a second and ${profile.latecomers} latecomers, ` +
			`hold ${profile.holdSeconds} s, admission ${profile.admitPerSecond} a second.`,
		...events.map((event) => `- ${event}`),
		"",
		"| Check | Expected | Actual | Result |",
		"| --- | --- | --- | --- |",
		...rows.map(
			(row) =>
				`| ${row.check} | ${row.expected} | ${row.actual} | ${row.pass ? "pass" : "FAIL"} |`,
		),
		"",
		`Informational: reserve p95 ${reserveP95?.toFixed(1)} ms, purchase p95 ${purchaseP95?.toFixed(1)} ms, ` +
			`server errors ${serverErrors}, requests per instance ${spread.join(" / ")}, k6 exit code ${k6Exit}.`,
		`Postgres sessions, sampled about three times a second (${samples.length} samples): most waiting for a lock ${Math.max(0, ...samples.map((sample) => sample.locked))}, ` +
			`most active ${Math.max(0, ...samples.map((sample) => sample.active))}, most idle in a transaction ${Math.max(0, ...samples.map((sample) => sample.idle))}.`,
		"",
	];
	writeFileSync(path.join(reports, `${name}.md`), lines.join("\n"));
	console.log(`\n${lines.join("\n")}`);

	if (!keep) must("down", "-v", "--remove-orphans");
	return rows.every((row) => row.pass) ? 0 : 1;
}

main().then(
	(code) => process.exit(code),
	(error) => {
		console.error(error);
		docker("start", "redis");
		if (!keep) docker("down", "-v", "--remove-orphans");
		process.exit(1);
	},
);
