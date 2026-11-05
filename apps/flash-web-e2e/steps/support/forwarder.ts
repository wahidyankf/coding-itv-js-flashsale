import net from "node:net";

// The web server under test is started once, with FLASH_BE_URL pointing here. Each scenario then decides where this
// forwarder leads: its own private flash-be, the shared one, nowhere, or a canned reply. That is how a scenario can
// make the API unreachable or unwell without touching any other test.
export const FORWARDER_PORT = 18082;
export const FORWARDER_URL = `http://127.0.0.1:${FORWARDER_PORT}`;

type Mode =
	| { kind: "cut" }
	| { kind: "to"; port: number }
	| { kind: "canned"; status: number; body: string };

let mode: Mode = { kind: "cut" };
let server: net.Server | undefined;
const sockets = new Set<net.Socket>();

function handle(client: net.Socket): void {
	sockets.add(client);
	client.on("error", () => client.destroy());
	client.on("close", () => sockets.delete(client));
	const current = mode;
	if (current.kind === "cut") {
		client.destroy();
		return;
	}
	if (current.kind === "canned") {
		client.once("data", () => {
			client.end(
				`HTTP/1.1 ${current.status} Canned\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(current.body)}\r\nconnection: close\r\n\r\n${current.body}`,
			);
		});
		return;
	}
	const upstream = net.connect(current.port, "127.0.0.1");
	sockets.add(upstream);
	upstream.on("error", () => client.destroy());
	upstream.on("close", () => {
		sockets.delete(upstream);
		client.destroy();
	});
	client.on("close", () => upstream.destroy());
	client.pipe(upstream);
	upstream.pipe(client);
}

async function listening(): Promise<void> {
	if (server) return;
	const created = net.createServer(handle);
	await new Promise<void>((resolve, reject) => {
		created.once("error", reject);
		created.listen(FORWARDER_PORT, "127.0.0.1", () => resolve());
	});
	server = created;
}

function dropConnections(): void {
	for (const socket of sockets) socket.destroy();
	sockets.clear();
}

async function set(next: Mode): Promise<void> {
	await listening();
	mode = next;
	// Connections the web server kept open lead to the old place.
	dropConnections();
}

export const forwarder = {
	to: (port: number) => set({ kind: "to", port }),
	cut: () => set({ kind: "cut" }),
	canned: (status: number, body: string) =>
		set({ kind: "canned", status, body }),
	reset: () => set({ kind: "cut" }),
};
