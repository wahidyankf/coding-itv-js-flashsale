import {
	createClient,
	type JoinedView,
	type OutcomeView,
	type PurchaseView,
	pathOf,
	type ReservedView,
	readStreamEvent,
	routes,
	type SaleView,
	TICKET_HEADER,
} from "@flash/contract";
import { createWatcher, type Watcher } from "./sse";
import type { ApiResult, Place } from "./types";

// Everything the page asks of the sale, in one place. The page gets a client, so tests can give it a fake.
export type SaleClient = {
	join: (saleId: string, user: string) => Promise<ApiResult<JoinedView>>;
	reserve: (
		saleId: string,
		user: string,
		ticket: string,
	) => Promise<ApiResult<ReservedView>>;
	confirm: (
		saleId: string,
		user: string,
		reservationId: string,
	) => Promise<ApiResult<PurchaseView>>;
	outcome: (saleId: string, user: string) => Promise<ApiResult<OutcomeView>>;
	watchSale: (saleId: string, onSale: (sale: SaleView) => void) => () => void;
	watchPlace: (
		saleId: string,
		user: string,
		ticket: string,
		onPlace: (place: Place) => void,
	) => () => void;
};

// The browser talks to its own web server under /api, which passes the sale routes on. `base` is empty in the browser
// and a full address in tests.
export function createSaleClient(
	base = "",
	fetcher: typeof fetch = fetch,
	watch: Watcher = createWatcher({ fetcher }),
): SaleClient {
	const baseUrl = `${base}/api`;
	const api = createClient({ baseUrl, fetch: fetcher });

	return {
		join: async (saleId, userId) =>
			(
				await api.call(routes.joinQueue, {
					params: { saleId },
					body: { userId },
				})
			).map((reply) => reply.body),
		reserve: async (saleId, userId, ticket) =>
			(
				await api.call(routes.reserve, {
					params: { saleId },
					headers: { [TICKET_HEADER]: ticket },
					body: { userId },
				})
			).map((reply) => reply.body),
		confirm: async (saleId, userId, reservationId) =>
			(
				await api.call(routes.confirm, {
					params: { saleId },
					body: { userId, reservationId },
				})
			).map((reply) => reply.body),
		outcome: async (saleId, userId) =>
			(await api.call(routes.outcome, { params: { saleId, userId } })).map(
				(reply) => reply.body,
			),
		watchSale: (saleId, onSale) =>
			watch(
				`${baseUrl}${pathOf(routes.saleEvents, { saleId })}`,
				(event, data) => {
					const read = readStreamEvent({ event, data });
					if (read?.event === "sale") onSale(read.data);
				},
			),
		watchPlace: (saleId, userId, ticket, onPlace) =>
			watch(
				`${baseUrl}${pathOf(routes.placeEvents, { saleId, userId })}`,
				(event, data) => {
					const read = readStreamEvent({ event, data });
					if (read?.event === "place") onPlace(read.data);
				},
				{ [TICKET_HEADER]: ticket },
			),
	};
}
