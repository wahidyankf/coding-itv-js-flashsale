// Test support for user names. `usernameOf` applies the app's rule (`normalizeUser`), so tests and the app agree on a name.
// `shopperNames` gives the crowd a queue scenario needs, with the names the e2e apps use. The app never calls these.
import { normalizeUser, type Username } from "../../domain/user.js";

// Throws for text the rule refuses. A test of a refused name calls `normalizeUser` itself.
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
