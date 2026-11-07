import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, vi } from "vitest";
import { TICKET_HEADER } from "../../api";
import { createWebApi } from "../../auth/web-api";
import { proxyToBackend } from "../../proxy";
import { HomePage } from "../../routes/index";
import { loadSale } from "../../sale/load";
import { SalePage } from "../../sale/sale-page";
import type { Watcher } from "../../sale/sse";
import type { SaleLoad } from "../../sale/types";
import { createCookieJar } from "./cookie-jar";
import {
	createFakeBackend,
	type FakeBackend,
	matchRoute,
	SALE_ID,
} from "./fake-backend";
import type { WebWorld } from "./web-world";

const BACKEND = "http://flash-be.test";
const ENV = { FLASH_BE_URL: BACKEND };
const START = new Date("2026-06-01T12:00:00Z");
const SITE = "http://web.test";
// The password of a shopper that a scenario logs in without naming one.
const PASSWORD = "a long password";

// The unit world keeps everything in memory. The page, the client and the proxy are the real code; flash-be is the
// fake backend, and time is fake, so a scenario can move it.
export function unitWorld(): WebWorld {
	let backend: FakeBackend = createFakeBackend(() => Date.now());
	let load: SaleLoad = { state: "none" };
	// What the browser keeps between requests.
	const jar = createCookieJar();

	// The fake flash-be, as a fetch.
	const backendFetch: typeof fetch = async (input, init) => {
		const url = new URL(String(input));
		const path = url.pathname;
		const headers = new Headers(init?.headers);
		const text = typeof init?.body === "string" ? init.body : "";
		const reply = backend.handle(
			init?.method ?? "GET",
			path,
			{
				"x-queue-ticket": headers.get("x-queue-ticket") ?? undefined,
				cookie: headers.get("cookie") ?? undefined,
			},
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

	// The browser and the web server: the page's requests go through the real proxy to the fake flash-be. Like a browser,
	// it sends the cookies that match the path, says which site a POST comes from, and keeps the cookies that come back.
	const webFetch: typeof fetch = async (input, init) => {
		const url = new URL(String(input), SITE);
		const headers = new Headers(init?.headers);
		const cookie = jar.header(url.pathname);
		if (cookie !== undefined) headers.set("cookie", cookie);
		if (init?.method === "POST" && !headers.has("origin")) {
			headers.set("origin", SITE);
		}
		const reply = await proxyToBackend(
			new Request(url, { ...init, headers }),
			ENV,
			backendFetch,
		);
		jar.store(reply.headers.getSetCookie());
		return reply;
	};

	// Streams are pushed from the fake backend's changes, the way the real streams push from flash-be.
	const watch: Watcher = (url, onEvent, headers = {}) => {
		const match = matchRoute("GET", url.replace(/^.*?\/api/, ""));
		let last = "";
		const send = (event: string, data: unknown) => {
			const key = JSON.stringify([event, data]);
			if (key === last) return;
			last = key;
			onEvent(event, data);
		};
		if (match?.name === "saleEvents") {
			const push = () => backend.hasSale() && send("sale", backend.view());
			push();
			return backend.onChange(push);
		}
		// The user is the one whose cookie the browser holds.
		const user =
			backend.userOf(jar.header(url.replace(/^.*?(?=\/api)/, ""))) ?? "";
		if (user === "" || headers[TICKET_HEADER] !== `ticket-${user}`) {
			return () => {};
		}
		const push = () =>
			send("place", { userId: user, ...backend.placeOf(user) });
		push();
		return backend.onChange(push);
	};

	// Lets the promises of a request and the effects that follow run.
	const settle = async () => {
		for (let round = 0; round < 10; round++) {
			await vi.advanceTimersByTimeAsync(0);
		}
	};
	const inPage = async (action: () => void | Promise<void>) => {
		await act(async () => {
			await action();
			await settle();
		});
	};

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

	return {
		saleId: SALE_ID,
		now: () => new Date(),
		reset() {
			vi.useFakeTimers();
			vi.setSystemTime(START);
			backend = createFakeBackend(() => Date.now());
			load = { state: "none" };
			jar.clear();
		},
		clear() {
			cleanup();
			vi.useRealTimers();
		},
		async addSale(spec) {
			backend.setSale(spec);
		},
		cutOff: () => backend.cutOff(true),
		slowAdmission: () => {
			backend.settings.slowAdmission = true;
		},
		queueAhead: (count) => backend.queueAhead(count),
		async hasAccount(user, password) {
			backend.addAccount(user, password);
		},
		async loggedIn(user) {
			await webFetch("/api/auth/register", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ username: user, password: PASSWORD }),
			});
		},
		loginEnds: () => backend.endLogins(),
		accessTokenEnds: () => backend.endAccessTokens(),
		holdsLastItem: (user) => {
			backend.giveHold(user);
		},
		hasBought: (user) => backend.giveItem(user),
		holds: (user) => backend.giveHold(user),
		writeLimit: (count) => {
			backend.settings.writesPerUser = count;
		},
		paymentDeclines: () => {
			backend.settings.paymentDeclines = true;
		},
		holdSeconds: (seconds) => {
			backend.settings.holdSeconds = seconds;
		},
		async openPage() {
			load = await loadSale(ENV, backendFetch);
			const api = createWebApi("", webFetch, { watch });
			await act(async () => {
				render(<SalePage load={load} api={api} />);
				await settle();
			});
		},
		signUp: (user, password) => enter("I am new", user, password, "Sign up"),
		logIn: (user, password) =>
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
		setSold: (sold) => inPage(() => backend.setSold(sold)),
		endSale: () => inPage(() => backend.endSale()),
		advance: (seconds) =>
			act(async () => {
				await vi.advanceTimersByTimeAsync(seconds * 1000);
			}),
		async expectPageSays(text) {
			expect(document.body.textContent).toContain(text);
		},
		async expectButton(name, state) {
			const button = screen.getByRole("button", { name }) as HTMLButtonElement;
			expect(button.disabled).toBe(state === "disabled");
		},
		async expectNoButton(name) {
			expect(screen.queryByRole("button", { name })).toBeNull();
		},
		async expectNoLogin() {
			expect(jar.has("access_token")).toBe(false);
			expect(jar.has("refresh_token")).toBe(false);
		},
		renderedPage: () =>
			renderToStaticMarkup(<HomePage status="ok" sale={load} />) +
			document.body.innerHTML,
		apiAddress: () => BACKEND,
		async send(method, path, body, origin) {
			const before = backend.requestCount();
			const reply = await webFetch(path, {
				method,
				headers: {
					...(body === undefined ? {} : { "content-type": "application/json" }),
					...(origin === undefined ? {} : { origin }),
				},
				body: body === undefined ? null : JSON.stringify(body),
			});
			return {
				status: reply.status,
				json: (await reply.json()) as Record<string, unknown>,
				cookies: reply.headers.getSetCookie(),
				reachedApi: backend.requestCount() > before,
			};
		},
	};
}
