// The reply the app gives to a request, as the scenarios read it. One name for it, so the unit and integration layers and
// the step bindings all share the same type, and one accessor for the last reply a step reads.
import type { FastifyInstance } from "fastify";

// The reply the app gives to a request, as a scenario reads it. One name for it across the layers and the bindings.
export type Response = Awaited<ReturnType<FastifyInstance["inject"]>>;

// Anything that keeps the last reply of a scenario: the queue worlds, the auth world and the operator world.
export type ReplyHolder = { readonly response: Response | undefined };

// The last reply a scenario got. A step reads it only after a request was sent, so a missing reply is a bug in the scenario.
export function responseOf(holder: ReplyHolder): Response {
	if (!holder.response) throw new Error("no request was sent");
	return holder.response;
}

// A holder a scenario writes its own last reply into, for the steps that read it. A reply that is not kept on the world
// (the operator's replies, for one) is written here, so the status and error steps read it like any other.
export type ReplyBox = { response: Response | undefined };
