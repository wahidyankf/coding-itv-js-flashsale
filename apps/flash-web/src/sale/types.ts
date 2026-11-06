import type { ApiFailure, QueuePlace, SaleView } from "@flash/contract";
import type { Result } from "@flash/typekit";

// The shapes of the API come from @flash/contract. Only what the web page adds is defined here.
export type {
	ApiFailure,
	JoinedView,
	OutcomeView,
	PlaceView,
	PurchaseView,
	QueuePlace,
	ReservedView,
	SaleView,
} from "@flash/contract";
export type { SaleStatus } from "@flash/contract/vocabulary";

// What the server renders the first time: the sale, no sale yet, or a sale that could not be read.
export type SaleLoad =
	| { state: "ok"; sale: SaleView }
	| { state: "none" }
	| { state: "error" };

// Where the shopper stands in the line. The ticket and the name that come with a place are not needed to show it.
export type Place = QueuePlace;

// An answer from the web server: the body, or why there is none (the code the API gave, `network`, or `unexpected`).
export type ApiResult<T> = Result<T, ApiFailure>;
