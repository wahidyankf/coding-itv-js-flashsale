import { Err, Ok } from "@flash/typekit";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthClient } from "../auth/client";
import type { Account } from "../auth/types";
import type { WebApi } from "../auth/web-api";
import type { SaleClient } from "./client";
import { SalePage } from "./sale-page";
import type {
	ApiResult,
	JoinedView,
	OutcomeView,
	Place,
	PurchaseView,
	SaleView,
} from "./types";

const SALE: SaleView = {
	id: "11111111-1111-4111-8111-111111111111",
	productId: "22222222-2222-4222-8222-222222222222",
	name: "Flash sale",
	status: "active",
	startsAt: "2026-06-01T11:00:00Z",
	endsAt: "2026-06-01T13:00:00Z",
	stock: 10,
	remaining: 10,
};

afterEach(cleanup);

const failure = (errorCode: string) => ({ errorCode, errorMessage: errorCode });

// A client that answers with what the test gives it and lets the test push place changes.
function stubClient(overrides: Partial<SaleClient> = {}) {
	let push: (place: Place) => void = () => {};
	const client: SaleClient = {
		join: vi.fn(
			async () =>
				new Ok({
					userId: "ana",
					ticket: "t",
					state: "waiting" as const,
					place: 2,
				}),
		),
		reserve: vi.fn(
			async () =>
				new Ok({
					userId: "ana",
					reservationId: "r1",
					expiresAt: new Date(Date.now() + 60_000).toISOString(),
				}),
		),
		confirm: vi.fn(
			async () =>
				new Ok({
					userId: "ana",
					purchaseId: "p1",
					reservationId: "r1",
					purchasedAt: "2026-06-01T12:00:00.000Z",
				}),
		),
		outcome: vi.fn(
			async () => new Ok({ userId: "ana", state: "none" as const }),
		),
		watchSale: () => () => {},
		watchPlace: (_id, _ticket, onPlace) => {
			push = onPlace;
			return () => {};
		},
		...overrides,
	};
	return { client, push: (place: Place) => push(place) };
}

const ANA: Account = { username: "ana", role: "shopper" };

// The pieces of the web API. The shopper is logged in unless a test says otherwise.
function stubApi(
	sale: SaleClient,
	auth: Partial<AuthClient> = {},
): WebApi & { expire: () => void } {
	const listeners = new Set<() => void>();
	return {
		sale,
		auth: {
			me: vi.fn(async () => new Ok(ANA)),
			register: vi.fn(async () => new Ok(ANA)),
			login: vi.fn(async () => new Ok(ANA)),
			logout: vi.fn(async () => new Ok({})),
			...auth,
		},
		onExpired: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		expire: () => {
			for (const listener of listeners) listener();
		},
	};
}

// Renders the page and waits for the answer to "who am I", which comes after the first paint.
async function show(
	load: Parameters<typeof SalePage>[0]["load"],
	api: WebApi,
): Promise<void> {
	await act(async () => {
		render(<SalePage load={load} api={api} />);
	});
}

const OPEN = { state: "ok", sale: SALE } as const;

async function press(name: string): Promise<void> {
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name }));
	});
}

async function buy(): Promise<void> {
	await press("Buy Now");
}

describe("SalePage", () => {
	it("tells a waiting shopper when the place is lost", async () => {
		const { client, push } = stubClient();
		await show(OPEN, stubApi(client));
		await buy();
		expect(screen.getByRole("status").textContent).toContain("Your place: 2");
		await act(async () => push({ state: "absent" }));
		expect(screen.getByRole("status").textContent).toContain(
			"Your place was lost",
		);
	});

	it("moves a waiting shopper on when the place changes and then admits them", async () => {
		const { client, push } = stubClient();
		await show(OPEN, stubApi(client));
		await buy();
		await act(async () => push({ state: "waiting", place: 1 }));
		expect(screen.getByRole("status").textContent).toContain("Your place: 1");
		await act(async () => push({ state: "admitted" }));
		expect(client.reserve).toHaveBeenCalledWith(SALE.id, "t");
		expect(screen.getByRole("status").textContent).toContain("An item is held");
	});

	it("shows the API's reason when a confirm is refused for another cause", async () => {
		const { client } = stubClient({
			join: vi.fn(
				async () =>
					new Ok({ userId: "ana", ticket: "t", state: "admitted" as const }),
			),
			confirm: vi.fn(async () => new Err(failure("hold_expired"))),
		});
		await show(OPEN, stubApi(client));
		await buy();
		await press("Confirm purchase");
		expect(screen.getByRole("status").textContent).toContain(
			"Your hold has ended",
		);
	});

	it("shows the reason when the check is refused", async () => {
		const { client } = stubClient({
			outcome: vi.fn(async () => new Err(failure("network"))),
		});
		await show(OPEN, stubApi(client));
		await press("Check my status");
		expect(screen.getByRole("status").textContent).toContain(
			"could not be reached",
		);
	});

	it("does not send a form that cannot be bought from", async () => {
		const { client } = stubClient();
		await show(
			{ state: "ok", sale: { ...SALE, status: "sold_out" } },
			stubApi(client),
		);
		await act(async () => {
			fireEvent.submit(screen.getByRole("button", { name: "Buy Now" }));
		});
		expect(client.join).not.toHaveBeenCalled();
	});

	it("builds its own API when none is given", () => {
		render(<SalePage load={{ state: "none" }} />);
		expect(screen.getByText("No sale is open right now.")).toBeTruthy();
	});

	it("explains a missing sale calmly, and an unreadable one as an alert", () => {
		const { unmount } = render(<SalePage load={{ state: "none" }} />);
		expect(screen.getByText(/Check back later/)).toBeTruthy();
		expect(screen.queryByRole("alert")).toBeNull();
		unmount();
		render(<SalePage load={{ state: "error" }} />);
		const alert = screen.getByRole("alert");
		expect(alert.textContent).toContain("The sale could not be loaded.");
		expect(alert.textContent).toContain("Reload the page to try again.");
	});

	it("shows the window of the sale and a plain line for its status", async () => {
		await show(
			{ state: "ok", sale: { ...SALE, status: "upcoming" } },
			stubApi(stubClient().client),
		);
		const container = document.body;
		expect(screen.getByText("Buying opens when the sale starts.")).toBeTruthy();
		const times = [...container.querySelectorAll("time")].map((time) =>
			time.getAttribute("datetime"),
		);
		expect(times).toEqual([SALE.startsAt, SALE.endsAt]);
	});
});

// A request that stays open until the test answers it.
function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, answer: (value: T) => resolve(value) };
}

// The spinner is a ring with no words, so it is found by its animation class.
const spinners = (root: ParentNode = document.body) =>
	root.querySelectorAll('[class*="animate-spin"]');

describe("loading indicators", () => {
	it("shows a spinner on Buy Now, and keeps its name, while the queue is joined", async () => {
		const request = deferred<ApiResult<JoinedView>>();
		const { client } = stubClient({
			join: vi.fn(() => request.promise),
		});
		await show(OPEN, stubApi(client));
		expect(spinners()).toHaveLength(0);
		await press("Buy Now");
		const buy = screen.getByRole("button", { name: "Buy Now" });
		expect(spinners(buy)).toHaveLength(1);
		expect(
			spinners(screen.getByRole("button", { name: "Check my status" })),
		).toHaveLength(0);
		expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
		expect(screen.getByRole("status").textContent).toContain(
			"Joining the queue",
		);
		await act(async () =>
			request.answer(
				new Ok({ userId: "ana", ticket: "t", state: "admitted" as const }),
			),
		);
		expect(spinners()).toHaveLength(0);
		expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("false");
	});

	it("keeps a spinner and says the page updates by itself while the shopper waits in the queue", async () => {
		const { client } = stubClient();
		await show(OPEN, stubApi(client));
		await buy();
		expect(
			spinners(screen.getByRole("button", { name: "Buy Now" })),
		).toHaveLength(1);
		expect(screen.getByRole("status").textContent).toContain("Your place: 2");
		expect(screen.getByRole("status").textContent).toContain(
			"updates by itself",
		);
	});

	it("shows a spinner on Check my status while it asks", async () => {
		const request = deferred<ApiResult<OutcomeView>>();
		const { client } = stubClient({
			outcome: vi.fn(() => request.promise),
		});
		await show(OPEN, stubApi(client));
		await press("Check my status");
		expect(
			spinners(screen.getByRole("button", { name: "Check my status" })),
		).toHaveLength(1);
		expect(
			spinners(screen.getByRole("button", { name: "Buy Now" })),
		).toHaveLength(0);
		await act(async () =>
			request.answer(new Ok({ userId: "ana", state: "none" as const })),
		);
		expect(spinners()).toHaveLength(0);
	});

	it("shows a spinner on Confirm purchase while the payment runs", async () => {
		const request = deferred<ApiResult<PurchaseView>>();
		const { client } = stubClient({
			join: vi.fn(
				async () =>
					new Ok({ userId: "ana", ticket: "t", state: "admitted" as const }),
			),
			confirm: vi.fn(() => request.promise),
		});
		await show(OPEN, stubApi(client));
		await buy();
		expect(spinners()).toHaveLength(0);
		await press("Confirm purchase");
		expect(
			spinners(screen.getByRole("button", { name: "Confirm purchase" })),
		).toHaveLength(1);
		expect(screen.getByRole("status").textContent).toContain("Paying");
		await act(async () =>
			request.answer(
				new Ok({
					userId: "ana",
					purchaseId: "p",
					reservationId: "r1",
					purchasedAt: "2026-06-01T12:00:00.000Z",
				}),
			),
		);
		expect(spinners()).toHaveLength(0);
	});
});

const field = (label: RegExp) => screen.getByLabelText(label);
const typeInto = (label: RegExp, value: string) =>
	fireEvent.change(field(label), { target: { value } });

describe("the account", () => {
	it("waits for the answer before it shows a form or the buttons", () => {
		const never = new Promise<ApiResult<Account>>(() => {});
		render(
			<SalePage
				load={OPEN}
				api={stubApi(stubClient().client, { me: () => never })}
			/>,
		);
		expect(screen.getByRole("status").textContent).toContain(
			"Checking your login",
		);
		expect(screen.queryByRole("button", { name: "Buy Now" })).toBeNull();
		expect(screen.queryByLabelText(/Username/)).toBeNull();
	});

	it("shows who is logged in, and the way out", async () => {
		await show(OPEN, stubApi(stubClient().client));
		expect(screen.getByText("Signed in as").textContent).toContain("ana");
		expect(screen.getByRole("button", { name: "Log out" })).toBeTruthy();
		expect(screen.queryByLabelText(/Username/)).toBeNull();
	});

	it("shows the form, and no buying buttons, to a visitor who is not logged in", async () => {
		const api = stubApi(stubClient().client, {
			me: async () => new Err(failure("not_authenticated")),
		});
		await show(OPEN, api);
		expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Buy Now" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
		// Not being logged in is the normal start, so nothing is flagged as an error.
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("logs in, then shows the buying buttons for the account", async () => {
		const login = vi.fn(async () => new Ok(ANA));
		const api = stubApi(stubClient().client, {
			me: async () => new Err(failure("not_authenticated")),
			login,
		});
		await show(OPEN, api);
		typeInto(/Username/, "  Ana ");
		typeInto(/Password/, "a long password");
		await press("Log in");
		expect(login).toHaveBeenCalledWith("ana", "a long password");
		expect(screen.getByRole("button", { name: "Buy Now" })).toBeTruthy();
		expect(screen.getByText("Signed in as").textContent).toContain("ana");
	});

	it("signs up with the form for a new shopper", async () => {
		const register = vi.fn(async () => new Ok(ANA));
		const api = stubApi(stubClient().client, {
			me: async () => new Err(failure("not_authenticated")),
			register,
		});
		await show(OPEN, api);
		await press("I am new");
		expect(screen.getByText("At least 8 characters.")).toBeTruthy();
		typeInto(/Username/, "ana");
		typeInto(/Password/, "a long password");
		await press("Sign up");
		expect(register).toHaveBeenCalledWith("ana", "a long password");
		expect(screen.getByRole("button", { name: "Buy Now" })).toBeTruthy();
	});

	it.each([
		["login", "invalid_credentials", "Wrong name or password."],
		["signup", "username_taken", "That name is taken. Choose another one."],
	] as const)(
		"tells in words when the %s is refused (%s)",
		async (mode, code, text) => {
			const refuse = vi.fn(async () => new Err(failure(code)));
			const api = stubApi(stubClient().client, {
				me: async () => new Err(failure("not_authenticated")),
				login: refuse,
				register: refuse,
			});
			await show(OPEN, api);
			if (mode === "signup") await press("I am new");
			typeInto(/Username/, "ana");
			typeInto(/Password/, "a long password");
			await press(mode === "login" ? "Log in" : "Sign up");
			expect(screen.getByRole("alert").textContent).toBe(text);
			// The shopper can try again.
			expect(
				(
					screen.getByRole("button", {
						name: mode === "login" ? "Log in" : "Sign up",
					}) as HTMLButtonElement
				).disabled,
			).toBe(false);
			expect(screen.queryByRole("button", { name: "Buy Now" })).toBeNull();
		},
	);

	it("refuses a bad name or a short password in words, without asking", async () => {
		const api = stubApi(stubClient().client, {
			me: async () => new Err(failure("not_authenticated")),
		});
		await show(OPEN, api);
		typeInto(/Username/, "no good");
		typeInto(/Password/, "a long password");
		await press("Log in");
		expect(screen.getByRole("alert").textContent).toContain("Use 1 to 64");
		typeInto(/Username/, "ana");
		await press("I am new");
		typeInto(/Password/, "short");
		await press("Sign up");
		expect(screen.getByRole("alert").textContent).toBe(
			"Use 8 to 128 characters for the password.",
		);
		expect(api.auth.login).not.toHaveBeenCalled();
		expect(api.auth.register).not.toHaveBeenCalled();
	});

	it("sends an old password to the server on login, which alone knows the rule it was made under", async () => {
		const login = vi.fn(async () => new Ok(ANA));
		const api = stubApi(stubClient().client, {
			me: async () => new Err(failure("not_authenticated")),
			login,
		});
		await show(OPEN, api);
		typeInto(/Username/, "ana");
		typeInto(/Password/, "short");
		await press("Log in");
		expect(login).toHaveBeenCalledWith("ana", "short");
	});

	it("does not send a login with no password", async () => {
		const api = stubApi(stubClient().client, {
			me: async () => new Err(failure("not_authenticated")),
		});
		await show(OPEN, api);
		typeInto(/Username/, "ana");
		await press("Log in");
		expect(api.auth.login).not.toHaveBeenCalled();
		expect(screen.getByRole("alert")).toBeTruthy();
	});

	it("clears the problem when the shopper switches between the two forms", async () => {
		const api = stubApi(stubClient().client, {
			me: async () => new Err(failure("not_authenticated")),
		});
		await show(OPEN, api);
		await press("Log in");
		expect(screen.getByRole("alert")).toBeTruthy();
		await press("I am new");
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("logs out, leaving the form", async () => {
		const api = stubApi(stubClient().client);
		await show(OPEN, api);
		await press("Log out");
		expect(api.auth.logout).toHaveBeenCalledOnce();
		expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Buy Now" })).toBeNull();
	});

	it("stops a shopper in the queue when they log out", async () => {
		const { client } = stubClient();
		const api = stubApi(client);
		await show(OPEN, api);
		await buy();
		expect(screen.getByRole("status").textContent).toContain("Your place: 2");
		await press("Log out");
		await press("Log in");
		expect(screen.queryByText(/Your place/)).toBeNull();
	});

	it("sends the shopper back to the form, and says why, when the login ended", async () => {
		const api = stubApi(stubClient().client);
		await show(OPEN, api);
		await act(async () => api.expire());
		expect(
			screen.getByText("Your login has ended. Please log in again."),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Buy Now" })).toBeNull();
	});

	it('ignores the answer to "who am I" when the page is gone', async () => {
		const answer = deferred<ApiResult<Account>>();
		const api = stubApi(stubClient().client, { me: () => answer.promise });
		const { unmount } = render(<SalePage load={OPEN} api={api} />);
		unmount();
		await act(async () => answer.answer(new Ok(ANA)));
		expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
	});
});
