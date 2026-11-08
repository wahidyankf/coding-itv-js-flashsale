// Unit tests for shutdown.ts: the order of the steps, the drain window, a second signal, a step that fails, the time limit,
// and the timers of the real process.
import { describe, expect, it } from "vitest";
import {
	type CloseStep,
	createShutdown,
	EXIT_CODE,
	type ShutdownPlan,
	systemTimers,
} from "./shutdown.js";

// A promise and the function that settles it, so a test decides when a wait ends.
function deferred() {
	let resolve: () => void = () => {};
	const promise = new Promise<void>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

// A plan whose every action is written to `events`, with timers the test drives: the drain ends when `drain.resolve` is
// called, and the time limit fires when `fireLimit` is called.
function recordingPlan(steps: CloseStep[] = []) {
	const events: string[] = [];
	const errors: Array<{ error: unknown; message: string }> = [];
	const exits: number[] = [];
	const drain = deferred();
	let limit: (() => void) | undefined;
	let limitCancelled = false;
	const plan: ShutdownPlan = {
		stopTaking: () => events.push("stop taking"),
		drainMs: 2000,
		timeoutMs: 10_000,
		steps: steps.length
			? steps
			: [
					{ name: "http", close: async () => void events.push("close http") },
					{ name: "redis", close: async () => void events.push("close redis") },
					{
						name: "postgres",
						close: async () => void events.push("close postgres"),
					},
				],
		timers: {
			wait: async (ms) => {
				events.push(`wait ${ms}`);
				await drain.promise;
			},
			schedule: (run, ms) => {
				events.push(`limit ${ms}`);
				limit = run;
				return () => {
					limitCancelled = true;
				};
			},
		},
		log: {
			info: (message) => events.push(`info: ${message}`),
			error: (error, message) => errors.push({ error, message }),
		},
		exit: (code) => {
			exits.push(code);
		},
	};
	return {
		plan,
		events,
		errors,
		exits,
		drain,
		fireLimit: () => limit?.(),
		limitCancelled: () => limitCancelled,
	};
}

describe("createShutdown", () => {
	it("stops taking work at once, before the drain window ends", () => {
		const run = recordingPlan();
		void createShutdown(run.plan)("SIGTERM");
		expect(run.events).toEqual([
			"info: SIGTERM received: stopping",
			"limit 10000",
			"stop taking",
			"info: draining for 2000 ms: readiness answers 503",
			"wait 2000",
		]);
		expect(run.exits).toEqual([]);
	});

	it("closes each step in order after the drain window, then exits with 0", async () => {
		const run = recordingPlan();
		const stopping = createShutdown(run.plan)("SIGTERM");
		run.drain.resolve();
		await stopping;
		expect(run.events.slice(5)).toEqual([
			"close http",
			"info: closed http",
			"close redis",
			"info: closed redis",
			"close postgres",
			"info: closed postgres",
			"info: stopped",
		]);
		expect(run.exits).toEqual([EXIT_CODE.clean]);
		expect(run.limitCancelled()).toBe(true);
		expect(run.errors).toEqual([]);
	});

	it("ignores a second signal while it stops, and says so", async () => {
		const run = recordingPlan();
		const shutdown = createShutdown(run.plan);
		const first = shutdown("SIGTERM");
		await shutdown("SIGINT");
		run.drain.resolve();
		await first;
		expect(run.events).toContain(
			"info: SIGINT received while stopping: ignored",
		);
		expect(run.events.filter((event) => event === "stop taking")).toHaveLength(
			1,
		);
		expect(run.exits).toEqual([EXIT_CODE.clean]);
	});

	it("logs a step that fails, still runs the steps after it, and exits with 1", async () => {
		const closed: string[] = [];
		const broken = new Error("redis would not close");
		const run = recordingPlan([
			{ name: "http", close: async () => void closed.push("http") },
			{
				name: "redis",
				close: async () => {
					throw broken;
				},
			},
			{ name: "postgres", close: async () => void closed.push("postgres") },
		]);
		const stopping = createShutdown(run.plan)("SIGTERM");
		run.drain.resolve();
		await stopping;
		expect(closed).toEqual(["http", "postgres"]);
		expect(run.errors).toEqual([
			{ error: broken, message: "closing redis failed" },
		]);
		expect(run.exits).toEqual([EXIT_CODE.failed]);
	});

	it("exits with 1 when the time limit passes, and only once", async () => {
		const run = recordingPlan();
		const stopping = createShutdown(run.plan)("SIGTERM");
		run.fireLimit();
		expect(run.exits).toEqual([EXIT_CODE.failed]);
		expect(run.errors.map((entry) => entry.message)).toEqual([
			"shutdown took longer than 10000 ms: exiting",
		]);
		run.drain.resolve();
		await stopping;
		expect(run.exits).toEqual([EXIT_CODE.failed]);
	});
});

describe("systemTimers", () => {
	it("waits for the time given", async () => {
		const started = Date.now();
		await systemTimers.wait(20);
		expect(Date.now() - started).toBeGreaterThanOrEqual(15);
	});

	it("runs a scheduled call after its time", async () => {
		const ran = deferred();
		systemTimers.schedule(ran.resolve, 5);
		await ran.promise;
	});

	it("does not run a scheduled call that was cancelled", async () => {
		let ran = false;
		const cancel = systemTimers.schedule(() => {
			ran = true;
		}, 5);
		cancel();
		await systemTimers.wait(20);
		expect(ran).toBe(false);
	});
});
