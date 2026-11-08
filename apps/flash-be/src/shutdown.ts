// The shutdown of the API server (the outermost layer, beside main.ts). When the process is asked to stop, traffic must
// move to other instances before the server goes away, the requests in flight must still get their answer, and the stores must
// close after the last request. main.ts wires the real steps; the order and the exit code are decided here, so a test can
// run them with its own timers.
import { sleep } from "@flash/flash-commons/timers";
import { attemptAsync } from "@flash/typekit";

// One thing to close after the drain window, named for the log.
export type CloseStep = { name: string; close: () => Promise<void> };

// The waits of a shutdown, passed in so a test decides when time passes.
export type ShutdownTimers = {
	// Resolves after `ms` milliseconds.
	wait: (ms: number) => Promise<void>;
	// Calls `run` after `ms` milliseconds, unless the returned function is called first.
	schedule: (run: () => void, ms: number) => () => void;
};

// Where a shutdown writes what it does: the start, a second signal, a step that failed, the time limit.
export type ShutdownLog = {
	info: (message: string) => void;
	error: (error: unknown, message: string) => void;
};

// Everything one shutdown needs. The steps run in the order given, so the HTTP server closes before the stores it uses.
export type ShutdownPlan = {
	// Stops taking new work at once: readiness answers 503 and the admission timer stops.
	stopTaking: () => void;
	// How long the server keeps answering after that, closing each connection after its reply, so traffic moves first.
	drainMs: number;
	// The longest the whole shutdown may take. Past it the process exits with a failure, before a supervisor kills it.
	timeoutMs: number;
	steps: readonly CloseStep[];
	timers: ShutdownTimers;
	log: ShutdownLog;
	exit: (code: number) => void;
};

// The exit codes of a shutdown: clean when every step closed in time, failed otherwise, so a supervisor can tell them apart.
export const EXIT_CODE = { clean: 0, failed: 1 } as const;

// The timers of the real process.
export const systemTimers: ShutdownTimers = {
	wait: (ms) => sleep(ms),
	schedule: (run, ms) => {
		const timer = setTimeout(run, ms);
		return () => clearTimeout(timer);
	},
};

// Runs the steps in order. A step that fails is logged and the others still run, so one broken store does not keep the
// rest open. Returns whether every step closed.
async function closeAll(
	steps: readonly CloseStep[],
	log: ShutdownLog,
): Promise<boolean> {
	let clean = true;
	for (const step of steps) {
		const closed = await attemptAsync(() => step.close(), Error);
		if (closed.isErr()) {
			clean = false;
			log.error(closed.error, `closing ${step.name} failed`);
		} else {
			log.info(`closed ${step.name}`);
		}
	}
	return clean;
}

// Returns the handler of the stop signals. The first signal runs the shutdown once; a later one is logged and ignored, so
// a second Ctrl-C or a repeated SIGTERM cannot start a second close of the same server.
export function createShutdown(
	plan: ShutdownPlan,
): (signal: string) => Promise<void> {
	let started = false;
	let exited = false;
	const exitOnce = (code: number): void => {
		if (exited) return;
		exited = true;
		plan.exit(code);
	};

	return async (signal) => {
		if (started) {
			plan.log.info(`${signal} received while stopping: ignored`);
			return;
		}
		started = true;
		plan.log.info(`${signal} received: stopping`);
		const cancelLimit = plan.timers.schedule(() => {
			plan.log.error(
				new Error("shutdown timed out"),
				`shutdown took longer than ${plan.timeoutMs} ms: exiting`,
			);
			exitOnce(EXIT_CODE.failed);
		}, plan.timeoutMs);
		plan.stopTaking();
		plan.log.info(`draining for ${plan.drainMs} ms: readiness answers 503`);
		await plan.timers.wait(plan.drainMs);
		const clean = await closeAll(plan.steps, plan.log);
		cancelLimit();
		plan.log.info("stopped");
		exitOnce(clean ? EXIT_CODE.clean : EXIT_CODE.failed);
	};
}
