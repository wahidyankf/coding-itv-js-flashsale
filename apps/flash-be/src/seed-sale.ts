import { attemptAsync } from "@flash/typekit";
import { parseSeedArgs } from "./adapters/inbound/cli/seed-args.js";
import { createDb } from "./adapters/outbound/postgres/database.js";
import { seedSale } from "./adapters/outbound/postgres/sale-seeder.js";
import { actorId } from "./adapters/outbound/postgres/users.js";
import { config } from "./config.js";
import { SYSTEM_USERNAME } from "./domain/actors.js";

// Usage: node dist/seed-sale.js --stock 100 [--name ...] [--starts-in-minutes 0] [--duration-minutes 60]
//        [--hold-seconds 120] [--admit-per-second 50]
const seeded = await attemptAsync(async () => {
	const input = parseSeedArgs(process.argv.slice(2), new Date());
	const db = createDb(config.databaseUrl);
	try {
		// The product and the sale are made together, by the system.
		const seededSale = await db
			.transaction()
			.execute(async (trx) =>
				seedSale(trx, input, await actorId(trx, SYSTEM_USERNAME)),
			);
		console.log(`seeded sale ${seededSale.id}`);
	} finally {
		await db.destroy();
	}
}, Error);
if (seeded.isErr()) {
	console.error(seeded.error.message);
	process.exitCode = 1;
}
