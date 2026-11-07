// Test support: the user name a test writes, as the rule makes it. A test writes "ana" and gets the `Username` that
// `normalizeUser` makes from it, so the brand holds in the tests as it does in the app. Test support only: the app
// never builds a name this way. It also gives the crowd of shopper names a scenario queues, the same names the e2e apps use.
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

// The names of the first `count` shoppers, shopper0 up to shopper{count - 1}, in the order a scenario queues them.
export function shopperNames(count: number): string[] {
	return Array.from({ length: count }, (_, i) => `shopper${i}`);
}
