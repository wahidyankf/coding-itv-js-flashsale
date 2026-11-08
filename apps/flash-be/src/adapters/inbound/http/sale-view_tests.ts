// The sale as the HTTP API sends it. The exact text is pinned, because the shoppers' pages and the event stream read these
// names and this order; a change to the view must show here first.
import { Ok } from "@flash/typekit";
import { afterEach, describe, expect, it } from "vitest";
import { createSaleAdminService } from "../../../application/sale-admin-service.js";
import { createSaleService } from "../../../application/sale-service.js";
import { healthyDeps } from "../../../bdd/support/deps.js";
import {
	appWithSales,
	fakeRepository,
	fakeSale,
} from "../../../bdd/support/fake-sales.js";
import { memorySaleAdmin } from "../../../bdd/support/memory-sale-admin.js";
import { usernameOf } from "../../../bdd/support/users.js";
import { userIdOf } from "../../../domain/user.js";
import { buildApp } from "./app.js";

const apps: Array<ReturnType<typeof buildApp>> = [];
afterEach(async () => {
	await Promise.all(apps.splice(0).map((app) => app.close()));
});

const NOW = new Date("2026-06-01T12:00:00.000Z");
const SALE_ID = "00000000-0000-4000-8000-0000000000a1";
const PRODUCT_ID = "00000000-0000-4000-8000-0000000000b1";

describe("the sale as the API sends it", () => {
	it("sends the public view with its names, its status now and the remaining items, in this order", async () => {
		const sale = fakeSale({
			id: SALE_ID,
			productId: PRODUCT_ID,
			name: "Mug drop",
			startsAt: new Date("2026-06-01T11:00:00.000Z"),
			endsAt: new Date("2026-06-01T13:00:00.000Z"),
			stock: 10,
			sold: 3,
		});
		const app = appWithSales([sale], () => NOW);
		apps.push(app);
		const reply = await app.inject({
			method: "GET",
			url: "/api/v1/sales/current",
		});
		expect(reply.statusCode).toBe(200);
		expect(reply.body).toBe(
			`{"id":"${SALE_ID}","productId":"${PRODUCT_ID}","name":"Mug drop","status":"active","startsAt":"2026-06-01T11:00:00.000Z","endsAt":"2026-06-01T13:00:00.000Z","stock":10,"remaining":7}`,
		);
	});

	it("sends the sale cache time as max-age, rounded up to whole seconds", async () => {
		const cache = { ttlMs: 2500 };
		const sale = fakeSale({ id: SALE_ID, productId: PRODUCT_ID });
		const app = buildApp(
			{
				...healthyDeps,
				sales: createSaleService(fakeRepository([sale]), () => NOW, cache),
				saleCache: cache,
			},
			{ cookieSecure: false },
		);
		apps.push(app);
		const reply = await app.inject({
			method: "GET",
			url: "/api/v1/sales/current",
		});
		expect(reply.headers["cache-control"]).toBe("public, max-age=3");
	});

	it("sends the operator's list with the numbers only an operator needs, in this order", async () => {
		const sale = fakeSale({
			id: SALE_ID,
			productId: PRODUCT_ID,
			name: "Mug drop",
			startsAt: new Date("2026-06-01T11:00:00.000Z"),
			endsAt: new Date("2026-06-01T13:00:00.000Z"),
			stock: 10,
			sold: 3,
			holdSeconds: 90,
			admitPerSecond: 20,
		});
		const operator = {
			userId: userIdOf("user-2"),
			username: usernameOf("boss"),
			role: "operator" as const,
		};
		const app = buildApp(
			{
				...healthyDeps,
				auth: {
					...healthyDeps.auth,
					authorizeOperator: async () => new Ok(operator),
				},
				admin: createSaleAdminService(memorySaleAdmin([sale]), () => NOW),
			},
			{ cookieSecure: false },
		);
		apps.push(app);
		const reply = await app.inject({
			method: "GET",
			url: "/api/v1/admin/sales",
			headers: { cookie: "access_token=operator-token" },
		});
		expect(reply.statusCode).toBe(200);
		expect(reply.body).toBe(
			`{"sales":[{"id":"${SALE_ID}","productId":"${PRODUCT_ID}","name":"Mug drop","status":"active","startsAt":"2026-06-01T11:00:00.000Z","endsAt":"2026-06-01T13:00:00.000Z","stock":10,"remaining":7,"sold":3,"holdSeconds":90,"admitPerSecond":20}]}`,
		);
	});

	it("sends no cache header when the sale cache is off", async () => {
		const sale = fakeSale({ id: SALE_ID, productId: PRODUCT_ID });
		const app = buildApp(
			{
				...healthyDeps,
				sales: createSaleService(fakeRepository([sale]), () => NOW, {
					ttlMs: 0,
				}),
				saleCache: { ttlMs: 0 },
			},
			{ cookieSecure: false },
		);
		apps.push(app);
		const reply = await app.inject({
			method: "GET",
			url: "/api/v1/sales/current",
		});
		expect(reply.headers["cache-control"]).toBeUndefined();
	});
});
