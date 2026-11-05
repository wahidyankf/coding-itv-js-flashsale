import type { APIResponse } from "@playwright/test";

// One response per scenario, shared by every step file. Workers run one at a time (see playwright.config.ts),
// so module state is safe.
let response: APIResponse | undefined;

export function setResponse(next: APIResponse): void {
	response = next;
}

export function currentResponse(): APIResponse {
	if (!response) throw new Error("no request was sent in this scenario");
	return response;
}
