// The server of a shutdown scenario, the same at the unit and the integration layer: the app on a real socket, so a close
// really waits for a request and really ends a stream, and the shutdown of shutdown.ts over it, with the exit code kept
// instead of ending the test process. Each layer passes its own dependencies, stores and timers.
import { API_PATHS, PROBE_PATHS } from "@flash/flash-commons";
import { buildApp } from "../../adapters/inbound/http/app.js";
import { DEFAULT_STREAM_OPTIONS } from "../../adapters/inbound/http/event-stream.js";
import { TICKET_HEADER } from "../../adapters/inbound/http/headers.js";
import type { Dependencies } from "../../application/dependencies.js";
import { buildConfig } from "../../config.js";
import {
	type CloseStep,
	createShutdown,
	type ShutdownTimers,
} from "../../shutdown.js";

// A reply as a shutdown scenario reads it: the status and the JSON body, read at once so a closed socket cannot lose it.
export type StoppingReply = { status: number; body: Record<string, unknown> };

// The time limit of the server: the default of the real process, so the scenarios run with what production runs.
const TIMEOUT_MS = buildConfig({}).shutdownTimeoutMs;
// Streams read often in tests, so the first event shows within a moment.
const STREAM_INTERVAL_MS = 20;

// A running server and the handles a scenario needs on it.
export type StoppingServer = {
	origin: string;
	// Sends the stop signal, as SIGTERM would. Readiness is 503 by the time it returns.
	askToStop: () => void;
	// Resolves when the shutdown starts to close the HTTP server, after the drain window.
	closing: Promise<void>;
	// The exit code, once the shutdown has finished.
	exitCode: () => number | undefined;
	exited: Promise<number>;
};

// A promise and the function that settles it, so a layer decides when a wait ends.
export function deferred<T = void>() {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

// Starts the app on a free port with the shutdown wired as main.ts wires it: readiness turns to 503 at once, the drain
// window passes on `timers`, the HTTP server closes, then the stores in `stores`.
export async function startStoppingServer(input: {
	deps: Dependencies;
	drainMs: number;
	timers: ShutdownTimers;
	stores: CloseStep[];
}): Promise<StoppingServer> {
	let stopping = false;
	let code: number | undefined;
	const closing = deferred();
	const exited = deferred<number>();
	const app = buildApp(input.deps, {
		cookieSecure: false,
		events: { ...DEFAULT_STREAM_OPTIONS, intervalMs: STREAM_INTERVAL_MS },
		isStopping: () => stopping,
	});
	const shutdown = createShutdown({
		stopTaking: () => {
			stopping = true;
		},
		drainMs: input.drainMs,
		timeoutMs: TIMEOUT_MS,
		steps: [
			{
				name: "the HTTP server",
				close: async () => {
					closing.resolve();
					await app.close();
				},
			},
			...input.stores,
		],
		timers: input.timers,
		log: { info: () => {}, error: () => {} },
		exit: (exitCode) => {
			code = exitCode;
			exited.resolve(exitCode);
		},
	});
	const origin = await app.listen({ host: "127.0.0.1", port: 0 });
	return {
		origin,
		askToStop: () => void shutdown("SIGTERM"),
		closing: closing.promise,
		exitCode: () => code,
		exited: exited.promise,
	};
}

// Sends one request and reads its JSON body at once.
async function send(
	url: string,
	init: { method?: string; headers?: Record<string, string>; body?: unknown },
): Promise<StoppingReply> {
	const reply = await fetch(url, {
		method: init.method ?? "GET",
		headers: {
			...init.headers,
			...(init.body === undefined
				? {}
				: { "content-type": "application/json" }),
		},
		...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
	});
	const text = await reply.text();
	return {
		status: reply.status,
		body: text === "" ? {} : (JSON.parse(text) as Record<string, unknown>),
	};
}

// The path of a sale route with its sale id filled in.
const salePath = (path: string, saleId: string) =>
	path.replace(":saleId", saleId);

// The requests a shutdown scenario sends, as a browser would send them through the proxy.
export function stoppingRequests(origin: string) {
	return {
		ready: () => send(`${origin}${PROBE_PATHS.ready}`, {}),
		join: (saleId: string, cookie: string) =>
			send(`${origin}${salePath(API_PATHS.queue, saleId)}`, {
				method: "POST",
				headers: { cookie },
			}),
		reserve: (saleId: string, cookie: string, ticket: string) =>
			send(`${origin}${salePath(API_PATHS.reservations, saleId)}`, {
				method: "POST",
				headers: { cookie, [TICKET_HEADER]: ticket },
			}),
		confirm: (saleId: string, cookie: string, reservationId: string) =>
			send(`${origin}${salePath(API_PATHS.purchases, saleId)}`, {
				method: "POST",
				headers: { cookie },
				body: { reservationId },
			}),
	};
}

// An open stream of a sale's events, read as a browser's EventSource reads it.
export type SaleStream = {
	// Resolves true when the server ends the stream within `withinMs`, false when it is still open then.
	ended: (withinMs: number) => Promise<boolean>;
	close: () => void;
};

// Opens the sale's event stream and waits for its first event, so the stream is surely open when the scenario goes on.
export async function watchSale(
	origin: string,
	saleId: string,
): Promise<SaleStream> {
	const controller = new AbortController();
	const reply = await fetch(
		`${origin}${salePath(API_PATHS.saleEvents, saleId)}`,
		{
			signal: controller.signal,
		},
	);
	const reader = reply.body?.getReader();
	if (!reader) throw new Error("the stream did not open");
	const first = await reader.read();
	if (!new TextDecoder().decode(first.value).includes("event: sale")) {
		throw new Error("the stream sent no sale event first");
	}
	// A read that fails (the scenario closed the stream itself) also means the stream is over.
	const drained = (async () => {
		for (;;) if ((await reader.read()).done) return true;
	})().catch(() => true);
	return {
		ended: (withinMs) =>
			Promise.race([
				drained,
				new Promise<boolean>((resolve) =>
					setTimeout(() => resolve(false), withinMs),
				),
			]),
		close: () => controller.abort(),
	};
}
