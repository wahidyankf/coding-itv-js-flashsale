// Outside the hexagon. The addresses a local run uses when no environment variable sets them. They match
// compose.dev.yaml. config.ts and the integration tests read the same ones. Local use only: production must set the URLs.
export const localDefaults = {
	host: "::",
	port: "8080",
	databaseUrl: "postgres://flash:flash@localhost:5432/flash",
	redisUrl: "redis://localhost:6379",
	ticketSecret: "local-development-ticket-secret",
};
