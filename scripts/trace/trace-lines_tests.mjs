// Tests of trace-lines.mjs: which arguments the trace takes, and which log lines it keeps and in what order.
import { describe, expect, it } from "vitest";
import { linesWithId, parseTraceArgs } from "./trace-lines.mjs";

const ID = "8f1c2a4e-5b6d-4e7f-9a0b-1c2d3e4f5a6b";

describe("parseTraceArgs", () => {
	it("takes one request id, on the production compose file by default", () => {
		const parsed = parseTraceArgs([ID]);
		expect(parsed.isOk() && parsed.value).toEqual({
			id: ID,
			project: undefined,
			file: "compose.prod.yaml",
		});
	});

	it("takes a project and a compose file, before or after the id", () => {
		const parsed = parseTraceArgs([
			"--project",
			"flash-smoke",
			ID,
			"--file",
			"other.yaml",
		]);
		expect(parsed.isOk() && parsed.value).toEqual({
			id: ID,
			project: "flash-smoke",
			file: "other.yaml",
		});
	});

	it("reads an id in capitals as the same id", () => {
		const parsed = parseTraceArgs([ID.toUpperCase()]);
		expect(parsed.isOk() && parsed.value.id).toBe(ID);
	});

	it.each([
		["no id", [], "give one request id"],
		["an id that is not a UUID", ["not-an-id"], 'not a UUID: "not-an-id"'],
		["two ids", [ID, ID], "give one request id"],
		["a flag with no value", [ID, "--project"], "--project needs a value"],
		[
			"a flag followed by a flag",
			["--file", "--project", "x", ID],
			"--file needs a value",
		],
		["an unknown flag", [ID, "--since", "1h"], "unknown option --since"],
	])("refuses %s", (_name, argv, message) => {
		const parsed = parseTraceArgs(argv);
		expect(parsed.isErr() && parsed.error).toContain(message);
	});
});

describe("linesWithId", () => {
	const output = [
		`flash-be-2-1  | 2026-11-08T15:00:00.300000000Z {"reqId":"${ID}","msg":"request completed"}`,
		`nginx-1       | 2026-11-08T15:00:00.400000000Z 172.20.0.5 [08/Nov/2026:15:00:00 +0000] "GET /api/v1/sales/current HTTP/1.1" 200 58 0.004 request_id=${ID}`,
		'flash-be-1-1  | 2026-11-08T15:00:00.100000000Z {"reqId":"another","msg":"incoming request"}',
		`flash-be-2-1  | 2026-11-08T15:00:00.200000000Z {"reqId":"${ID}","msg":"incoming request"}`,
		"",
	].join("\n");

	it("keeps only the lines that hold the id, in time order, each with its service", () => {
		expect(linesWithId(output, ID)).toEqual([
			`flash-be-2-1  | 2026-11-08T15:00:00.200000000Z {"reqId":"${ID}","msg":"incoming request"}`,
			`flash-be-2-1  | 2026-11-08T15:00:00.300000000Z {"reqId":"${ID}","msg":"request completed"}`,
			`nginx-1       | 2026-11-08T15:00:00.400000000Z 172.20.0.5 [08/Nov/2026:15:00:00 +0000] "GET /api/v1/sales/current HTTP/1.1" 200 58 0.004 request_id=${ID}`,
		]);
	});

	it("finds an id that a service wrote in capitals", () => {
		const line = `flash-web-1   | 2026-11-08T15:00:00.100000000Z id=${ID.toUpperCase()}`;
		expect(linesWithId(line, ID)).toEqual([line]);
	});

	it("puts a line with no time of its own after the timed ones", () => {
		const timed = `nginx-1  | 2026-11-08T15:00:00.100000000Z request_id=${ID}`;
		const untimed = `a line about ${ID} with no prefix`;
		expect(linesWithId([untimed, timed].join("\n"), ID)).toEqual([
			timed,
			untimed,
		]);
	});

	it("finds nothing when no line holds the id", () => {
		expect(linesWithId(output, "00000000-0000-4000-8000-000000000000")).toEqual(
			[],
		);
	});
});
