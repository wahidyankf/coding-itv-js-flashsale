// A forwarder the web server sends its API calls through. The web server is started once, with FLASH_BE_URL pointing here, and
// each scenario decides where the forwarder leads: its own private flash-be, the shared one, nowhere, or a canned reply. So a
// scenario can make the API unreachable or unwell without touching any other test.

import net from "node:net";
import { pipeSockets } from "../../../flash-be-e2e/steps/support/relay.js";

// The fixed port of the forwarder. The web server is started once with FLASH_BE_URL pointing here.
export const FORWARDER_PORT = 18082;
// The address the web server is started with (FLASH_BE_URL), so every API call of the page goes through the forwarder.
export const FORWARDER_URL = `http://127.0.0.1:${FORWARDER_PORT}`;

type Mode =
	| { kind: "cut" }
	| { kind: "to"; port: number }
	| { kind: "canned"; status: number; body: string };

let mode: Mode = { kind: "cut" };
let server: net.Server | undefined;
const sockets = new Set<net.Socket>();

// Handles one connection from the web server, in the mode that is set when it arrives.
function handle(client: net.Socket): void {
	const current = mode;
	if (current.kind === "to") {
		pipeSockets(client, net.connect(current.port, "127.0.0.1"), sockets);
		return;
	}
	sockets.add(client);
	client.on("error", () => client.destroy());
	client.on("close", () => sockets.delete(client));
	if (current.kind === "cut") {
		client.destroy();
		return;
	}
	client.once("data", () => {
		client.end(
			`HTTP/1.1 ${current.status} Canned\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(current.body)}\r\nconnection: close\r\n\r\n${current.body}`,
		);
	});
}

// Starts the forwarder on its fixed port the first time a scenario needs it.
async function listening(): Promise<void> {
	if (server) return;
	const created = net.createServer(handle);
	await new Promise<void>((resolve, reject) => {
		created.once("error", reject);
		created.listen(FORWARDER_PORT, "127.0.0.1", () => resolve());
	});
	server = created;
}

// Drops every connection the web server holds, so the next request goes to the new place, not the old one.
function dropConnections(): void {
	for (const socket of sockets) socket.destroy();
	sockets.clear();
}

// Sets where the forwarder leads. Connections the web server kept open lead to the old place, so they are dropped.
async function set(next: Mode): Promise<void> {
	await listening();
	mode = next;
	dropConnections();
}

// The places a scenario can point the forwarder at. Each call waits until the forwarder listens.
export const forwarder = {
	to: (port: number) => set({ kind: "to", port }),
	cut: () => set({ kind: "cut" }),
	canned: (status: number, body: string) =>
		set({ kind: "canned", status, body }),
	reset: () => set({ kind: "cut" }),
};
