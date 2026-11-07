// The checks the log in and sign up form makes before it sends anything. Pure, so a test can run the rules without
// rendering the form. The server still has the last word on every check.
import { Err, Ok, type Result } from "@flash/typekit";
import { AUTH_TEXT, cleanPassword, cleanUser } from "./messages";
import type { AuthMode } from "./types";

// What the form sends: the name in the form the API keeps, and the password as typed.
export type Credentials = { username: string; password: string };

// Gives back what to send, or the sentence to show when the form should not send. The name is checked first. The
// password is checked on sign up only: an old account may have a password this form would now refuse, and only the
// server decides on a login.
export function checkCredentials(
	mode: AuthMode,
	rawUser: string,
	rawPassword: string,
): Result<Credentials, string> {
	const username = cleanUser(rawUser);
	if (username === undefined) return new Err(AUTH_TEXT.invalidUser);
	const password = mode === "signup" ? cleanPassword(rawPassword) : rawPassword;
	if (password === undefined || password === "") {
		return new Err(AUTH_TEXT.passwordLength);
	}
	return new Ok({ username, password });
}
