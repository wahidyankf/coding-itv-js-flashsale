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
import { proxyToBackend } from "../../proxy";
import { HomePage } from "../../routes/index";
import { createSaleClient } from "../../sale/client";
import { loadSale } from "../../sale/load";
import { SalePage } from "../../sale/sale-page";
import { createWatcher } from "../../sale/sse";
import type { SaleLoad } from "../../sale/types";
import { createFakeBackend, type FakeBackend, SALE_ID } from "./fake-backend";
import type { WebWorld } from "./web-world";

const WAIT = { timeout: 8000, interval: 50 };

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

// The fake flash-be, spoken over HTTP, including the two event streams.
function backendServer(current: () => FakeBackend): Server {
	return createServer(async (request, response) => {
		const backend = current();
		const path = (request.url ?? "").replace(/^\/sales\//, "");
		const header = request.headers["x-queue-ticket"];
		const ticket = typeof header === "string" ? header : undefined;
		try {
			if (request.method === "GET" && path.endsWith("/events")) {
				return stream(backend, path, ticket, request, response);
			}
			const text = await readBody(request);
			const reply = backend.handle(
				request.method ?? "GET",
				path,
				{ "x-queue-ticket": ticket },
				text ? JSON.parse(text) : {},
			);
			response.writeHead(reply.status, {
				"content-type": "application/json",
				...reply.headers,
			});
			response.end(JSON.stringify(reply.body));
		} catch {
			// An unreachable backend: the connection just breaks.
			request.socket.destroy();
		}
	});
}

function stream(
	backend: FakeBackend,
	path: string,
	ticket: string | undefined,
	request: IncomingMessage,
	response: ServerResponse,
): void {
	const parts = path.split("/");
	const user = decodeURIComponent(parts[2] ?? "");
	const isPlace = parts[1] === "queue";
	if (backend.isCutOff()) throw new Error("unreachable");
	if (isPlace && ticket !== `ticket-${user}`) {
		response.writeHead(401).end();
		return;
	}
	response.writeHead(200, { "content-type": "text/event-stream" });
	let last = "";
	const push = () => {
		if (!backend.hasSale()) return;
		const [event, data] = isPlace
			? ["place", { userId: user, ...backend.placeOf(user) }]
			: ["sale", backend.view()];
		const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
		if (frame === last) return;
		last = frame;
		response.write(frame);
	};
	push();
	const off = backend.onChange(push);
	request.on("close", off);
}

// The web server: the proxy route, on a real port.
function webServer(backendUrl: () => string): Server {
	return createServer(async (request, response) => {
		const controller = new AbortController();
		response.on("close", () => controller.abort());
		const headers = new Headers();
		for (const [name, value] of Object.entries(request.headers)) {
			if (typeof value === "string") headers.set(name, value);
		}
		const body = request.method === "POST" ? await readBody(request) : null;
		const reply = await proxyToBackend(
			new Request(new URL(request.url ?? "/", "http://web.test"), {
				method: request.method ?? "GET",
				headers,
				body,
				signal: controller.signal,
			}),
			{ FLASH_BE_URL: backendUrl() },
		);
		response.writeHead(reply.status, Object.fromEntries(reply.headers));
		try {
			if (reply.body) {
				for await (const chunk of reply.body) response.write(chunk);
			}
		} catch {
			// The client went away while the stream was open.
		}
		response.end();
	});
}

// The integration world uses real HTTP and real time. The page, the client, the proxy and the loader are the real
// code; flash-be is the fake backend behind a loopback port.
export async function integrationWorld(): Promise<
	WebWorld & { close: () => Promise<void> }
> {
	let backend: FakeBackend = createFakeBackend(() => Date.now());
	let load: SaleLoad = { state: "none" };
	const backendHttp = backendServer(() => backend);
	const backendUrl = await listen(backendHttp);
	const webHttp = webServer(() => backendUrl);
	const webUrl = await listen(webHttp);

	// The page updates itself after requests the scenario did not wait for; waitFor catches up with it.
	(
		globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
	).IS_REACT_ACT_ENVIRONMENT = false;

	const type = (name: string) =>
		fireEvent.change(screen.getByLabelText(/Your name/), {
			target: { value: name },
		});

	return {
		saleId: SALE_ID,
		now: () => new Date(),
		reset() {
			backend = createFakeBackend(() => Date.now());
			load = { state: "none" };
		},
		clear: () => cleanup(),
		async close() {
			await stop(webHttp);
			await stop(backendHttp);
		},
		async addSale(spec) {
			backend.setSale(spec);
		},
		cutOff: () => backend.cutOff(true),
		slowAdmission: () => {
			backend.settings.slowAdmission = true;
		},
		queueAhead: (count) => backend.queueAhead(count),
		holdsLastItem: (user) => backend.giveHold(user),
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
			load = await loadSale({ FLASH_BE_URL: backendUrl });
			render(
				<SalePage
					load={load}
					client={createSaleClient(
						webUrl,
						fetch,
						createWatcher({ retryMs: 200 }),
					)}
				/>,
			);
		},
		async pressBuyNow(name) {
			type(name);
			fireEvent.click(screen.getByRole("button", { name: "Buy Now" }));
		},
		async pressCheck(name) {
			type(name);
			fireEvent.click(screen.getByRole("button", { name: "Check my status" }));
		},
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
		async setSold(sold) {
			backend.setSold(sold);
		},
		async endSale() {
			backend.endSale();
		},
		advance: (seconds) =>
			new Promise((resolve) => setTimeout(resolve, seconds * 1000)),
		async expectPageSays(text) {
			await waitFor(() => {
				if (!document.body.textContent?.includes(text)) {
					throw new Error(`the page does not say "${text}"`);
				}
			}, WAIT);
		},
		async expectButton(name, state) {
			await waitFor(() => {
				const button = screen.getByRole("button", {
					name,
				}) as HTMLButtonElement;
				if (button.disabled !== (state === "disabled")) {
					throw new Error(`the "${name}" button is not ${state}`);
				}
			}, WAIT);
		},
		renderedPage: () =>
			renderToStaticMarkup(<HomePage status="ok" sale={load} />) +
			document.body.innerHTML,
		apiAddress: () => backendUrl,
		async send(method, path, body) {
			const reply = await fetch(`${webUrl}${path}`, {
				method,
				headers:
					body === undefined ? {} : { "content-type": "application/json" },
				body: body === undefined ? null : JSON.stringify(body),
			});
			return {
				status: reply.status,
				json: (await reply.json()) as Record<string, unknown>,
			};
		},
	};
}
