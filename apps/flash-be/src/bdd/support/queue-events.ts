// The Server-Sent Events streams of a queue scenario: the sale's stream and a shopper's place stream. A stream needs a
// real socket, so the app listens on a free port the first time a scenario opens one.

import type { FastifyInstance } from "fastify";
import { shopperKey, ticketHeader } from "./queue-requests.js";
import type { EventWatcher, ShopScenario } from "./queue-scenario.js";
import { salePath } from "./sale-path.js";

const origins = new WeakMap<FastifyInstance, string>();

// The event streams, the same at every layer. The app listens on a free port, because a stream needs a real socket.
export function eventRequests(app: FastifyInstance, scenario: ShopScenario) {
	const watch = async (
		path: string,
		headers: Record<string, string> = {},
	): Promise<EventWatcher> => {
		let origin = origins.get(app);
		if (!origin) {
			origin = await app.listen({ host: "127.0.0.1", port: 0 });
			origins.set(app, origin);
		}
		const controller = new AbortController();
		const reply = await fetch(`${origin}${path}`, {
			headers,
			signal: controller.signal,
		});
		if (!reply.ok || !reply.body) {
			const refusal: EventWatcher = {
				status: reply.status,
				body: await reply.json(),
				next: () => Promise.reject(new Error("the stream did not open")),
				close: () => {},
			};
			scenario.watcher = refusal;
			return refusal;
		}
		const reader = reply.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		const frames: Array<{ event: string; data: Record<string, unknown> }> = [];
		const fill = async (): Promise<void> => {
			const chunk = await reader.read();
			if (chunk.done) throw new Error("the stream ended");
			buffer += decoder.decode(chunk.value, { stream: true });
			for (
				let end = buffer.indexOf("\n\n");
				end >= 0;
				end = buffer.indexOf("\n\n")
			) {
				const frame = buffer.slice(0, end);
				buffer = buffer.slice(end + 2);
				// A line that starts with a colon is a keep-alive comment.
				if (frame.startsWith(":")) continue;
				const event = /^event: (.*)$/m.exec(frame)?.[1] ?? "message";
				const data = JSON.parse(/^data: (.*)$/m.exec(frame)?.[1] ?? "null");
				frames.push({ event, data });
			}
		};
		const watcher: EventWatcher = {
			status: reply.status,
			body: {},
			async next() {
				const deadline = Date.now() + 5000;
				while (frames.length === 0) {
					if (Date.now() > deadline) throw new Error("no event in time");
					await Promise.race([
						fill(),
						new Promise<void>((resolve) => setTimeout(resolve, 200)),
					]);
				}
				const frame = frames.shift();
				if (!frame) throw new Error("no event");
				return frame;
			},
			close: () => controller.abort(),
		};
		scenario.watcher = watcher;
		return watcher;
	};
	return {
		watchSale: (saleId = scenario.saleId) =>
			watch(salePath("saleEvents", saleId)),
		watchPlace: async (
			user: string,
			ticket?: string,
			saleId = scenario.saleId,
		) => {
			const given = ticket ?? scenario.tickets.get(shopperKey(user));
			return watch(salePath("queueMeEvents", saleId), {
				cookie: await scenario.login(user),
				...ticketHeader(given),
			});
		},
	};
}
