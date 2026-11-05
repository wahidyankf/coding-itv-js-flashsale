import { attemptAsync, Err, Ok } from "@flash/typekit";
import { createWatcher, type Watcher } from "./sse";
import type { ApiResult, Outcome, Place, SaleView } from "./types";

// Joining gives a place in the line, or a way in at once. It never says the place is lost.
export type Joined = Exclude<Place, { state: "absent" }>;

// Everything the page asks of the sale, in one place. The page gets a client, so tests can give it a fake.
export type SaleClient = {
	join: (
		saleId: string,
		user: string,
	) => Promise<ApiResult<{ ticket: string } & Joined>>;
	reserve: (
		saleId: string,
		user: string,
		ticket: string,
	) => Promise<ApiResult<{ reservationId: string; expiresAt: string }>>;
	confirm: (
		saleId: string,
		user: string,
		reservationId: string,
	) => Promise<ApiResult<{ purchaseId: string }>>;
	outcome: (saleId: string, user: string) => Promise<ApiResult<Outcome>>;
	watchSale: (saleId: string, onSale: (sale: SaleView) => void) => () => void;
	watchPlace: (
		saleId: string,
		user: string,
		ticket: string,
		onPlace: (place: Place) => void,
	) => () => void;
};

// The browser talks to its own web server under /api/sales. `base` is empty in the browser and a full address in tests.
export function createSaleClient(
	base = "",
	fetcher: typeof fetch = fetch,
	watch: Watcher = createWatcher({ fetcher }),
): SaleClient {
	const path = (saleId: string, rest: string) =>
		`${base}/api/sales/${saleId}${rest}`;
	const user = (name: string) => encodeURIComponent(name);

	async function call<T>(
		method: "GET" | "POST",
		url: string,
		body?: unknown,
		headers: Record<string, string> = {},
	): Promise<ApiResult<T>> {
		const sent = await attemptAsync(async () => {
			const reply = await fetcher(url, {
				method,
				headers:
					body === undefined
						? headers
						: { "content-type": "application/json", ...headers },
				body: body === undefined ? null : JSON.stringify(body),
			});
			// A body that is not JSON is read as empty, so the status still tells what happened.
			const parsed = await attemptAsync(
				() => reply.json() as Promise<Record<string, unknown>>,
				Error,
			);
			return { reply, json: parsed.isOk() ? parsed.value : {} };
		}, Error);
		if (sent.isErr()) return new Err({ error: "network" });

		const { reply, json } = sent.value;
		if (reply.ok) return new Ok(json as T);
		const waited = Number(
			reply.headers.get("retry-after") ?? json.retryAfterSeconds,
		);
		return new Err({
			error: typeof json.error === "string" ? json.error : "unexpected",
			retryAfterSeconds: Number.isFinite(waited) ? waited : undefined,
		});
	}

	return {
		join: (saleId, name) =>
			call("POST", path(saleId, "/queue"), { userId: name }),
		reserve: (saleId, name, ticket) =>
			call(
				"POST",
				path(saleId, "/reservations"),
				{ userId: name },
				{ "x-queue-ticket": ticket },
			),
		confirm: (saleId, name, reservationId) =>
			call("POST", path(saleId, "/purchases"), {
				userId: name,
				reservationId,
			}),
		outcome: (saleId, name) =>
			call("GET", path(saleId, `/purchases/${user(name)}`)),
		watchSale: (saleId, onSale) =>
			watch(path(saleId, "/events"), (event, data) => {
				if (event === "sale") onSale(data as SaleView);
			}),
		watchPlace: (saleId, name, ticket, onPlace) =>
			watch(
				path(saleId, `/queue/${user(name)}/events`),
				(event, data) => {
					if (event === "place") onPlace(data as Place);
				},
				{ "x-queue-ticket": ticket },
			),
	};
}
