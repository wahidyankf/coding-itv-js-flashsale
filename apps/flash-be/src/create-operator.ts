import { attemptAsync } from "@flash/typekit";
import { createScryptHasher } from "./adapters/outbound/crypto/scrypt-hasher.js";
import { createAccountStore } from "./adapters/outbound/postgres/account-store.js";
import { createDb } from "./adapters/outbound/postgres/database.js";
import { actorId } from "./adapters/outbound/postgres/users.js";
import { config } from "./config.js";
import { SYSTEM_USERNAME } from "./domain/actors.js";
import {
	PASSWORD_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
	usablePassword,
} from "./domain/auth.js";
import { normalizeUser } from "./domain/user.js";

// Usage: node dist/create-operator.js --username ana --password "a long phrase" (or --username=ana --password=...)
// The first operator cannot sign up through the API, so this makes one. The system is its author.
const created = await attemptAsync(async () => {
	const args = process.argv.slice(2);
	// Both `--flag value` and `--flag=value`, like the seed command.
	const argValue = (flag: string) => {
		const joined = args.find((arg) => arg.startsWith(`${flag}=`));
		if (joined !== undefined) return joined.slice(flag.length + 1);
		const at = args.indexOf(flag);
		return at < 0 ? undefined : args[at + 1];
	};
	const username = normalizeUser(argValue("--username"));
	if (username === undefined)
		throw new Error("--username is missing or not a valid name");
	const password = usablePassword(argValue("--password"));
	if (password === undefined) {
		throw new Error(
			`--password must have ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters`,
		);
	}
	const db = createDb(config.databaseUrl);
	try {
		const result = await createAccountStore(db).register({
			username,
			passwordHash: await createScryptHasher().hash(password),
			role: "operator",
			createdBy: await actorId(db, SYSTEM_USERNAME),
		});
		if (result.isErr()) throw new Error(`the user ${username} already exists`);
		console.log(`created operator ${username}`);
	} finally {
		await db.destroy();
	}
}, Error);
if (created.isErr()) {
	console.error(created.error.message);
	process.exitCode = 1;
}
