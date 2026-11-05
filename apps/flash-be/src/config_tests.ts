import { expect, it } from "vitest";
import { buildConfig, describeConfig } from "./config.js";

// The startup line is read by the e2e suite. It must show host and port and never a password.
it("describeConfig shows host and port without credentials", () => {
	const line = describeConfig(
		buildConfig({
			FLASH_BE_PORT: "9000",
			DATABASE_URL: "postgres://u:secret@db:5432/x",
			REDIS_URL: "redis://cache:6379",
		}),
	);
	expect(line).toBe(
		"flash-be config: port=9000 database=db:5432 redis=cache:6379",
	);
	expect(line).not.toContain("secret");
});
