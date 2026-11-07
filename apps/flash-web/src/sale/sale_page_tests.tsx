import { Err, Ok } from "@flash/typekit";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
		watchPlace: (_id, _user, _ticket, onPlace) => {
			push = onPlace;
			return () => {};
		},
		...overrides,
	};
	return { client, push: (place: Place) => push(place) };
}

async function press(name: string): Promise<void> {
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name }));
	});
}

async function buyAs(name: string): Promise<void> {
	fireEvent.change(screen.getByLabelText(/Your name/), {
		target: { value: name },
	});
	await press("Buy Now");
}

describe("SalePage", () => {
	it("tells a waiting shopper when the place is lost", async () => {
		const { client, push } = stubClient();
		render(<SalePage load={{ state: "ok", sale: SALE }} client={client} />);
		await buyAs("ana");
		expect(screen.getByRole("status").textContent).toContain("Your place: 2");
		await act(async () => push({ state: "absent" }));
		expect(screen.getByRole("status").textContent).toContain(
			"Your place was lost",
		);
	});

	it("moves a waiting shopper on when the place changes and then admits them", async () => {
		const { client, push } = stubClient();
		render(<SalePage load={{ state: "ok", sale: SALE }} client={client} />);
		await buyAs("ana");
		await act(async () => push({ state: "waiting", place: 1 }));
		expect(screen.getByRole("status").textContent).toContain("Your place: 1");
		await act(async () => push({ state: "admitted" }));
		expect(client.reserve).toHaveBeenCalledWith(SALE.id, "ana", "t");
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
		render(<SalePage load={{ state: "ok", sale: SALE }} client={client} />);
		await buyAs("ana");
		await press("Confirm purchase");
		expect(screen.getByRole("status").textContent).toContain(
			"Your hold has ended",
		);
	});

	it("shows the reason when the check is refused", async () => {
		const { client } = stubClient({
			outcome: vi.fn(async () => new Err(failure("network"))),
		});
		render(<SalePage load={{ state: "ok", sale: SALE }} client={client} />);
		fireEvent.change(screen.getByLabelText(/Your name/), {
			target: { value: "ana" },
		});
		await press("Check my status");
		expect(screen.getByRole("status").textContent).toContain(
			"could not be reached",
		);
	});

	it("refuses a bad name when checking, without asking", async () => {
		const { client } = stubClient();
		render(<SalePage load={{ state: "ok", sale: SALE }} client={client} />);
		fireEvent.change(screen.getByLabelText(/Your name/), {
			target: { value: "no good" },
		});
		await press("Check my status");
		expect(client.outcome).not.toHaveBeenCalled();
		expect(screen.getByRole("status").textContent).toContain("Use 1 to 64");
	});

	it("does not send a form that cannot be bought from", async () => {
		const { client } = stubClient();
		render(
			<SalePage
				load={{ state: "ok", sale: { ...SALE, status: "sold_out" } }}
				client={client}
			/>,
		);
		fireEvent.change(screen.getByLabelText(/Your name/), {
			target: { value: "ana" },
		});
		await act(async () => {
			fireEvent.submit(screen.getByRole("button", { name: "Buy Now" }));
		});
		expect(client.join).not.toHaveBeenCalled();
	});

	it("builds its own client when none is given", () => {
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

	it("shows the window of the sale and a plain line for its status", () => {
		const { container } = render(
			<SalePage
				load={{ state: "ok", sale: { ...SALE, status: "upcoming" } }}
				client={stubClient().client}
			/>,
		);
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
		render(<SalePage load={{ state: "ok", sale: SALE }} client={client} />);
		expect(spinners()).toHaveLength(0);
		fireEvent.change(screen.getByLabelText(/Your name/), {
			target: { value: "ana" },
		});
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
		render(<SalePage load={{ state: "ok", sale: SALE }} client={client} />);
		await buyAs("ana");
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
		render(<SalePage load={{ state: "ok", sale: SALE }} client={client} />);
		fireEvent.change(screen.getByLabelText(/Your name/), {
			target: { value: "ana" },
		});
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
		render(<SalePage load={{ state: "ok", sale: SALE }} client={client} />);
		await buyAs("ana");
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
