import { randomUUID } from "node:crypto";
import pg from "pg";

const DEFAULT_DATABASE_URL = "postgres://flash:flash@localhost:5432/flash";

// Creates an empty database for one scenario, for steps that must start with no tables.
export async function createScratchDatabase(): Promise<{
	url: string;
	drop: () => Promise<void>;
}> {
	const serverUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
	const name = `flash_scratch_${randomUUID().replaceAll("-", "_")}`;

	const admin = new pg.Client({ connectionString: serverUrl });
	await admin.connect();
	await admin.query(`create database "${name}"`);
	await admin.end();

	const url = new URL(serverUrl);
	url.pathname = `/${name}`;

	return {
		url: url.toString(),
		drop: async () => {
			const cleanup = new pg.Client({ connectionString: serverUrl });
			await cleanup.connect();
			await cleanup.query(`drop database if exists "${name}" with (force)`);
			await cleanup.end();
		},
	};
}
