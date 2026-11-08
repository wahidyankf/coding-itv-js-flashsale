// The unit world: the scenarios' page, the browser and the web server, all in memory. The page, the client, the proxy and
// the loader are the real code. flash-be is the fake backend, called as a function, and time is fake, so a scenario can
// move it. The unit scenarios run here under Vitest. Test support only.

import { API_PATHS, HTTP_STATUS, MS_PER_SECOND } from "@flash/flash-commons";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, vi } from "vitest";
import { JSON_CONTENT_TYPE, jsonPost, TICKET_HEADER } from "../../api";
import { proxyToBackend } from "../../proxy";
import { HomePage } from "../../routes/index";
import { loadSale, type SaleLoad } from "../../sale/load";
import { SalePage } from "../../sale-page";
import { createWebApi } from "../../web-api";
import { createCookieJar } from "./cookie-jar";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "./fake-account";
import { createFakeBackend, type FakeBackend } from "./fake-backend";
import { errorPayload, matchRoute } from "./fake-http";
import { SALE_ID, type SaleSpec } from "./fake-state";
import { secondsToConfirmIn } from "./web-steps";
import type { WebWorld } from "./web-world";

const BACKEND = "http://flash-be.test";
const ENV = { FLASH_BE_URL: BACKEND };
const START = new Date("2026-06-01T12:00:00Z");
const SITE = "http://web.test";
// The address the web server's socket sees every request come from. The Node server puts it on the request as `ip`.
const CALLER = "192.0.2.10";
// The password of a shopper that a scenario logs in without naming one.
const PASSWORD = "a long password";
// The page's retry for a live stream: no wait between tries, so a dropped stream is opened again in the same turn. The
// count of attempts is the page's own.
const LIVE_RETRY = { random: () => 0 };
// Longer than the page's waits between eight attempts put together (1, 2, 4, 8, 16, 30 and 30 seconds).
const GIVE_UP_WITHIN_MS = 200 * MS_PER_SECOND;
// How many times the page is given a turn to settle after an action.
const SETTLE_ROUNDS = 10;

// What the scenarios share: the fake flash-be (replaced on reset), what the page loaded, and what the browser keeps.
type Harness = {
	backend: FakeBackend;
	load: SaleLoad;
	jar: ReturnType<typeof createCookieJar>;
	// The ways to end the live streams that are open now, as a dropped connection ends them.
	streams: Set<() => void>;
	// True when the browser cannot reach the web server, so each of its calls fails before it is sent.
	browserDown: boolean;
};

// One event stream of the fake flash-be, as the bytes flash-be would send. It sends a frame only when the value differs
// from the last one, and it ends when the client leaves (`signal`) or when a scenario drops the connection.
function eventStream(
	h: Harness,
	name: "saleEvents" | "placeEvents",
	user: string,
	signal: AbortSignal | null | undefined,
): Response {
	const encoder = new TextEncoder();
	let end = () => {};
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			let last = "";
			const push = () => {
				if (!h.backend.hasSale()) return;
				const [event, data] =
					name === "placeEvents"
						? ["place", { userId: user, ...h.backend.placeOf(user) }]
						: ["sale", h.backend.view()];
				const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
				if (frame === last) return;
				last = frame;
				controller.enqueue(encoder.encode(frame));
			};
			push();
			const off = h.backend.onChange(push);
			end = () => {
				off();
				h.streams.delete(end);
				signal?.removeEventListener("abort", end);
				controller.close();
			};
			h.streams.add(end);
			signal?.addEventListener("abort", end);
		},
		cancel: () => end(),
	});
	return new Response(body, {
		headers: { "content-type": "text/event-stream" },
	});
}

// The refusal of a stream, in the body flash-be sends, so the renewing fetch can read the code.
const refusalOf = (error: "not_authenticated" | "invalid_ticket") =>
	Response.json(errorPayload(error), { status: HTTP_STATUS.unauthorized });

// The fake flash-be's answer to a request for an event stream, or undefined when the request is for something else. A
// place stream is a shopper's own: the cookie says who, and the ticket proves the place.
function streamReply(
	h: Harness,
	url: URL,
	headers: Headers,
	signal: AbortSignal | null | undefined,
): Response | undefined {
	const match = matchRoute("GET", url.pathname);
	if (match?.name !== "saleEvents" && match?.name !== "placeEvents") {
		return undefined;
	}
	// The fake counts the request and refuses it when it is cut off, as for any other call. Its own answer is not used.
	h.backend.handle("GET", url.pathname, Object.fromEntries(headers), {});
	if (match.name === "saleEvents")
		return eventStream(h, match.name, "", signal);
	const user = h.backend.userOf(headers.get("cookie") ?? undefined);
	if (user === undefined) return refusalOf("not_authenticated");
	if (headers.get(TICKET_HEADER) !== `ticket-${user}`) {
		return refusalOf("invalid_ticket");
	}
	return eventStream(h, match.name, user, signal);
}

// The fake flash-be as a fetch. Its answers are the replies of the fake, as flash-be would send them.
function backendFetchOf(h: Harness): typeof fetch {
	return async (input, init) => {
		const url = new URL(String(input));
		const headers = new Headers(init?.headers);
		const streamed = streamReply(h, url, headers, init?.signal);
		if (streamed) return streamed;
		const text = typeof init?.body === "string" ? init.body : "";
		const reply = h.backend.handle(
			init?.method ?? "GET",
			url.pathname,
			Object.fromEntries(headers),
			text ? JSON.parse(text) : {},
		);
		const returned = new Headers(reply.headers);
		for (const cookie of reply.cookies ?? []) {
			returned.append("set-cookie", cookie);
		}
		return Response.json(reply.body, {
			status: reply.status,
			headers: returned,
		});
	};
}

// The browser and the web server: the page's requests go through the real proxy to the fake flash-be. Like a browser, it
// sends the cookies that match the path, says which site a POST comes from, and keeps the cookies that come back.
function webFetchOf(h: Harness, backendFetch: typeof fetch): typeof fetch {
	return async (input, init) => {
		if (h.browserDown) throw new TypeError("fetch failed");
		const url = new URL(String(input), SITE);
		const headers = new Headers(init?.headers);
		const cookie = h.jar.header(url.pathname);
		if (cookie !== undefined) headers.set("cookie", cookie);
		if (init?.method === "POST" && !headers.has("origin")) {
			headers.set("origin", SITE);
		}
		const reply = await proxyToBackend(
			Object.assign(new Request(url, { ...init, headers }), { ip: CALLER }),
			ENV,
			backendFetch,
		);
		h.jar.store(reply.headers.getSetCookie());
		return reply;
	};
}

// Ends every open stream, as a dropped connection does.
function dropStreams(h: Harness): void {
	for (const end of [...h.streams]) end();
}

// Lets the promises of a request and the effects that follow run.
async function settle(): Promise<void> {
	for (let round = 0; round < SETTLE_ROUNDS; round++) {
		await vi.advanceTimersByTimeAsync(0);
	}
}

// Runs a page action inside React's act, then lets it settle.
async function inPage(action: () => void | Promise<void>): Promise<void> {
	await act(async () => {
		await action();
		await settle();
	});
}

const fill = (label: RegExp, value: string) =>
	fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string): void => {
	fireEvent.click(screen.getByRole("button", { name }));
};
// Fills the form as a visitor would, in the form that is asked for.
const enter = (
	mode: "I have an account" | "I am new",
	user: string,
	password: string,
	submit: string,
) =>
	inPage(() => {
		click(mode);
		fill(/Username/, user);
		fill(/Password/, password);
		click(submit);
	});

// Starting a scenario and ending it: the clock, the fake flash-be, the browser's cookies, and the page.
function lifecycleOf(h: Harness) {
	return {
		reset() {
			vi.useFakeTimers();
			vi.setSystemTime(START);
			h.backend = createFakeBackend(() => Date.now());
			h.load = { state: "none" };
			h.jar.clear();
			h.streams.clear();
			h.browserDown = false;
		},
		clear() {
			cleanup();
			vi.useRealTimers();
		},
	};
}

// The state of the sale and of the queue, and the accounts, set up before the visitor acts.
function setupOf(h: Harness, webFetch: typeof fetch) {
	return {
		async addSale(spec: SaleSpec) {
			h.backend.setSale(spec);
		},
		cutOff: () => h.backend.cutOff(true),
		slowAdmission: () => {
			h.backend.settings.slowAdmission = true;
		},
		queueAhead: (count: number) => h.backend.queueAhead(count),
		async hasAccount(user: string, password: string) {
			h.backend.addAccount(user, password);
		},
		async loggedIn(user: string) {
			await webFetch(
				API_PATHS.authRegister,
				jsonPost(JSON.stringify({ username: user, password: PASSWORD })),
			);
		},
		loginEnds: () => h.backend.endLogins(),
		accessTokenEnds: () => h.backend.endAccessTokens(),
		holdsLastItem: (user: string) => {
			h.backend.giveHold(user);
		},
		hasBought: (user: string) => h.backend.giveItem(user),
		holds: (user: string) => h.backend.giveHold(user),
		purchaseIdOf: (user: string) => h.backend.purchaseIdOf(user),
		writeLimit: (count: number) => {
			h.backend.settings.writesPerUser = count;
		},
		paymentDeclines: () => {
			h.backend.settings.paymentDeclines = true;
		},
		holdSeconds: (seconds: number) => {
			h.backend.settings.holdSeconds = seconds;
		},
		admissionEndsBeforeHold: () => {
			h.backend.settings.admissionEnds = true;
		},
		serverFails: (error: "internal" | "unavailable") => {
			h.backend.settings.failWith = error;
		},
	};
}

// The visitor: opens the page, fills the forms, and presses the buttons.
function pageOf(
	h: Harness,
	backendFetch: typeof fetch,
	webFetch: typeof fetch,
) {
	return {
		async openPage() {
			h.load = await loadSale(ENV, backendFetch);
			const api = createWebApi("", webFetch, { live: LIVE_RETRY });
			await act(async () => {
				render(<SalePage load={h.load} api={api} />);
				await settle();
			});
		},
		signUp: (user: string, password: string) =>
			enter("I am new", user, password, "Sign up"),
		logIn: (user: string, password: string) =>
			enter("I have an account", user, password, "Log in"),
		logOut: () => inPage(() => click("Log out")),
		pressBuyNow: () => inPage(() => click("Buy Now")),
		pressCheck: () => inPage(() => click("Check my status")),
		pressConfirm: () =>
			inPage(() => {
				fireEvent.click(
					screen.getByRole("button", { name: "Confirm purchase" }),
				);
			}),
		setSold: (sold: number) => inPage(() => h.backend.setSold(sold)),
		endSale: () => inPage(() => h.backend.endSale()),
		openSale: () => inPage(() => h.backend.openSale()),
		loseQueue: () => inPage(() => h.backend.loseQueue()),
		// The backend stops answering and its open streams end. The page's watcher opens each stream again, fails, and gives up
		// after its last attempt, which the fake clock reaches by moving past the longest wait.
		liveUpdatesFail: () =>
			act(async () => {
				h.backend.cutOff(true);
				dropStreams(h);
				await vi.advanceTimersByTimeAsync(GIVE_UP_WITHIN_MS);
			}),
		// The connection of every open stream ends, as when a network blips. The watcher opens each one again.
		liveConnectionDrops: () => inPage(() => dropStreams(h)),
		connectionFails: () => {
			h.browserDown = true;
		},
		advance: (seconds: number) =>
			act(async () => {
				await vi.advanceTimersByTimeAsync(seconds * MS_PER_SECOND);
			}),
	};
}

// What the visitor sees. Each check reads the page as it is now.
function expectationsOf(h: Harness) {
	return {
		async expectPageSays(text: string) {
			expect(document.body.textContent).toContain(text);
		},
		async expectPageNotSays(text: string) {
			expect(document.body.textContent).not.toContain(text);
		},
		async secondsToConfirm() {
			return secondsToConfirmIn(document.body.textContent ?? "");
		},
		async expectButton(name: string, state: "enabled" | "disabled") {
			const button = screen.getByRole("button", { name }) as HTMLButtonElement;
			expect(button.disabled).toBe(state === "disabled");
		},
		async expectNoButton(name: string) {
			expect(screen.queryByRole("button", { name })).toBeNull();
		},
		async expectNoLogin() {
			expect(h.jar.has(ACCESS_COOKIE)).toBe(false);
			expect(h.jar.has(REFRESH_COOKIE)).toBe(false);
		},
	};
}

// The page as the server renders it, and the request a scenario sends to the web server.
function apiOf(h: Harness, webFetch: typeof fetch) {
	return {
		renderedPage: () =>
			renderToStaticMarkup(<HomePage status="ok" sale={h.load} />) +
			document.body.innerHTML,
		apiAddress: () => BACKEND,
		callerAddress: () => CALLER,
		apiTold: (header: string) => h.backend.told(header),
		async send(
			method: "GET" | "POST",
			path: string,
			body?: unknown,
			origin?: string,
			written: Record<string, string> = {},
		) {
			const before = h.backend.requestCount();
			const reply = await webFetch(path, {
				method,
				headers: {
					...written,
					...(body === undefined ? {} : { "content-type": JSON_CONTENT_TYPE }),
					...(origin === undefined ? {} : { origin }),
				},
				body: body === undefined ? null : JSON.stringify(body),
			});
			return {
				status: reply.status,
				json: (await reply.json()) as Record<string, unknown>,
				cookies: reply.headers.getSetCookie(),
				reachedApi: h.backend.requestCount() > before,
				requestId: reply.headers.get("x-request-id"),
			};
		},
	};
}

// The unit world. Every scenario gets the same one, and `reset` makes it fresh.
export function unitWorld(): WebWorld {
	const h: Harness = {
		backend: createFakeBackend(() => Date.now()),
		load: { state: "none" },
		jar: createCookieJar(),
		streams: new Set(),
		browserDown: false,
	};
	const backendFetch = backendFetchOf(h);
	const webFetch = webFetchOf(h, backendFetch);
	return {
		saleId: SALE_ID,
		now: () => new Date(),
		...lifecycleOf(h),
		...setupOf(h, webFetch),
		...pageOf(h, backendFetch, webFetch),
		...expectationsOf(h),
		...apiOf(h, webFetch),
	};
}
