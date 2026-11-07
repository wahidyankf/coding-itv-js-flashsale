// The integration world: real HTTP and real time. The page, the client, the proxy and the loader are the real code. The
// fake flash-be runs behind a loopback port, and a second loopback port is the web server that runs the proxy. The
// scenarios run here under Vitest with the node environment. Test support only.
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	JSON_CONTENT_TYPE,
	jsonPost,
	MS_PER_SECOND,
	TICKET_HEADER,
} from "../../api";
import { proxyToBackend } from "../../proxy";
import { HomePage } from "../../routes/index";
import { loadSale, type SaleLoad } from "../../sale/load";
import { SalePage } from "../../sale-page";
import { createWebApi } from "../../web-api";
import { createCookieJar } from "./cookie-jar";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "./fake-account";
import { createFakeBackend, type FakeBackend } from "./fake-backend";
import { type Match, matchRoute } from "./fake-http";
import { SALE_ID, type SaleSpec } from "./fake-state";
import type { WebWorld } from "./web-world";

const WAIT = { timeout: 8000, interval: 50 };
// The password of a shopper that a scenario logs in without naming one.
const PASSWORD = "a long password";
// How long the page waits before it opens a live stream again, after the stream ended or failed. Short, so a scenario
// that cuts the stream does not wait long for the page to come back.
const RETRY_MS = 200;

function listen(server: Server): Promise<string> {
	return new Promise((resolve) =>
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address() as AddressInfo;
			resolve(`http://127.0.0.1:${port}`);
		}),
	);
}

function stop(server: Server): Promise<void> {
	server.closeAllConnections();
	return new Promise((resolve) => server.close(() => resolve()));
}

async function readBody(request: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString("utf8");
}

// Writes one event of a stream, unless the same frame was just written.
function pushFrames(
	backend: FakeBackend,
	match: Match,
	user: string,
	response: ServerResponse,
): () => void {
	const isPlace = match.name === "placeEvents";
	let last = "";
	return () => {
		if (!backend.hasSale()) return;
		const [event, data] = isPlace
			? ["place", { userId: user, ...backend.placeOf(user) }]
			: ["sale", backend.view()];
		const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
		if (frame === last) return;
		last = frame;
		response.write(frame);
	};
}

// Opens an event stream on the fake flash-be. A place stream is a shopper's own: the cookie says who, and the ticket
// proves the place.
function stream(
	backend: FakeBackend,
	match: Match,
	ticket: string | undefined,
	request: IncomingMessage,
	response: ServerResponse,
): void {
	const isPlace = match.name === "placeEvents";
	const user = backend.userOf(request.headers.cookie) ?? "";
	if (backend.isCutOff()) throw new Error("unreachable");
	if (isPlace && (user === "" || ticket !== `ticket-${user}`)) {
		response.writeHead(401).end();
		return;
	}
	response.writeHead(200, { "content-type": "text/event-stream" });
	const push = pushFrames(backend, match, user, response);
	push();
	const off = backend.onChange(push);
	request.on("close", off);
}

// The fake flash-be, spoken over HTTP, including the two event streams.
function backendServer(current: () => FakeBackend): Server {
	return createServer(async (request, response) => {
		const backend = current();
		const path = request.url ?? "";
		const header = request.headers[TICKET_HEADER];
		const ticket = typeof header === "string" ? header : undefined;
		try {
			const match = matchRoute(request.method ?? "GET", path);
			if (match?.name === "saleEvents" || match?.name === "placeEvents") {
				return stream(backend, match, ticket, request, response);
			}
			const text = await readBody(request);
			const reply = backend.handle(
				request.method ?? "GET",
				path,
				{ [TICKET_HEADER]: ticket, cookie: request.headers.cookie },
				text ? JSON.parse(text) : {},
			);
			response.writeHead(reply.status, {
				"content-type": JSON_CONTENT_TYPE,
				...reply.headers,
				...(reply.cookies?.length ? { "set-cookie": reply.cookies } : {}),
			});
			response.end(JSON.stringify(reply.body));
		} catch {
			// An unreachable backend: the connection just breaks.
			request.socket.destroy();
		}
	});
}

// The request headers, as the proxy takes them. Only text headers are kept.
function headersOf(request: IncomingMessage): Headers {
	const headers = new Headers();
	for (const [name, value] of Object.entries(request.headers)) {
		if (typeof value === "string") headers.set(name, value);
	}
	return headers;
}

// Hands one browser request to the proxy, and writes the answer back, cookies included.
async function relay(
	request: IncomingMessage,
	response: ServerResponse,
	backendUrl: () => string,
): Promise<void> {
	const controller = new AbortController();
	response.on("close", () => controller.abort());
	const body = request.method === "POST" ? await readBody(request) : null;
	const reply = await proxyToBackend(
		new Request(new URL(request.url ?? "/", "http://web.test"), {
			method: request.method ?? "GET",
			headers: headersOf(request),
			body,
			signal: controller.signal,
		}),
		{ FLASH_BE_URL: backendUrl() },
	);
	response.writeHead(reply.status, {
		...Object.fromEntries(reply.headers),
		// Several cookies are several headers, which a plain object cannot hold.
		"set-cookie": reply.headers.getSetCookie(),
	});
	try {
		if (reply.body) {
			for await (const chunk of reply.body) response.write(chunk);
		}
	} catch {
		// The client went away while the stream was open.
	}
	response.end();
}

// The web server: the proxy, on a real port.
function webServer(backendUrl: () => string): Server {
	return createServer((request, response) => {
		void relay(request, response, backendUrl);
	});
}

// What the scenarios share: the fake flash-be (replaced on reset), what the page loaded, the browser's cookies, and the
// two addresses.
type Harness = {
	backend: FakeBackend;
	load: SaleLoad;
	jar: ReturnType<typeof createCookieJar>;
	webUrl: string;
	backendUrl: string;
};

// The browser's fetch: real HTTP to the web server, with the cookies the browser keeps and the site a POST comes from.
function browserFetchOf(h: Harness): typeof fetch {
	return async (input, init) => {
		const url = new URL(String(input));
		const headers = new Headers(init?.headers);
		const cookie = h.jar.header(url.pathname);
		if (cookie !== undefined) headers.set("cookie", cookie);
		if (init?.method === "POST" && !headers.has("origin")) {
			headers.set("origin", h.webUrl);
		}
		const reply = await fetch(url, { ...init, headers });
		h.jar.store(reply.headers.getSetCookie());
		return reply;
	};
}

// The page helpers. Each waits for the page, since the answers arrive over real HTTP.
const fill = (label: RegExp, value: string) =>
	fireEvent.change(screen.getByLabelText(label), { target: { value } });
// The page answers "who am I" after it is shown, so a button may need a moment to appear.
const click = async (name: string): Promise<void> => {
	fireEvent.click(await screen.findByRole("button", { name }, WAIT));
};
const enter = async (
	mode: "I have an account" | "I am new",
	user: string,
	password: string,
	submit: string,
) => {
	await click(mode);
	fill(/Username/, user);
	fill(/Password/, password);
	await click(submit);
};

// Starting a scenario and ending it: the fake flash-be, the browser's cookies, the servers, and the clock.
function lifecycleOf(h: Harness, servers: { web: Server; backend: Server }) {
	return {
		saleId: SALE_ID,
		now: () => new Date(),
		reset() {
			h.backend = createFakeBackend(() => Date.now());
			h.load = { state: "none" };
			h.jar.clear();
		},
		clear: () => cleanup(),
		async close() {
			await stop(servers.web);
			await stop(servers.backend);
		},
	};
}

// The state of the sale and of the queue, and the accounts, set up before the visitor acts.
function setupOf(h: Harness, browserFetch: typeof fetch) {
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
			await browserFetch(
				`${h.webUrl}/api/auth/register`,
				jsonPost(JSON.stringify({ username: user, password: PASSWORD })),
			);
		},
		loginEnds: () => h.backend.endLogins(),
		accessTokenEnds: () => h.backend.endAccessTokens(),
		holdsLastItem: (user: string) => h.backend.giveHold(user),
		hasBought: (user: string) => h.backend.giveItem(user),
		holds: (user: string) => h.backend.giveHold(user),
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

// The visitor: opens the page, fills the forms, and presses the buttons. Each press waits for the page to answer.
function pageOf(h: Harness, browserFetch: typeof fetch) {
	return {
		async openPage() {
			const loaded = await loadSale({ FLASH_BE_URL: h.backendUrl });
			h.load = loaded;
			render(
				<SalePage
					load={loaded}
					api={createWebApi(h.webUrl, browserFetch, { retryMs: RETRY_MS })}
				/>,
			);
			// A sale page asks who is logged in first; the scenario goes on once it knows.
			if (loaded.state === "ok") {
				await waitFor(() => {
					if (screen.queryByText("Checking your login…")) {
						throw new Error("the page is still checking the login");
					}
				}, WAIT);
			}
		},
		signUp: (user: string, password: string) =>
			enter("I am new", user, password, "Sign up"),
		logIn: (user: string, password: string) =>
			enter("I have an account", user, password, "Log in"),
		logOut: () => click("Log out"),
		pressBuyNow: () => click("Buy Now"),
		pressCheck: () => click("Check my status"),
		async pressConfirm() {
			// The button is enabled once the hold is shown, which can take a moment after the click before it.
			await waitFor(() => {
				const button = screen.getByRole("button", {
					name: "Confirm purchase",
				}) as HTMLButtonElement;
				if (button.disabled) throw new Error("not holding yet");
			}, WAIT);
			fireEvent.click(screen.getByRole("button", { name: "Confirm purchase" }));
		},
		async setSold(sold: number) {
			h.backend.setSold(sold);
		},
		async endSale() {
			h.backend.endSale();
		},
		advance: (seconds: number) =>
			new Promise<void>((resolve) =>
				setTimeout(resolve, seconds * MS_PER_SECOND),
			),
	};
}

// What the visitor sees. Each check waits for the page to catch up, so a slow layer does not fail a correct page.
function expectationsOf(h: Harness) {
	return {
		async expectPageSays(text: string) {
			await waitFor(() => {
				if (!document.body.textContent?.includes(text)) {
					throw new Error(`the page does not say "${text}"`);
				}
			}, WAIT);
		},
		async expectButton(name: string, state: "enabled" | "disabled") {
			await waitFor(() => {
				const button = screen.getByRole("button", {
					name,
				}) as HTMLButtonElement;
				if (button.disabled !== (state === "disabled")) {
					throw new Error(`the "${name}" button is not ${state}`);
				}
			}, WAIT);
		},
		async expectNoButton(name: string) {
			await waitFor(() => {
				if (screen.queryByRole("button", { name })) {
					throw new Error(`the page still has a "${name}" button`);
				}
			}, WAIT);
		},
		async expectNoLogin() {
			await waitFor(() => {
				if (h.jar.has(ACCESS_COOKIE) || h.jar.has(REFRESH_COOKIE)) {
					throw new Error("the browser still holds a login");
				}
			}, WAIT);
		},
	};
}

// The page as the server renders it, the address the web server uses for the API, and a request to the web server.
function apiOf(h: Harness, browserFetch: typeof fetch) {
	return {
		renderedPage: () =>
			renderToStaticMarkup(<HomePage status="ok" sale={h.load} />) +
			document.body.innerHTML,
		apiAddress: () => h.backendUrl,
		async send(
			method: "GET" | "POST",
			path: string,
			body?: unknown,
			origin?: string,
		) {
			const before = h.backend.requestCount();
			const reply = await browserFetch(`${h.webUrl}${path}`, {
				method,
				headers: {
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
			};
		},
	};
}

// The integration world. Starts the two servers, and every scenario gets the same world; `reset` makes it fresh.
export async function integrationWorld(): Promise<
	WebWorld & { close: () => Promise<void> }
> {
	const h: Harness = {
		backend: createFakeBackend(() => Date.now()),
		load: { state: "none" },
		jar: createCookieJar(),
		webUrl: "",
		backendUrl: "",
	};
	const backendHttp = backendServer(() => h.backend);
	h.backendUrl = await listen(backendHttp);
	const webHttp = webServer(() => h.backendUrl);
	h.webUrl = await listen(webHttp);

	// The page updates itself after requests the scenario did not wait for; waitFor catches up with it.
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = false;

	const browserFetch = browserFetchOf(h);
	return {
		...lifecycleOf(h, { web: webHttp, backend: backendHttp }),
		...setupOf(h, browserFetch),
		...pageOf(h, browserFetch),
		...expectationsOf(h),
		...apiOf(h, browserFetch),
	};
}
