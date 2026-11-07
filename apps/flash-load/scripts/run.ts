// Runs one load profile end to end. The phases, in order: start the stack and seed a sale, start the chaos timers and
// the Postgres sampler, run k6, settle, collect what Postgres, Redis and k6 say, judge the run, and write the report.
// Usage: node scripts/run.ts <smoke|full|chaos|burst|contention> [--keep] [--calm]
// --keep leaves the stack running after the run. --calm runs the profile without its Redis timers, as a control.
// The verdict comes from Postgres and Redis, not from what k6 says it did. k6 is compared with them.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { sleep } from "@flash/flash-commons/timers";
import {
	PROFILE_NAMES,
	PROFILES,
	type Profile,
	type ProfileName,
} from "../k6/profiles.ts";
import { bundleShop } from "./bundle.ts";
import { type Chaos, startChaos } from "./chaos.ts";
import {
	type RunFacts,
	readK6,
	readPostgres,
	readRedisBuyers,
	requestsPerInstance,
} from "./collect.ts";
import {
	composeArgs,
	composeExec,
	composeOutput,
	composeRedis,
	execArgs,
	k6SummaryFile,
	REPORTS_DIR,
	reportPath,
	TEAR_DOWN_ARGS,
} from "./compose.ts";
import { writeReport } from "./report.ts";
import { type Sample, type Sampler, startSampler } from "./sampler.ts";
import { judgeRun } from "./verdict.ts";

// The instances cache the current sale for up to a second; the run waits a little longer before it starts k6.
const SALE_CACHE_SETTLE_MS = 2500;
// After k6 ends, the stack gets this long to finish what it had in flight before the data is read.
const STACK_SETTLE_MS = 2000;
// The seeded sale lasts longer than any profile.
const SEED_DURATION_MINUTES = 30;

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

// The phases of the run, top to bottom. The verdict is the exit code: 0 when every check passes.
async function main(): Promise<number> {
	mkdirSync(REPORTS_DIR, { recursive: true });
	console.log(`load: profile ${name}`, JSON.stringify(profile));

	const saleId = await startStackAndSeed();
	const chaos = startChaos(profile, calm);
	const sampler = startSampler();
	const k6Exit = await runK6(saleId);
	const samples = await settle(chaos, sampler);
	requireK6Summary(k6Exit);
	const facts = collect(saleId);
	const rows = judgeRun(profile, facts);
	writeReport({
		name,
		profile,
		saleId,
		stock: facts.postgres.stock,
		events: chaos.events,
		rows,
		k6: facts.k6,
		k6Exit,
		requestsPerInstance: requestsPerInstance(),
		samples,
	});
	if (!keep) composeOutput(TEAR_DOWN_ARGS);
	return rows.every((row) => row.pass) ? 0 : 1;
}

// Starts a fresh stack, then seeds one sale for this profile. Returns the sale's id.
async function startStackAndSeed(): Promise<string> {
	composeOutput(TEAR_DOWN_ARGS);
	console.log("load: building and starting the stack");
	composeOutput(["up", "-d", "--build", "--wait"]);
	const seeded = composeOutput(
		execArgs("flash-be-1", [
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
		]),
	);
	const saleId = /seeded sale (\S+)/.exec(seeded)?.[1];
	if (!saleId)
		throw new Error(`the seed command printed no sale id: ${seeded}`);
	console.log(
		`load: sale ${saleId}, stock ${profile.stock}, ${profile.users} shoppers`,
	);
	await sleep(SALE_CACHE_SETTLE_MS);
	return saleId;
}

// Runs k6 against the sale and keeps its output in `<profile>-k6.log`. Resolves with k6's exit code, or null when k6
// was killed. k6 runs one file, so the script is bundled first.
async function runK6(saleId: string): Promise<number | null> {
	await bundleShop();
	console.log("load: running k6");
	const log: string[] = [];
	const k6 = spawn(
		"docker",
		composeArgs([
			"run",
			"--rm",
			"-T",
			"k6",
			"run",
			"--summary-export",
			`/reports/${k6SummaryFile(name)}`,
			"-e",
			`PROFILE=${name}`,
			"-e",
			`SALE_ID=${saleId}`,
			"/scripts/.bundle/shop.js",
		]),
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	for (const stream of [k6.stdout, k6.stderr]) {
		stream.on("data", (chunk: Buffer) => {
			process.stdout.write(chunk);
			log.push(chunk.toString());
		});
	}
	const exitCode = await new Promise<number | null>((resolve) =>
		k6.on("close", resolve),
	);
	writeFileSync(reportPath(`${name}-k6.log`), log.join(""));
	return exitCode;
}

// Stops the timers and the sampler, brings Redis back if a timer may have stopped it, and lets the stack settle.
// Returns the Postgres samples.
async function settle(chaos: Chaos, sampler: Sampler): Promise<Sample[]> {
	chaos.cancel();
	const samples = await sampler.stop();
	// If k6 ended before the timers ran, Redis must still come back before the checks.
	if (profile.redisStopsAtSeconds !== undefined) composeRedis("start");
	await sleep(STACK_SETTLE_MS);
	return samples;
}

// k6 writes its summary when it finishes. Without it the load generator failed, which says nothing about the system:
// for example it ran out of memory while starting virtual users.
function requireK6Summary(k6Exit: number | null): void {
	if (existsSync(reportPath(k6SummaryFile(name)))) return;
	throw new Error(
		`k6 produced no summary (exit code ${k6Exit}); see generated-reports/load/${name}-k6.log. ` +
			"The load generator failed, so this run says nothing about the system.",
	);
}

// Reads what Postgres, Redis and k6 say. A Redis that is down at the end is reported, not judged.
function collect(saleId: string): RunFacts {
	const postgres = readPostgres(saleId);
	const k6 = readK6(name);
	const redisBuyers = readRedisBuyers(saleId);
	if (redisBuyers !== undefined && !profile.judgeSpeed) {
		console.log(
			`load: Redis lists ${redisBuyers} buyers after the restart (not judged)`,
		);
	}
	return { postgres, k6, redisBuyers };
}

main().then(
	(code) => process.exit(code),
	(error) => {
		console.error(error);
		composeRedis("start");
		if (!keep) composeExec(TEAR_DOWN_ARGS);
		process.exit(1);
	},
);
