import type { FastifyInstance } from "fastify";

export type Response = Awaited<ReturnType<FastifyInstance["inject"]>>;

const MINUTE_MS = 60_000;
const bearer = (token: string) => `Bearer ${token}`;

// What differs between layers: the app over the layer's store, the clock, and two things only the store can do.
export type OperatingLayer = {
	app: () => FastifyInstance;
	now: () => Date;
	// A shopper bought one item of the sale, behind the API (the layer has no shopper to do it).
	buyItem: (saleId: string) => Promise<void>;
	salesCount: () => Promise<number>;
};

// One scenario of an operator: the token, the sales created so far, and the last reply. "That sale" is the one
// created last. The same code serves the unit and the integration layer.
export function operatorWorld(layer: OperatingLayer) {
	let token: string | undefined;
	let lastSaleId = "";
	const call = (
		method: "GET" | "POST" | "PATCH" | "DELETE",
		url: string,
		authorization: string | undefined,
		payload?: unknown,
	): Promise<Response> =>
		layer.app().inject({
			method,
			url,
			headers: {
				...(authorization === undefined ? {} : { authorization }),
				...(payload === undefined
					? {}
					: { "content-type": "application/json" }),
			},
			...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
		});
	const window = (startsInMinutes: number, minutes: number) => {
		const startsAt = new Date(
			layer.now().getTime() + startsInMinutes * MINUTE_MS,
		);
		return {
			startsAt: startsAt.toISOString(),
			endsAt: new Date(startsAt.getTime() + minutes * MINUTE_MS).toISOString(),
		};
	};

	return {
		useToken(value: string) {
			token = value;
		},
		// A sale made with the scenario's own token. A negative start means it opened that long ago.
		async createSale(stock: number, startsInMinutes: number, minutes: number) {
			const reply = await call("POST", "/admin/sales", bearer(token ?? ""), {
				stock,
				...window(startsInMinutes, minutes),
			});
			lastSaleId = reply.json().id;
			return reply;
		},
		buyItem: () => layer.buyItem(lastSaleId),
		salesCount: layer.salesCount,
		// One request of the operator, written the way the scenarios say it. `authorization` is undefined for no token.
		operate(phrase: string, authorization: string | undefined) {
			const id = lastSaleId;
			const change =
				/^changes that sale to stock (\d+)(?: and a hold time of (\d+) seconds)?$/.exec(
					phrase,
				);
			if (change) {
				return call("PATCH", `/admin/sales/${id}`, authorization, {
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
					authorization,
					window(Number(move[1]), Number(move[2])),
				);
			}
			if (phrase === "removes that sale") {
				return call("DELETE", `/admin/sales/${id}`, authorization);
			}
			if (phrase === "lists the sales") {
				return call("GET", "/admin/sales", authorization);
			}
			throw new Error(`the operator cannot ${phrase}`);
		},
		bearer,
		// The public read of that sale, as a shopper sees it.
		readSale: () => call("GET", `/sales/${lastSaleId}`, undefined),
		// The operator's list, with the scenario's token.
		listSales: () => call("GET", "/admin/sales", bearer(token ?? "")),
		get saleId() {
			return lastSaleId;
		},
	};
}
