// The auth steps both account features bind the same way: a shopper who has signed up, and the login a shopper is seen
// with. They are bodies over the auth world the layer makes, so the wording stays in each feature's own binding.
import { expect } from "vitest";
import type { AuthWorld } from "./auth-world.js";

// "{string} has signed up with the password {string}": the account is made, so the sign-up answers 201.
export function signedUp(world: AuthWorld) {
	return async (_ctx: unknown, name: string, password: string) => {
		expect((await world.signUp(name, password)).statusCode).toBe(201);
	};
}

// "the shopper is logged in as {string}": asking who is logged in answers with that name.
export function loggedInAs(world: AuthWorld) {
	return async (_ctx: unknown, name: string) => {
		const reply = await world.me();
		expect(reply.statusCode).toBe(200);
		expect(reply.json().username).toBe(name);
	};
}
