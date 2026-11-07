// Unit tests for the checks the account form makes before it sends anything.
import { describe, expect, it } from "vitest";
import { checkCredentials } from "./credentials";
import { AUTH_TEXT } from "./messages";

describe("checkCredentials", () => {
	it("gives back the name in the form the API keeps", () => {
		const checked = checkCredentials("login", "  Ana.B ", "a long password");
		expect(checked.isOk()).toBe(true);
		expect(checked.isOk() && checked.value).toEqual({
			username: "ana.b",
			password: "a long password",
		});
	});

	it("refuses a name the API would refuse, without sending it", () => {
		const checked = checkCredentials("signup", "has space", "a long password");
		expect(checked.isErr() && checked.error).toBe(AUTH_TEXT.invalidUser);
	});

	it("refuses a short password when a shopper signs up", () => {
		const checked = checkCredentials("signup", "ana", "short");
		expect(checked.isErr() && checked.error).toBe(AUTH_TEXT.passwordLength);
	});

	it("lets a login through with an old password, because only the server knows the rule", () => {
		const checked = checkCredentials("login", "ana", "short");
		expect(checked.isOk() && checked.value.password).toBe("short");
	});

	it("refuses a login with no password at all", () => {
		const checked = checkCredentials("login", "ana", "");
		expect(checked.isErr() && checked.error).toBe(AUTH_TEXT.passwordLength);
	});
});
