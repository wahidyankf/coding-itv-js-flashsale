// A hook, not a step: after every scenario of flash-be-e2e it runs cleanup, so no scenario leaves a process, a database or
// state behind. It binds no feature file, because it applies to all of them.

import { createBdd } from "playwright-bdd";
import { cleanup } from "./support/cleanup.js";

const { After } = createBdd();

// Every scenario cleans up what it started: its private API process and its scratch database.
After(async () => {
	await cleanup();
});
