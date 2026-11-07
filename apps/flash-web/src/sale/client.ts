// The browser's calls for the sale: the queue, the hold, the purchase and the outcome, plus the two live streams. The page
// gets this client, so a test can give it a fake. The calls go to the web server, which passes the sale routes on.
import type { Decoder } from "@flash/flash-commons";
import { type ApiResult, callApi, jsonPost, TICKET_HEADER } from "../api";
import { type Reporter, reportDecodeFailure } from "../decode-report";
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

// Hands a stream frame to the page only when it decodes. A frame that does not decode is reported with its source, then
// dropped. `false` tells the watcher it was not used, so it is not counted as a sign that the stream is alive.
function deliver<T>(
	source: string,
	decode: Decoder<T>,
	data: unknown,
	onValue: (value: T) => void,
	report: Reporter,
): boolean {
	const decoded = decode(data);
	if (decoded.isErr()) {
		report({
			source,
			path: decoded.error.path,
			expected: decoded.error.expected,
		});
		return false;
	}
	onValue(decoded.value);
	return true;
}

// What a report says about a stream frame: the stream it came on, and the name of its event.
const frameSource = (url: string, event: string) => `${url} event ${event}`;

// `base` is empty in the browser and a full address in tests. The `fetcher` is the one that renews the login, so these
// calls need not know about it. `report` takes each payload that does not decode; the console is the default.
export function createSaleClient(
	base = "",
	fetcher: typeof fetch = fetch,
	watch: Watcher = createWatcher({ fetcher }),
	report: Reporter = reportDecodeFailure,
): SaleClient {
	const api = `${base}/api`;
	const sale = (saleId: string) => `${api}/sales/${encodeURIComponent(saleId)}`;
	const post = (body: object, headers: Record<string, string> = {}) =>
		jsonPost(JSON.stringify(body), headers);

	return {
		join: (saleId) =>
			callApi(
				fetcher,
				`${sale(saleId)}/queue`,
				decodeJoinedView,
				post({}),
				report,
			),
		reserve: (saleId, ticket) =>
			callApi(
				fetcher,
				`${sale(saleId)}/reservations`,
				decodeReservedView,
				post({}, { [TICKET_HEADER]: ticket }),
				report,
			),
		confirm: (saleId, reservationId) =>
			callApi(
				fetcher,
				`${sale(saleId)}/purchases`,
				decodePurchaseView,
				post({ reservationId }),
				report,
			),
		outcome: (saleId) =>
			callApi(
				fetcher,
				`${sale(saleId)}/purchases/me`,
				decodeOutcomeView,
				{},
				report,
			),
		watchSale: (saleId, onSale, onGiveUp) => {
			const url = `${sale(saleId)}/events`;
			return watch(
				url,
				(event, data) =>
					event === "sale" &&
					deliver(
						frameSource(url, event),
						decodeSaleView,
						data,
						onSale,
						report,
					),
				{ onGiveUp },
			);
		},
		watchPlace: (saleId, ticket, onPlace, onGiveUp) => {
			const url = `${sale(saleId)}/queue/me/events`;
			return watch(
				url,
				(event, data) =>
					event === "place" &&
					deliver(
						frameSource(url, event),
						decodePlaceView,
						data,
						onPlace,
						report,
					),
				{ headers: { [TICKET_HEADER]: ticket }, onGiveUp },
			);
		},
	};
}
