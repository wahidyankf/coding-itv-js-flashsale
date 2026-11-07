// The reply the app gives to a request, as the scenarios read it. One name for it, so the unit and integration layers and
// the step bindings all share the same type.
import type { FastifyInstance } from "fastify";

export type Response = Awaited<ReturnType<FastifyInstance["inject"]>>;
