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
import type { Place, SaleView } from "./types";

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
			confirm: vi.fn(async () => new Err({ error: "hold_expired" as const })),
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
			outcome: vi.fn(async () => new Err({ error: "network" as const })),
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
});
