// The fake flash-be that the web scenarios talk to. It follows flash-be's rules for statuses, errors and what a shopper
// sees, and keeps everything in memory. The route groups are in fake-account, fake-queue and fake-purchase; this file
// sends each request to its group, and offers the controls a scenario uses to set the world up. Time comes from `now`,
// so a scenario can move it. Test support only.
import { MS_PER_SECOND } from "@flash/flash-commons";
import { TICKET_HEADER } from "../../api";
import {
	addAccount,
	endAccessTokens,
	endLogins,
	login,
	logout,
	refresh,
	register,
	userOf,
	whoAmI,
} from "./fake-account";
import {
	type Match,
	matchRoute,
	type Reply,
	type RouteName,
	refuse,
	reply,
} from "./fake-http";
import { confirm, giveHold, giveItem, outcome, reserve } from "./fake-purchase";
import { join, queueAhead } from "./fake-queue";
import {
	changed,
	createFakeState,
	type FakeState,
	placeOf,
	SALE_ID,
	type SaleSpec,
	statusOf,
	viewOf,
} from "./fake-state";

// The routes a shopper uses for their own place, hold and purchase. The cookie has named the shopper already.
function shopperRoute(
	state: FakeState,
	name: RouteName,
	user: string,
	headers: Record<string, string | undefined>,
	body: Record<string, unknown>,
): Reply {
	switch (name) {
		case "joinQueue":
			return join(state, user);
		case "reserve":
			return reserve(state, user, headers[TICKET_HEADER]);
		case "confirm":
			return confirm(state, user, String(body.reservationId ?? ""));
		case "outcome":
			return outcome(state, user);
		default:
			return refuse("not_found");
	}
}

// Sends a matched request to its route group. The order is the API's: the account routes need no sale, the sale routes
// need the sale named in the address, and the shopper's own routes need a login.
function answer(
	state: FakeState,
	match: Match,
	headers: Record<string, string | undefined>,
	body: Record<string, unknown>,
): Reply {
	const { name, params } = match;
	const cookies = headers.cookie;
	switch (name) {
		case "register":
			return register(state, body);
		case "login":
			return login(state, body);
		case "refresh":
			return refresh(state, cookies);
		case "logout":
			return logout(state, cookies);
		case "account":
			return whoAmI(state, cookies);
		case "currentSale":
			// Like the real API: a sale that is over is no longer the current sale.
			return state.sale && statusOf(state) !== "ended"
				? reply(200, viewOf(state))
				: refuse("sale_not_found");
		default:
	}
	if (params.saleId !== SALE_ID || !state.sale) return refuse("sale_not_found");
	if (name === "sale") return reply(200, viewOf(state));
	const user = userOf(state, cookies);
	if (user === undefined) return refuse("not_authenticated");
	return shopperRoute(state, name, user, headers, body);
}

// Builds one fake flash-be. The scenario drives it through the controls, and the web server and the page call `handle`.
export function createFakeBackend(now: () => number) {
	const state = createFakeState(now);
	return {
		settings: state.settings,
		onChange(listener: () => void): () => void {
			state.listeners.add(listener);
			return () => state.listeners.delete(listener);
		},
		// Scenario setup: the sale, its stock and window, and whether flash-be can be reached at all.
		setSale(spec: SaleSpec | undefined) {
			state.sale = spec;
			changed(state);
		},
		cutOff(value: boolean) {
			state.unreachable = value;
		},
		isCutOff: () => state.unreachable,
		setSold(sold: number) {
			if (state.sale) state.sale.sold = sold;
			changed(state);
		},
		endSale() {
			if (state.sale) state.sale.endsAt = new Date(now() - MS_PER_SECOND);
			changed(state);
		},
		queueAhead: (count: number) => queueAhead(state, count),
		giveHold: (user: string) => giveHold(state, user),
		giveItem: (user: string) => giveItem(state, user),
		addAccount: (user: string, password: string) =>
			addAccount(state, user, password),
		endLogins: () => endLogins(state),
		endAccessTokens: () => endAccessTokens(state),
		// Reads for the scenario and the event streams.
		userOf: (cookies: string | undefined) => userOf(state, cookies),
		requestCount: () => state.requests,
		view: () => viewOf(state),
		placeOf: (user: string) => placeOf(state, user),
		hasSale: () => state.sale !== undefined,
		// The API. `path` is the path of the contract, such as `/sales/current`.
		handle(
			method: string,
			path: string,
			headers: Record<string, string | undefined>,
			body: Record<string, unknown>,
		): Reply {
			state.requests += 1;
			if (state.unreachable) throw new TypeError("fetch failed");
			const match = matchRoute(method, path);
			return match ? answer(state, match, headers, body) : refuse("not_found");
		},
	};
}

// The type of the fake flash-be, which the worlds drive.
export type FakeBackend = ReturnType<typeof createFakeBackend>;
