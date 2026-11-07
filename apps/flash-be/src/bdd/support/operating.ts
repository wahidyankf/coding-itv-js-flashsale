// The operator's steps for the scenarios: the requests an operator sends (create, change, move, remove, list) and the
// logins they send them with. The unit and the integration layer each supply an OperatingLayer, so the same steps
// run in both.
import { MS_PER_MINUTE } from "@flash/flash-commons";
import type { FastifyInstance } from "fastify";
import type { Role } from "../../domain/auth.js";
import type { Response } from "./response.js";

export type { Response };

// Who sends a request: the operator who is logged in, a shopper who is logged in, or someone who is not.
export type Sender = "operator" | "shopper" | "nobody";

type Method = "GET" | "POST" | "PATCH" | "DELETE";

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

// What one scenario remembers between steps: each sender's cookie, and the sale and product made last.
type Memory = {
	cookies: Partial<Record<Sender, string>>;
	lastSaleId: string;
	lastProductId: string | undefined;
};

// The layer and the memory of one scenario, passed to the steps below as one value.
type Scene = { layer: OperatingLayer; memory: Memory };

// The body of a sale the operator creates: when it starts and ends (in minutes from now), its stock and product.
type SaleInput = {
	stock: number;
	startsInMinutes: number;
	minutes: number;
	productId?: string | undefined;
};

const OPERATOR_NAME = "operator-ana";

// The phrases the scenarios use to change a sale. A change names the stock and may name the hold time.
const CHANGE_PHRASE =
	/^changes that sale to stock (\d+)(?: and a hold time of (\d+) seconds)?$/;
const MOVE_PHRASE =
	/^moves that sale to open in (\d+) minutes for (\d+) minutes$/;

// Sends one request to the app, as `sender`. A payload goes as JSON.
function send(
	scene: Scene,
	method: Method,
	url: string,
	sender: Sender | undefined,
	payload?: unknown,
): Promise<Response> {
	const cookie =
		sender === undefined ? undefined : scene.memory.cookies[sender];
	return scene.layer.app().inject({
		method,
		url,
		headers: {
			...(cookie === undefined ? {} : { cookie }),
			...(payload === undefined ? {} : { "content-type": "application/json" }),
		},
		...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
	});
}

// When a sale starts and ends, counted in minutes from `now`, as the API reads the times.
function windowAt(now: Date, startsInMinutes: number, minutes: number) {
	const startsAt = new Date(now.getTime() + startsInMinutes * MS_PER_MINUTE);
	return {
		startsAt: startsAt.toISOString(),
		endsAt: new Date(
			startsAt.getTime() + minutes * MS_PER_MINUTE,
		).toISOString(),
	};
}

// The operator creates a sale, and the scene remembers its id when the API made it.
async function create(scene: Scene, sale: SaleInput, sender: Sender) {
	const reply = await send(scene, "POST", "/admin/sales", sender, {
		stock: sale.stock,
		...windowAt(scene.layer.now(), sale.startsInMinutes, sale.minutes),
		...(sale.productId === undefined ? {} : { productId: sale.productId }),
	});
	if (reply.statusCode === 201) scene.memory.lastSaleId = reply.json().id;
	return reply;
}

// The body of a change: the new stock, and the hold time when the phrase names one.
function changeBody(change: RegExpExecArray) {
	return {
		stock: Number(change[1]),
		...(change[2] === undefined ? {} : { holdSeconds: Number(change[2]) }),
	};
}

// One request, written the way the scenarios say it, against the sale made last.
function operate(
	scene: Scene,
	phrase: string,
	sender: Sender,
): Promise<Response> {
	const url = `/admin/sales/${scene.memory.lastSaleId}`;
	const change = CHANGE_PHRASE.exec(phrase);
	if (change) return send(scene, "PATCH", url, sender, changeBody(change));
	const move = MOVE_PHRASE.exec(phrase);
	if (move) {
		const now = scene.layer.now();
		return send(
			scene,
			"PATCH",
			url,
			sender,
			windowAt(now, Number(move[1]), Number(move[2])),
		);
	}
	if (phrase === "removes that sale") return send(scene, "DELETE", url, sender);
	if (phrase === "lists the sales") {
		return send(scene, "GET", "/admin/sales", sender);
	}
	throw new Error(`the operator cannot ${phrase}`);
}

// One scenario of an operator: the logins, the sales created so far, and the last reply. "That sale" is the one created
// last. The same code serves the unit and the integration layer.
export function operatorWorld(layer: OperatingLayer) {
	const scene: Scene = {
		layer,
		memory: { cookies: {}, lastSaleId: "", lastProductId: undefined },
	};
	return {
		// The operator is logged in. A shopper may be too; each keeps their own cookie.
		async loginOperator() {
			scene.memory.cookies.operator = await layer.login(
				OPERATOR_NAME,
				"operator",
			);
		},
		async loginShopper(name: string) {
			scene.memory.cookies.shopper = await layer.login(name, "shopper");
		},
		createSale: (
			stock: number,
			startsInMinutes: number,
			minutes: number,
			sender: Sender = "operator",
		) =>
			create(
				scene,
				{
					stock,
					startsInMinutes,
					minutes,
					productId: scene.memory.lastProductId,
				},
				sender,
			),
		createSaleFor: (
			stock: number,
			startsInMinutes: number,
			minutes: number,
			productId: string,
		) =>
			create(scene, { stock, startsInMinutes, minutes, productId }, "operator"),
		async makeProduct(name: string) {
			scene.memory.lastProductId = await layer.makeProduct(name);
			return scene.memory.lastProductId;
		},
		get lastProductId() {
			return scene.memory.lastProductId;
		},
		buyItem: () => layer.buyItem(scene.memory.lastSaleId),
		salesCount: layer.salesCount,
		productsOfSales: layer.productsOfSales,
		deletedBy: (saleId: string) => layer.deletedBy(saleId),
		operatorId: () => layer.idOf(OPERATOR_NAME),
		// One request, written the way the scenarios say it. `sender` is who sends it.
		operate: (phrase: string, sender: Sender) => operate(scene, phrase, sender),
		// The public read of that sale, as a shopper sees it.
		readSale: () =>
			send(scene, "GET", `/sales/${scene.memory.lastSaleId}`, undefined),
		readCurrentSale: () => send(scene, "GET", "/sales/current", undefined),
		// The operator's list.
		listSales: () => send(scene, "GET", "/admin/sales", "operator"),
		get saleId() {
			return scene.memory.lastSaleId;
		},
	};
}
