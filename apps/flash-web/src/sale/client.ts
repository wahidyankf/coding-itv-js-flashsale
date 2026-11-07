// The browser's calls for the sale: the queue, the hold, the purchase and the outcome, plus the two live streams. The page
// gets this client, so a test can give it a fake. The calls go to the web server, which passes the sale routes on.
import type { Decoder } from "@flash/flash-commons";
import { type ApiResult, callApi, jsonPost, TICKET_HEADER } from "../api";
import { createWatcher, type Watcher } from "./sse";
import {
	decodeJoinedView,
	decodeOutcomeView,
	decodePlaceView,
	decodePurchaseView,
	decodeReservedView,
	decodeSaleView,
	type JoinedView,
	type OutcomeView,
	type Place,
	type PurchaseView,
	type ReservedView,
	type SaleView,
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
	// Each watch calls `onGiveUp` once when the live stream has stopped for good, so the page can say so.
	watchSale: (
		saleId: string,
		onSale: (sale: SaleView) => void,
		onGiveUp: () => void,
	) => () => void;
	watchPlace: (
		saleId: string,
		ticket: string,
		onPlace: (place: Place) => void,
		onGiveUp: () => void,
	) => () => void;
};

// Hands a stream frame to the page only when it decodes. A frame that does not decode is dropped, and `false` tells the
// watcher it was not used, so it is not counted as a sign that the stream is alive.
function deliver<T>(
	decode: Decoder<T>,
	data: unknown,
	onValue: (value: T) => void,
): boolean {
	const decoded = decode(data);
	if (decoded.isErr()) return false;
	onValue(decoded.value);
	return true;
}

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
			callApi(fetcher, `${sale(saleId)}/queue`, decodeJoinedView, post({})),
		reserve: (saleId, ticket) =>
			callApi(
				fetcher,
				`${sale(saleId)}/reservations`,
				decodeReservedView,
				post({}, { [TICKET_HEADER]: ticket }),
			),
		confirm: (saleId, reservationId) =>
			callApi(
				fetcher,
				`${sale(saleId)}/purchases`,
				decodePurchaseView,
				post({ reservationId }),
			),
		outcome: (saleId) =>
			callApi(fetcher, `${sale(saleId)}/purchases/me`, decodeOutcomeView),
		watchSale: (saleId, onSale, onGiveUp) =>
			watch(
				`${sale(saleId)}/events`,
				(event, data) =>
					event === "sale" && deliver(decodeSaleView, data, onSale),
				{ onGiveUp },
			),
		watchPlace: (saleId, ticket, onPlace, onGiveUp) =>
			watch(
				`${sale(saleId)}/queue/me/events`,
				(event, data) =>
					event === "place" && deliver(decodePlaceView, data, onPlace),
				{ headers: { [TICKET_HEADER]: ticket }, onGiveUp },
			),
	};
}
