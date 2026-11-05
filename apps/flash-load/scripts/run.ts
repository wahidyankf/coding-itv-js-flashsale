// Runs one load profile end to end: starts the stack, seeds a sale, runs k6, then checks Postgres and Redis.
// Usage: node scripts/run.ts <smoke|full|chaos> [--keep]
// The verdict comes from Postgres and Redis, not from what k6 says it did. k6 is compared with them.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
	LIMITS,
	PROFILE_NAMES,
	PROFILES,
	type Profile,
	type ProfileName,
} from "../k6/profiles.ts";

const root = path.resolve(import.meta.dirname, "..");
const reports = path.resolve(root, "../../generated-reports/load");

const args = process.argv.slice(2);
const keep = args.includes("--keep");
const requested = args.find((arg) => !arg.startsWith("--"));
if (!requested || !PROFILE_NAMES.includes(requested as ProfileName)) {
	console.error(
		`Usage: node scripts/run.ts <${PROFILE_NAMES.join("|")}> [--keep]`,
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
		{ encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
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
		"30",
	);
	const saleId = /seeded sale (\S+)/.exec(seeded)?.[1];
	if (!saleId)
		throw new Error(`the seed command printed no sale id: ${seeded}`);
	console.log(
		`load: sale ${saleId}, stock ${profile.stock}, ${profile.users} shoppers`,
	);
	// The instances read the current sale on a short cache; give them a moment.
	await sleep(2500);

	// Chaos: stop Redis and start it again while shoppers are arriving.
	const timers: NodeJS.Timeout[] = [];
	const events: string[] = [];
	if (profile.redisStopsAtSeconds !== undefined) {
		timers.push(
			setTimeout(() => {
				events.push(`Redis stopped at +${profile.redisStopsAtSeconds}s`);
				docker("stop", "redis");
			}, profile.redisStopsAtSeconds * 1000),
		);
	}
	if (profile.redisStartsAtSeconds !== undefined) {
		timers.push(
			setTimeout(() => {
				events.push(`Redis started at +${profile.redisStartsAtSeconds}s`);
				docker("start", "redis");
			}, profile.redisStartsAtSeconds * 1000),
		);
	}

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
			"/scripts/shop.ts",
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
	writeFileSync(path.join(reports, `${name}-k6.log`), log.join(""));
	// If k6 ended before the timers ran, Redis must still come back before the checks.
	if (profile.redisStopsAtSeconds !== undefined) docker("start", "redis");
	await sleep(2000);

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

	// How the three instances shared the work.
	const spread = [1, 2, 3].map((n) => {
		const logs = docker("logs", "--no-log-prefix", `flash-be-${n}`).stdout;
		return logs.split('"incoming request"').length - 1;
	});

	const lines = [
		`# Load run: ${name}`,
		"",
		`Sale ${saleId}. Stock ${stock}, ${profile.users} shoppers at ${profile.arrivalsPerSecond} a second, ` +
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
		process.exit(1);
	},
);
