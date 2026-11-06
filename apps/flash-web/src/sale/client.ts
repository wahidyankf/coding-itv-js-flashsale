import { callApi, TICKET_HEADER } from "../api";
import { createWatcher, type Watcher } from "./sse";
import type {
	ApiResult,
	JoinedView,
	OutcomeView,
	Place,
	PlaceView,
	PurchaseView,
	ReservedView,
	SaleView,
} from "./types";

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
	const api = `${base}/api`;
	const sale = (saleId: string) => `${api}/sales/${encodeURIComponent(saleId)}`;
	const post = (body: object, headers: Record<string, string> = {}) => ({
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: JSON.stringify(body),
	});

	return {
		join: (saleId, userId) =>
			callApi<JoinedView>(fetcher, `${sale(saleId)}/queue`, post({ userId })),
		reserve: (saleId, userId, ticket) =>
			callApi<ReservedView>(
				fetcher,
				`${sale(saleId)}/reservations`,
				post({ userId }, { [TICKET_HEADER]: ticket }),
			),
		confirm: (saleId, userId, reservationId) =>
			callApi<PurchaseView>(
				fetcher,
				`${sale(saleId)}/purchases`,
				post({ userId, reservationId }),
			),
		outcome: (saleId, userId) =>
			callApi<OutcomeView>(
				fetcher,
				`${sale(saleId)}/purchases/${encodeURIComponent(userId)}`,
			),
		// The events are trusted to be what the API sends, like the replies above.
		watchSale: (saleId, onSale) =>
			watch(`${sale(saleId)}/events`, (event, data) => {
				if (event === "sale") onSale(data as SaleView);
			}),
		watchPlace: (saleId, userId, ticket, onPlace) =>
			watch(
				`${sale(saleId)}/queue/${encodeURIComponent(userId)}/events`,
				(event, data) => {
					if (event === "place") onPlace(data as PlaceView);
				},
				{ [TICKET_HEADER]: ticket },
			),
	};
}
