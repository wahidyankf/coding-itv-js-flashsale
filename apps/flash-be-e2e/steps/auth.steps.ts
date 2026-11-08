// Steps for accounts and sessions: signing up and logging in, the two cookies a login sets (their names, HttpOnly, and their
// paths), the stored tokens (only hashes), who the users row says changed it last, logging out, refreshing, and the copy
// of a cookie that must stop working, and one login served by two instances of the API. The shopper's cookie jar is kept
// here, as a browser would keep it. Binds auth/accounts.feature and auth/sessions.feature.

import { createHash } from "node:crypto";
import { applySetCookies, cookieHeader } from "@flash/flash-commons";
import type { APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { routes, send } from "./support/api.js";
import { ensureDatabase, query } from "./support/database.js";
import {
	E2E_REDIS_URL,
	startSecondApi,
	withRedis,
} from "./support/processes.js";
import {
	currentResponse,
	setCookiesOf,
	setResponse,
} from "./support/response.js";
import { currentSaleId, world } from "./support/world.js";

const { Given, When, Then } = createBdd();

type Jar = NonNullable<typeof world.jar>;

// The shopper's cookie jar, made on first use.
function jar(): Jar {
	world.jar ??= new Map();
	return world.jar;
}

// Keeps what the last reply set, as a browser does: a cookie with a value is stored, a cookie cleared is forgotten. The
// rules are the shared cookie jar's, so the e2e jar and the API's scenarios read a reply the same way.
function remember() {
	world.jar = applySetCookies(jar(), setCookiesOf(currentResponse()));
}

// One request with a jar. A reply is kept in the jar unless the request came from a copy of it. The cookies sent are the
// ones a browser would send to this path, from the jar it holds.
async function go(
	request: APIRequestContext,
	route: Parameters<typeof send>[1],
	options: {
		body?: unknown;
		from?: Jar;
		record?: boolean;
		on?: "first" | "second";
		params?: Record<string, string>;
	} = {},
) {
	await ensureDatabase();
	const path = route.path;
	const base = options.on === "second" ? await startSecondApi() : undefined;
	setResponse(
		await send(request, route, {
			headers: { cookie: cookieHeader(options.from ?? jar(), path) ?? "" },
			body: options.body,
			...(base === undefined ? {} : { base }),
			...(options.params === undefined ? {} : { params: options.params }),
		}),
	);
	if (options.record !== false) remember();
}

const hash = (token: string) =>
	createHash("sha256").update(token).digest("hex");

When(
	/^"([^"]*)" signs up with the password "([^"]*)"$/,
	async ({ request }, name: string, password: string) => {
		await go(request, routes.register, { body: { username: name, password } });
	},
);

Given(
	/^"([^"]*)" has signed up with the password "([^"]*)"$/,
	async ({ request }, name: string, password: string) => {
		await go(request, routes.register, { body: { username: name, password } });
		expect(currentResponse().status()).toBe(201);
	},
);

When(
	/^"([^"]*)" logs in with the password "([^"]*)"$/,
	async ({ request }, name: string, password: string) => {
		await go(request, routes.login, { body: { username: name, password } });
	},
);

Then(
	/^the account is "([^"]+)", a "([^"]+)"$/,
	async ({ request: _request }, name: string, role: string) => {
		expect(await currentResponse().json()).toEqual({ username: name, role });
	},
);

Then(
	/^the reply sets an "([^"]+)" cookie and a "([^"]+)" cookie, both HttpOnly$/,
	async ({ request: _request }, access: string, refresh: string) => {
		for (const name of [access, refresh]) {
			const cookie = setCookiesOf(currentResponse()).find((c) =>
				c.startsWith(`${name}=`),
			);
			expect(cookie, name).toBeDefined();
			expect(cookie).toContain("HttpOnly");
		}
	},
);

Then("the reply sets no cookie", async ({ request: _request }) => {
	expect(setCookiesOf(currentResponse())).toEqual([]);
});

Then(
	/^the shopper is logged in as "([^"]+)"$/,
	async ({ request }, name: string) => {
		await go(request, routes.me);
		expect(currentResponse().status()).toBe(200);
		expect((await currentResponse().json()).username).toBe(name);
	},
);

Then(
	/^the stored passwords do not contain "([^"]+)"$/,
	async ({ request: _request }, password: string) => {
		const rows = await query<{ password_hash: string }>(
			"select password_hash from users where password_hash is not null",
		);
		expect(rows.length).toBeGreaterThan(0);
		for (const row of rows) expect(row.password_hash).not.toContain(password);
	},
);

Then(
	"the stored logins hold hashes of the tokens, not the tokens",
	async ({ request: _request }) => {
		const rows = await query<{ access_hash: string; refresh_hash: string }>(
			"select access_hash, refresh_hash from sessions",
		);
		expect(rows.length).toBeGreaterThan(0);
		const stored = rows.flatMap((row) => [row.access_hash, row.refresh_hash]);
		for (const { value } of jar().values()) {
			expect(stored).not.toContain(value);
			expect(stored).toContain(hash(value));
		}
	},
);

Then(
	/^the stored row of "([^"]+)" was last changed by "([^"]+)", at the time of the login$/,
	async ({ request: _request }, name: string, by: string) => {
		const rows = await query<{ byAuthor: boolean; atLogin: boolean }>(
			`select row.updated_by = author.id as "byAuthor",
			        row.updated_at is not null and row.updated_at = row.last_login_at as "atLogin"
			   from users row, users author
			  where row.username = $1 and row.deleted_at is null
			    and author.username = $2 and author.deleted_at is null`,
			[name, by],
		);
		expect(rows).toEqual([{ byAuthor: true, atLogin: true }]);
	},
);

When("the shopper asks who is logged in", async ({ request }) => {
	await go(request, routes.me);
});

When("the shopper logs out", async ({ request }) => {
	await go(request, routes.logout);
});

Then("the reply clears both cookies", async ({ request: _request }) => {
	const cookies = setCookiesOf(currentResponse());
	expect(cookies).toHaveLength(2);
	for (const cookie of cookies) expect(cookie).toContain("Max-Age=0");
});

Given(
	"the shopper keeps a copy of the tokens",
	async ({ request: _request }) => {
		world.jarCopy = new Map(jar());
	},
);

Then("the copy of the access token is refused", async ({ request }) => {
	await go(request, routes.me, {
		from: world.jarCopy ?? new Map(),
		record: false,
	});
	expect(currentResponse().status()).toBe(401);
	expect((await currentResponse().json()).errorCode).toBe("not_authenticated");
});

// The access token runs out: its row's expiry is set in the past, and the cached session is dropped, so the API cannot answer from its cache.
When("the access token expires", async ({ request: _request }) => {
	const token = jar().get("access_token")?.value ?? "";
	await query(
		"update sessions set access_expires_at = now() - interval '1 minute' where access_hash = $1",
		[hash(token)],
	);
	await withRedis(E2E_REDIS_URL, (redis) =>
		redis.del(`session:${hash(token)}`),
	);
});

When("the shopper refreshes the login", async ({ request }) => {
	await go(request, routes.refresh);
});

When("the copy of the refresh token is used", async ({ request }) => {
	await go(request, routes.refresh, {
		from: world.jarCopy ?? new Map(),
		record: false,
	});
});

Then("the shopper is no longer logged in", async ({ request }) => {
	await go(request, routes.me);
	expect(currentResponse().status()).toBe(401);
});

When(
	"someone who is not logged in refreshes the login",
	async ({ request }) => {
		await go(request, routes.refresh, { from: new Map(), record: false });
	},
);

Then(
	/^the "([^"]+)" cookie is limited to the path "([^"]+)"$/,
	async ({ request: _request }, name: string, path: string) => {
		expect(jar().get(name)?.path).toBe(path);
	},
);

When(
	/^someone who is not logged in sends (GET|POST) (\/\S+)$/,
	async ({ request }, method: string, path: string) => {
		await ensureDatabase();
		setResponse(
			await send(
				request,
				{ method: method === "POST" ? "POST" : "GET", path },
				{ headers: { cookie: "" } },
			),
		);
	},
);

// Two flash-be processes over the scenario's database and Redis, as two servers behind a load balancer. The shopper's
// browser and its cookies stay the same; each step names the instance it reaches.
Given(
	"two instances of the API share one database and one Redis",
	async ({ request: _request }) => {
		await ensureDatabase();
		await startSecondApi();
	},
);

Given(
	/^"([^"]*)" has signed up with the password "([^"]*)" on the first instance$/,
	async ({ request }, name: string, password: string) => {
		await go(request, routes.register, { body: { username: name, password } });
		expect(currentResponse().status()).toBe(201);
	},
);

When(
	"the shopper asks who is logged in on the second instance",
	async ({ request }) => {
		await go(request, routes.me, { on: "second" });
	},
);

Given(
	"the shopper has asked who is logged in on the second instance",
	async ({ request }) => {
		await go(request, routes.me, { on: "second" });
		expect(currentResponse().status()).toBe(200);
	},
);

When(
	"the shopper joins the queue on the second instance",
	async ({ request }) => {
		await go(request, routes.joinQueue, {
			on: "second",
			params: { saleId: currentSaleId() },
		});
	},
);

When("the shopper logs out on the first instance", async ({ request }) => {
	await go(request, routes.logout, { on: "first" });
});

When(
	"the copy of the access token is sent to the second instance",
	async ({ request }) => {
		await go(request, routes.me, {
			from: world.jarCopy ?? new Map(),
			record: false,
			on: "second",
		});
	},
);

When(
	"the shopper refreshes the login on the first instance",
	async ({ request }) => {
		await go(request, routes.refresh, { on: "first" });
		expect(currentResponse().status()).toBe(200);
	},
);

When(
	"the copy of the refresh token is used on the second instance",
	async ({ request }) => {
		await go(request, routes.refresh, {
			from: world.jarCopy ?? new Map(),
			record: false,
			on: "second",
		});
	},
);

Then(
	"the shopper is no longer logged in on the second instance",
	async ({ request }) => {
		await go(request, routes.me, { on: "second" });
		expect(currentResponse().status()).toBe(401);
	},
);
