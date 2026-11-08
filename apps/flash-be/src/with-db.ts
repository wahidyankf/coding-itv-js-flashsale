// Opens the database for one command and closes it when the work ends, however it ends. Entry point (the outermost
// layer): only the commands use it.
import type { Kysely } from "kysely";
import {
	createDb,
	type Database,
} from "./adapters/outbound/postgres/database.js";

// Runs the work on an open database and closes the connection after it. Whatever the work returns or throws is passed on
// unchanged, so the command still decides what a failure means; this only makes sure the connection is closed.
export async function withDb<T>(
	url: string,
	work: (db: Kysely<Database>) => Promise<T>,
): Promise<T> {
	const db = createDb(url);
	try {
		return await work(db);
	} finally {
		await db.destroy();
	}
}
