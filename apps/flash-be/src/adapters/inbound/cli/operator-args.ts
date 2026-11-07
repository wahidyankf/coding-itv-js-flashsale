// The create-operator command as the CLI sees it: it reads the options, checks them with the same rules the HTTP edge
// uses, and words each refusal for the terminal. It is an inbound adapter, so it knows the command line and nothing of
// the database.
import { parseArgs } from "node:util";
import { Err, Ok, type Result } from "@flash/typekit";
import {
	PASSWORD_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
	usablePassword,
} from "../../../domain/auth.js";
import { normalizeUser, type Username } from "../../../domain/user.js";

// The two options as typed. A flag that was not given is undefined.
export type OperatorArgs = {
	username: string | undefined;
	password: string | undefined;
};

// Why these options cannot make an operator: the name or the password is not usable, or the name is taken.
export type OperatorRefusal =
	| "invalid_user"
	| "invalid_password"
	| "username_taken";

// Reads `--username` and `--password`, each as `--flag value` or `--flag=value`. Anything else is a usage error.
export function parseOperatorArgs(argv: string[]): OperatorArgs {
	const { values } = parseArgs({
		args: argv,
		options: {
			username: { type: "string" },
			password: { type: "string" },
		},
		strict: true,
	});
	return { username: values.username, password: values.password };
}

// The options as the use case takes them: a usable name and a usable password, or the first refusal. It runs before the
// database is touched, so a bad option is never reported as a database failure. The use case only takes what this makes.
export function operatorInputOf(
	args: OperatorArgs,
): Result<{ username: Username; password: string }, OperatorRefusal> {
	const username =
		args.username === undefined ? undefined : normalizeUser(args.username);
	if (username === undefined) return new Err("invalid_user");
	const password =
		args.password === undefined ? undefined : usablePassword(args.password);
	if (password === undefined) return new Err("invalid_password");
	return new Ok({ username, password });
}

// The words the command prints for each refusal. They are part of the command's contract (the demo script reads the
// "already exists" line), so change them with care. `username` is the name of a taken refusal, already in its usable form.
export function refusalMessage(
	error: OperatorRefusal,
	username: Username | undefined,
): string {
	switch (error) {
		case "invalid_user":
			return "--username is missing or not a valid name";
		case "invalid_password":
			return `--password must have ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters`;
		case "username_taken":
			return `the user ${username} already exists`;
	}
}
