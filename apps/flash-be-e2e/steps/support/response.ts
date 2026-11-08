// The reply to the last request a scenario sent, so a step never passes a response along. The When steps set it and the Then steps read it.
// cleanup.ts clears it after each scenario, so a Then never reads an earlier scenario's reply. A Then that reads a reply must follow a When that sent one.

import type { APIResponse } from "@playwright/test";

let response: APIResponse | undefined;

// Keeps `next` as the reply the Then steps read.
export function setResponse(next: APIResponse): void {
	response = next;
}

// The reply to the last request, or a throw when the scenario has not sent one yet.
export function currentResponse(): APIResponse {
	if (!response) throw new Error("no request was sent in this scenario");
	return response;
}

// Forgets the reply. cleanup.ts calls it after each scenario, so the next scenario starts without one.
export function clearResponse(): void {
	response = undefined;
}

// The Set-Cookie values of a reply, one per cookie, as the server wrote them.
export function setCookiesOf(reply: APIResponse): string[] {
	return reply
		.headersArray()
		.filter(({ name }) => name.toLowerCase() === "set-cookie")
		.map(({ value }) => value);
}
