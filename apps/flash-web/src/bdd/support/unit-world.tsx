import { matchRoute, routes, TICKET_HEADER } from "@flash/contract";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, vi } from "vitest";
import { proxyToBackend } from "../../proxy";
import { HomePage } from "../../routes/index";
import { createSaleClient } from "../../sale/client";
import { loadSale } from "../../sale/load";
import { SalePage } from "../../sale/sale-page";
import type { Watcher } from "../../sale/sse";
import type { SaleLoad } from "../../sale/types";
import { createFakeBackend, type FakeBackend, SALE_ID } from "./fake-backend";
import type { WebWorld } from "./web-world";

const BACKEND = "http://flash-be.test";
const ENV = { FLASH_BE_URL: BACKEND };
const START = new Date("2026-06-01T12:00:00Z");

// The unit world keeps everything in memory. The page, the client and the proxy are the real code; flash-be is the
// fake backend, and time is fake, so a scenario can move it.
export function unitWorld(): WebWorld {
	let backend: FakeBackend = createFakeBackend(() => Date.now());
	let load: SaleLoad = { state: "none" };

	// The fake flash-be, as a fetch.
	const backendFetch: typeof fetch = async (input, init) => {
		const url = new URL(String(input));
		const path = url.pathname;
		const headers = new Headers(init?.headers);
		const text = typeof init?.body === "string" ? init.body : "";
		const reply = backend.handle(
			init?.method ?? "GET",
			path,
			{ "x-queue-ticket": headers.get("x-queue-ticket") ?? undefined },
			text ? JSON.parse(text) : {},
		);
		return Response.json(reply.body, {
			status: reply.status,
			headers: reply.headers,
		});
	};

	// The web server: the page's requests go through the real proxy to the fake flash-be.
	const webFetch: typeof fetch = async (input, init) =>
		proxyToBackend(
			new Request(new URL(String(input), "http://web.test"), init),
			ENV,
			backendFetch,
		);

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
		if (match?.route === routes.saleEvents) {
			const push = () => backend.hasSale() && send("sale", backend.view());
			push();
			return backend.onChange(push);
		}
		const user = match?.params.userId ?? "";
		if (headers[TICKET_HEADER] !== `ticket-${user}`) return () => {};
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

	const type = (name: string) =>
		fireEvent.change(screen.getByLabelText(/Your name/), {
			target: { value: name },
		});

	return {
		saleId: SALE_ID,
		now: () => new Date(),
		reset() {
			vi.useFakeTimers();
			vi.setSystemTime(START);
			backend = createFakeBackend(() => Date.now());
			load = { state: "none" };
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
			const client = createSaleClient("", webFetch, watch);
			await act(async () => {
				render(<SalePage load={load} client={client} />);
				await settle();
			});
		},
		pressBuyNow: (name) =>
			inPage(() => {
				type(name);
				fireEvent.click(screen.getByRole("button", { name: "Buy Now" }));
			}),
		pressCheck: (name) =>
			inPage(() => {
				type(name);
				fireEvent.click(
					screen.getByRole("button", { name: "Check my status" }),
				);
			}),
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
		renderedPage: () =>
			renderToStaticMarkup(<HomePage status="ok" sale={load} />) +
			document.body.innerHTML,
		apiAddress: () => BACKEND,
		async send(method, path, body) {
			const reply = await webFetch(path, {
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
