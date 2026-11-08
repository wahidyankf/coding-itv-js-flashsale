// The unit world: the scenarios' page, the browser and the web server, all in memory. The page, the client, the proxy and
// the loader are the real code. flash-be is the fake backend, called as a function, and time is fake, so a scenario can
// move it. The unit scenarios run here under Vitest. Test support only.

import { API_PATHS, MS_PER_SECOND } from "@flash/flash-commons";
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
import type { Watcher } from "../../sale/sse";
import { SalePage } from "../../sale-page";
import { createWebApi } from "../../web-api";
import { createCookieJar } from "./cookie-jar";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "./fake-account";
import { createFakeBackend, type FakeBackend } from "./fake-backend";
import { matchRoute } from "./fake-http";
import { SALE_ID, type SaleSpec } from "./fake-state";
import type { WebWorld } from "./web-world";

const BACKEND = "http://flash-be.test";
const ENV = { FLASH_BE_URL: BACKEND };
const START = new Date("2026-06-01T12:00:00Z");
const SITE = "http://web.test";
// The address the web server's socket sees every request come from. The Node server puts it on the request as `ip`.
const CALLER = "192.0.2.10";
// The password of a shopper that a scenario logs in without naming one.
const PASSWORD = "a long password";
// How many times the page is given a turn to settle after an action.
const SETTLE_ROUNDS = 10;

// What the scenarios share: the fake flash-be (replaced on reset), what the page loaded, and what the browser keeps.
type Harness = {
	backend: FakeBackend;
	load: SaleLoad;
	jar: ReturnType<typeof createCookieJar>;
	// The give-up callbacks of the live streams that are open now.
	giveUps: Set<() => void>;
};

// The fake flash-be as a fetch. Its answers are the replies of the fake, as flash-be would send them.
function backendFetchOf(h: Harness): typeof fetch {
	return async (input, init) => {
		const url = new URL(String(input));
		const headers = new Headers(init?.headers);
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

// The event streams, pushed from the fake's changes the way the real streams push from flash-be. A stream sends a value
// only when it differs from the last one.
function watchOf(h: Harness): Watcher {
	return (url, onEvent, subscription = {}) => {
		const stop = streamOf(h, url, onEvent, subscription.headers ?? {});
		// The give-up is kept, so a scenario can make the streams give up as the real watcher does after its retries.
		const giveUp = subscription.onGiveUp;
		if (giveUp) h.giveUps.add(giveUp);
		return () => {
			stop();
			if (giveUp) h.giveUps.delete(giveUp);
		};
	};
}

// The fake of one stream: what it sends, and when it sends it. Returns the way to stop it.
function streamOf(
	h: Harness,
	url: string,
	onEvent: (event: string, data: unknown) => void,
	headers: Record<string, string>,
): () => void {
	const match = matchRoute("GET", url.replace(/^.*?(?=\/api)/, ""));
	let last = "";
	const send = (event: string, data: unknown) => {
		const key = JSON.stringify([event, data]);
		if (key === last) return;
		last = key;
		onEvent(event, data);
	};
	if (match?.name === "saleEvents") {
		const push = () => h.backend.hasSale() && send("sale", h.backend.view());
		push();
		return h.backend.onChange(push);
	}
	// The user is the one whose cookie the browser holds.
	const user =
		h.backend.userOf(h.jar.header(url.replace(/^.*?(?=\/api)/, ""))) ?? "";
	if (user === "" || headers[TICKET_HEADER] !== `ticket-${user}`) {
		return () => {};
	}
	const push = () =>
		send("place", { userId: user, ...h.backend.placeOf(user) });
	push();
	return h.backend.onChange(push);
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
			h.giveUps.clear();
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
	};
}

// The visitor: opens the page, fills the forms, and presses the buttons.
function pageOf(
	h: Harness,
	backendFetch: typeof fetch,
	webFetch: typeof fetch,
	watch: Watcher,
) {
	return {
		async openPage() {
			h.load = await loadSale(ENV, backendFetch);
			const api = createWebApi("", webFetch, { watch });
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
		// The unit world does not replay the retries (sse_tests.ts proves those). It gives the page the report the
		// watcher makes after its last attempt, for every stream that is open.
		liveUpdatesFail: () =>
			inPage(() => {
				const giveUps = [...h.giveUps];
				h.giveUps.clear();
				for (const giveUp of giveUps) giveUp();
			}),
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
		giveUps: new Set(),
	};
	const backendFetch = backendFetchOf(h);
	const webFetch = webFetchOf(h, backendFetch);
	const watch = watchOf(h);
	return {
		saleId: SALE_ID,
		now: () => new Date(),
		...lifecycleOf(h),
		...setupOf(h, webFetch),
		...pageOf(h, backendFetch, webFetch, watch),
		...expectationsOf(h),
		...apiOf(h, webFetch),
	};
}
