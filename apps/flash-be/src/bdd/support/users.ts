// Test support: the user name a test writes, as the rule makes it. A test writes "ana" and gets the `Username` that
// `normalizeUser` makes from it, so the brand holds in the tests as it does in the app. Test support only: the app
// never builds a name this way.
import { normalizeUser, type Username } from "../../domain/user.js";

// The name a test logs in, queues or buys with. It throws when the text is not a usable name, which a test never means
// by it; a test of a name the rule refuses calls `normalizeUser` itself.
export function usernameOf(name: string): Username {
	const user = normalizeUser(name);
	if (user === undefined) {
		throw new Error(`"${name}" is not a usable user name`);
	}
	return user;
}
