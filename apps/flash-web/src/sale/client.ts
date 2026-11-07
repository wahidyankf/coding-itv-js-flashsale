// The browser's calls for the sale: the queue, the hold, the purchase and the outcome, plus the two live streams. The page
// gets this client, so a test can give it a fake. The calls go to the web server, which passes the sale routes on.
import { type ApiResult, callApi, jsonPost, TICKET_HEADER } from "../api";
import { createWatcher, type Watcher } from "./sse";
import type {
	JoinedView,
	OutcomeView,
	Place,
	PlaceView,
	PurchaseView,
	ReservedView,
	SaleView,
} from "./types";

// Everything the page asks of the sale. None of the calls names the shopper: the login cookie does, so one shopper
// cannot act as another.
export type SaleClient = {
	join: (saleId: string) => Promise<ApiResult<JoinedView>>;
	reserve: (saleId: string, ticket: string) => Promise<ApiResult<ReservedView>>;
	confirm: (
		saleId: string,
		reservationId: string,
	) => Promise<ApiResult<PurchaseView>>;
	outcome: (saleId: string) => Promise<ApiResult<OutcomeView>>;
	watchSale: (saleId: string, onSale: (sale: SaleView) => void) => () => void;
	watchPlace: (
		saleId: string,
		ticket: string,
		onPlace: (place: Place) => void,
	) => () => void;
};

// `base` is empty in the browser and a full address in tests. The `fetcher` is the one that renews the login, so these
// calls need not know about it.
export function createSaleClient(
	base = "",
	fetcher: typeof fetch = fetch,
	watch: Watcher = createWatcher({ fetcher }),
): SaleClient {
	const api = `${base}/api`;
	const sale = (saleId: string) => `${api}/sales/${encodeURIComponent(saleId)}`;
	const post = (body: object, headers: Record<string, string> = {}) =>
		jsonPost(JSON.stringify(body), headers);

	return {
		join: (saleId) =>
			callApi<JoinedView>(fetcher, `${sale(saleId)}/queue`, post({})),
		reserve: (saleId, ticket) =>
			callApi<ReservedView>(
				fetcher,
				`${sale(saleId)}/reservations`,
				post({}, { [TICKET_HEADER]: ticket }),
			),
		confirm: (saleId, reservationId) =>
			callApi<PurchaseView>(
				fetcher,
				`${sale(saleId)}/purchases`,
				post({ reservationId }),
			),
		outcome: (saleId) =>
			callApi<OutcomeView>(fetcher, `${sale(saleId)}/purchases/me`),
		// The events are trusted to be what the API sends, like the replies above.
		watchSale: (saleId, onSale) =>
			watch(`${sale(saleId)}/events`, (event, data) => {
				if (event === "sale") onSale(data as SaleView);
			}),
		watchPlace: (saleId, ticket, onPlace) =>
			watch(
				`${sale(saleId)}/queue/me/events`,
				(event, data) => {
					if (event === "place") onPlace(data as PlaceView);
				},
				{ [TICKET_HEADER]: ticket },
			),
	};
}
