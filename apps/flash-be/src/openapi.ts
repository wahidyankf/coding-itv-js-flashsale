// Writes the OpenAPI document of the API to the file named on the command line.
import { writeFile } from "node:fs/promises";
import { buildOpenApi } from "./adapters/inbound/http/openapi.js";
import { unusedDependencies } from "./openapi-deps.js";

const target = process.argv[2];
if (target === undefined) {
	process.stderr.write("usage: openapi <file>\n");
	process.exit(2);
}
await writeFile(
	target,
	`${JSON.stringify(await buildOpenApi(unusedDependencies), null, "\t")}\n`,
);
