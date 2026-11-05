import { attemptAsync } from "@flash/typekit";
import { parseSeedArgs } from "./adapters/inbound/cli/seed-args.js";
import { createDb } from "./adapters/outbound/postgres/database.js";
import { seedSale } from "./adapters/outbound/postgres/sale-seeder.js";
import { config } from "./config.js";

// Usage: node dist/seed-sale.js --stock 100 [--name ...] [--starts-in-minutes 0] [--duration-minutes 60]
//        [--hold-seconds 120] [--admit-per-second 50]
const seeded = await attemptAsync(async () => {
	const input = parseSeedArgs(process.argv.slice(2), new Date());
	const db = createDb(config.databaseUrl);
	try {
		console.log(`seeded sale ${await seedSale(db, input)}`);
	} finally {
		await db.destroy();
	}
}, Error);
if (seeded.isErr()) {
	console.error(seeded.error.message);
	process.exitCode = 1;
}
