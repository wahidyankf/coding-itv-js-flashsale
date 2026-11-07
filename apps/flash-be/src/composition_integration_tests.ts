// The operator command's wiring over Postgres: the operator it makes can log in, and the login can manage sales.
import { afterAll, beforeEach, expect, it } from "vitest";
import { createDb } from "./adapters/outbound/postgres/database.js";
import { actorId } from "./adapters/outbound/postgres/users.js";
import { resetSales } from "./bdd/support/seed.js";
import { postgresAuth } from "./composition.js";
import { config } from "./config.js";
import { SYSTEM_USERNAME } from "./domain/actors.js";

const db = createDb(config.databaseUrl);
const PASSWORD = "a long password";

beforeEach(async () => {
	await resetSales(db);
});

afterAll(async () => {
	await db.destroy();
});

it("makes an operator that can log in and then manage sales", async () => {
	const auth = postgresAuth(db);
	const made = await auth.createOperator(
		"boss",
		PASSWORD,
		await actorId(db, SYSTEM_USERNAME),
	);
	expect(made.isOk() && made.value.role).toBe("operator");

	const login = await auth.login("boss", PASSWORD);
	if (login.isErr()) throw new Error("the operator could not log in");
	const who = await auth.authorizeOperator(login.value.accessToken);
	expect(who.isOk() && who.value.username).toBe("boss");
});
