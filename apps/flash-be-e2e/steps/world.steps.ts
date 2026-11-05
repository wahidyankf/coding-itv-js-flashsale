import { createBdd } from "playwright-bdd";
import { cleanup } from "./support/world.js";

const { After } = createBdd();

// Every scenario cleans up what it started: its private API process and its scratch database.
After(async () => {
	await cleanup();
});
