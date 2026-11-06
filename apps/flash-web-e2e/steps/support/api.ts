import type { APIRequestContext } from "@playwright/test";

export const TICKET_HEADER = "x-queue-ticket";

// Plain helpers to call the API as another client would.
export const salePath = (saleId: string | undefined) =>
	`/sales/${saleId ?? ""}`;

export const postJson = (
	request: APIRequestContext,
	url: string,
	body: object,
	headers: Record<string, string> = {},
) => request.post(url, { data: body, headers });

export const getJson = (
	request: APIRequestContext,
	url: string,
	headers: Record<string, string> = {},
) => request.get(url, { headers });
