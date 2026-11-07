import { createHash } from "node:crypto";
import { type APIRequestContext, expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { createClient } from "redis";
import { routes, send } from "./support/api.js";
import { currentResponse, setResponse } from "./support/response.js";
import {
	E2E_REDIS_URL,
	migratedDatabase,
	query,
	world,
} from "./support/world.js";

const { Given, When, Then } = createBdd();

type Jar = NonNullable<typeof world.jar>;

async function ensureDatabase(): Promise<void> {
	if (!world.databaseUrl) await migratedDatabase();
}

function jar(): Jar {
	world.jar ??= new Map();
	return world.jar;
}

const setCookies = () =>
	currentResponse()
		.headersArray()
		.filter((header) => header.name.toLowerCase() === "set-cookie")
		.map((header) => header.value);

// Keeps what a reply set, as a browser does.
function remember(into: Jar) {
	for (const cookie of setCookies()) {
		const [pair = "", ...attributes] = cookie.split(";").map((p) => p.trim());
		const at = pair.indexOf("=");
		const name = pair.slice(0, at);
		const path =
			attributes.find((a) => a.startsWith("Path="))?.slice("Path=".length) ??
			"/";
		if (attributes.includes("Max-Age=0")) into.delete(name);
		else into.set(name, { value: pair.slice(at + 1), path });
	}
}

// The cookies a browser would send to this path.
function cookieFor(from: Jar, path: string): string {
	return [...from]
		.filter(([, cookie]) => path.startsWith(cookie.path))
		.map(([name, cookie]) => `${name}=${cookie.value}`)
		.join("; ");
}

// One request with a jar. A reply is kept in the jar unless the request came from a copy of it.
async function go(
	request: APIRequestContext,
	route: Parameters<typeof send>[1],
	options: { body?: unknown; from?: Jar; record?: boolean } = {},
) {
	await ensureDatabase();
	const path = route.path;
	setResponse(
		await send(request, route, {
			headers: { cookie: cookieFor(options.from ?? jar(), path) },
			body: options.body,
		}),
	);
	if (options.record !== false) remember(jar());
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
			const cookie = setCookies().find((c) => c.startsWith(`${name}=`));
			expect(cookie, name).toBeDefined();
			expect(cookie).toContain("HttpOnly");
		}
	},
);

Then("the reply sets no cookie", async ({ request: _request }) => {
	expect(setCookies()).toEqual([]);
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

When("the shopper asks who is logged in", async ({ request }) => {
	await go(request, routes.me);
});

When("the shopper logs out", async ({ request }) => {
	await go(request, routes.logout);
});

Then("the reply clears both cookies", async ({ request: _request }) => {
	expect(setCookies()).toHaveLength(2);
	for (const cookie of setCookies()) expect(cookie).toContain("Max-Age=0");
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

// The 15 minutes pass: the row says so, and so does the cache of the API, which would otherwise answer for a minute.
When("the access token expires", async ({ request: _request }) => {
	const token = jar().get("access_token")?.value ?? "";
	await query(
		"update sessions set access_expires_at = now() - interval '1 minute' where access_hash = $1",
		[hash(token)],
	);
	const redis = createClient({ url: E2E_REDIS_URL });
	await redis.connect();
	try {
		await redis.del(`session:${hash(token)}`);
	} finally {
		await redis.quit();
	}
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
