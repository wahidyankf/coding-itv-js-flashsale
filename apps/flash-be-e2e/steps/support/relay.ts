// Relays between a client and an upstream server, for the tests that sit between the two (the Redis proxy in front of
// the API, the forwarder in front of the web server). A scenario can then drop the path, as a real outage would.

import type { Socket } from "node:net";

// Pipes the two sockets into each other and records them in `open`, so a scenario can drop them all at once. A socket that
// fails is destroyed, and when either side closes, the other is destroyed too, so no half-open path is left behind.
export function pipeSockets(
	client: Socket,
	upstream: Socket,
	open: Set<Socket>,
): void {
	for (const socket of [client, upstream]) {
		open.add(socket);
		socket.on("error", () => socket.destroy());
		socket.on("close", () => {
			open.delete(socket);
			client.destroy();
			upstream.destroy();
		});
	}
	client.pipe(upstream);
	upstream.pipe(client);
}
