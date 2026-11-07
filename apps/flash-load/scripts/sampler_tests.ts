// Unit tests for reading one Postgres sample from the output of psql. The probe itself runs docker, so only the parsing
// is tested here: the three counts, and anything else that psql may print around them.
import { describe, expect, it } from "vitest";
import { parseSample } from "./sampler.ts";

describe("parseSample", () => {
	it("reads the lock, active and idle-in-transaction counts from one line", () => {
		expect(parseSample("3|1|0\n")).toEqual({ locked: 3, active: 1, idle: 0 });
	});

	it("finds the counts among other lines that psql prints", () => {
		expect(parseSample("NOTICE: something\n12|4|2\n")).toEqual({
			locked: 12,
			active: 4,
			idle: 2,
		});
	});

	it.each(["", "psql: could not connect to server", "1|2", "a|b|c", "1|2|3|4"])(
		"reads no sample from %j",
		(out) => {
			expect(parseSample(out)).toBeUndefined();
		},
	);
});
