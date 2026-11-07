import type { FastifyInstance } from "fastify";
import type { Role } from "../../domain/auth.js";

export type Response = Awaited<ReturnType<FastifyInstance["inject"]>>;

const MINUTE_MS = 60_000;

// Who sends a request: the operator who is logged in, a shopper who is logged in, or someone who is not.
export type Sender = "operator" | "shopper" | "nobody";

// What differs between layers: the app over the layer's store, the clock, the logins, and what only the store can do.
export type OperatingLayer = {
	app: () => FastifyInstance;
	now: () => Date;
	// A cookie header for a user who is logged in. The account is made the first time.
	login: (username: string, role: Role) => Promise<string>;
	// A shopper bought one item of the sale, behind the API (the layer has no shopper to do it).
	buyItem: (saleId: string) => Promise<void>;
	// The sales that were not deleted.
	salesCount: () => Promise<number>;
	// A product that exists, made behind the API (there is no route for it), and the products the live sales sell.
	makeProduct: (name: string) => Promise<string>;
	productsOfSales: () => Promise<string[]>;
	// The id of whoever deleted the sale, when its row is kept and marked deleted. Nothing when the row is not marked.
	deletedBy: (saleId: string) => Promise<string | undefined>;
	// The id of the user with this name.
	idOf: (username: string) => Promise<string | undefined>;
};

const OPERATOR_NAME = "operator-ana";

// One scenario of an operator: the logins, the sales created so far, and the last reply. "That sale" is the one created
// last. The same code serves the unit and the integration layer.
export function operatorWorld(layer: OperatingLayer) {
	const cookies: Partial<Record<Sender, string>> = {};
	let lastSaleId = "";
	let lastProductId: string | undefined;
	const call = (
		method: "GET" | "POST" | "PATCH" | "DELETE",
		url: string,
		sender: Sender | undefined,
		payload?: unknown,
	): Promise<Response> => {
		const cookie = sender === undefined ? undefined : cookies[sender];
		return layer.app().inject({
			method,
			url,
			headers: {
				...(cookie === undefined ? {} : { cookie }),
				...(payload === undefined
					? {}
					: { "content-type": "application/json" }),
			},
			...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
		});
	};
	const window = (startsInMinutes: number, minutes: number) => {
		const startsAt = new Date(
			layer.now().getTime() + startsInMinutes * MINUTE_MS,
		);
		return {
			startsAt: startsAt.toISOString(),
			endsAt: new Date(startsAt.getTime() + minutes * MINUTE_MS).toISOString(),
		};
	};
	const create = async (
		stock: number,
		startsInMinutes: number,
		minutes: number,
		sender: Sender,
		productId?: string,
	) => {
		const reply = await call("POST", "/admin/sales", sender, {
			stock,
			...window(startsInMinutes, minutes),
			...(productId === undefined ? {} : { productId }),
		});
		if (reply.statusCode === 201) lastSaleId = reply.json().id;
		return reply;
	};

	return {
		// The operator is logged in. A shopper may be too; each keeps their own cookie.
		async loginOperator() {
			cookies.operator = await layer.login(OPERATOR_NAME, "operator");
		},
		async loginShopper(name: string) {
			cookies.shopper = await layer.login(name, "shopper");
		},
		createSale: (
			stock: number,
			startsInMinutes: number,
			minutes: number,
			sender: Sender = "operator",
		) => create(stock, startsInMinutes, minutes, sender, lastProductId),
		createSaleFor: (
			stock: number,
			startsInMinutes: number,
			minutes: number,
			productId: string,
		) => create(stock, startsInMinutes, minutes, "operator", productId),
		async makeProduct(name: string) {
			lastProductId = await layer.makeProduct(name);
			return lastProductId;
		},
		get lastProductId() {
			return lastProductId;
		},
		buyItem: () => layer.buyItem(lastSaleId),
		salesCount: layer.salesCount,
		productsOfSales: layer.productsOfSales,
		deletedBy: (saleId: string) => layer.deletedBy(saleId),
		operatorId: () => layer.idOf(OPERATOR_NAME),
		// One request, written the way the scenarios say it. `sender` is who sends it.
		operate(phrase: string, sender: Sender) {
			const id = lastSaleId;
			const change =
				/^changes that sale to stock (\d+)(?: and a hold time of (\d+) seconds)?$/.exec(
					phrase,
				);
			if (change) {
				return call("PATCH", `/admin/sales/${id}`, sender, {
					stock: Number(change[1]),
					...(change[2] === undefined
						? {}
						: { holdSeconds: Number(change[2]) }),
				});
			}
			const move =
				/^moves that sale to open in (\d+) minutes for (\d+) minutes$/.exec(
					phrase,
				);
			if (move) {
				return call(
					"PATCH",
					`/admin/sales/${id}`,
					sender,
					window(Number(move[1]), Number(move[2])),
				);
			}
			if (phrase === "removes that sale") {
				return call("DELETE", `/admin/sales/${id}`, sender);
			}
			if (phrase === "lists the sales") {
				return call("GET", "/admin/sales", sender);
			}
			throw new Error(`the operator cannot ${phrase}`);
		},
		// The public read of that sale, as a shopper sees it.
		readSale: () => call("GET", `/sales/${lastSaleId}`, undefined),
		readCurrentSale: () => call("GET", "/sales/current", undefined),
		// The operator's list.
		listSales: () => call("GET", "/admin/sales", "operator"),
		get saleId() {
			return lastSaleId;
		},
	};
}
