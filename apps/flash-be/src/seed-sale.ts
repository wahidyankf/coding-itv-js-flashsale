// Entry point: the seed command. It stores one sale for the demo and the tests, through the seed use case, and it does
// not check for overlap: that check belongs to an operator's create.
import { attemptAsync } from "@flash/typekit";
import { failureMessage } from "./adapters/inbound/cli/failure-message.js";
import { parseSeedArgs } from "./adapters/inbound/cli/seed-args.js";
import { createDb } from "./adapters/outbound/postgres/database.js";
import { createSaleSeeder } from "./adapters/outbound/postgres/sale-seeder.js";
import { actorId } from "./adapters/outbound/postgres/users.js";
import { createSaleSeedService } from "./application/sale-seed-service.js";
import { config } from "./config.js";
import { SYSTEM_USERNAME } from "./domain/actors.js";

// Usage: node dist/seed-sale.js --stock 100 [--name ...] [--starts-in-minutes 0] [--duration-minutes 60]
//        [--hold-seconds 120] [--admit-per-second 50]
const seeded = await attemptAsync(async () => {
	const input = parseSeedArgs(process.argv.slice(2), new Date());
	const db = createDb(config.databaseUrl);
	try {
		// The product and the sale are made together, by the system.
		const sale = await createSaleSeedService(createSaleSeeder(db)).seed(
			input,
			await actorId(db, SYSTEM_USERNAME),
		);
		console.log(`seeded sale ${sale.id}`);
	} finally {
		await db.destroy();
	}
}, Error);
if (seeded.isErr()) {
	console.error(failureMessage(seeded.error));
	process.exitCode = 1;
}
