import type { Route } from "@flash/contract";
import type { z } from "zod";

// What Fastify is told about a route: only the parts the route declares, and the reply schema of every status.
type SchemaOf<R extends Route> = {
	response: R["replies"];
} & (R["params"] extends z.ZodObject ? { params: R["params"] } : unknown) &
	(R["headers"] extends z.ZodObject ? { headers: R["headers"] } : unknown) &
	(R["body"] extends z.ZodObject ? { body: R["body"] } : unknown);

export function schemaOf<const R extends Route>(route: R): SchemaOf<R> {
	const { params, headers, body, replies } = route;
	// The conditional type above says which parts are there; they are added here on the same condition.
	return {
		response: replies,
		...(params && { params }),
		...(headers && { headers }),
		...(body && { body }),
	} as SchemaOf<R>;
}

export function endpoint(route: Route): {
	method: Route["method"];
	url: string;
} {
	return { method: route.method, url: route.path };
}

// A field of a value that has not been checked yet, such as a body the validator has not seen.
export function fieldOf(source: unknown, name: string): unknown {
	return typeof source === "object" && source !== null && name in source
		? Reflect.get(source, name)
		: undefined;
}
