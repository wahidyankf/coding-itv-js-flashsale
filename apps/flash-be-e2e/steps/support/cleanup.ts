// The teardown of every scenario: close what it opened, stop its API, drop its database, and forget its state. It sits in
// its own file because it needs the processes and the database, and they need the state, so putting it in world.ts
// would make the modules import each other.

import { dropScratchDatabase } from "./database.js";
import { stopApi } from "./processes.js";
import { clearResponse } from "./response.js";
import { forgetScenario, world } from "./world.js";

// Runs from the After hook of each e2e app, so no scenario leaves a process or a database behind.
export async function cleanup(): Promise<void> {
	for (const close of world.streams ?? []) close();
	clearResponse();
	await stopApi();
	if (world.databaseName) await dropScratchDatabase(world.databaseName);
	forgetScenario();
}
