// The scenario's sale, read again through the API, for the steps that check its state after a change. Each read is the
// state now, not the body of an earlier reply, so the steps that need the sale call it here instead of sending their own.

import type { APIRequestContext, APIResponse } from "@playwright/test";
import { routes, send } from "./api.js";
import { currentSaleId } from "./world.js";

// Asks the API for the scenario's sale and returns the reply. A step that wants the body passes the reply to bodyOf.
export function saleNow(request: APIRequestContext): Promise<APIResponse> {
	return send(request, routes.sale, { params: { saleId: currentSaleId() } });
}
