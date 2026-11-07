// The addresses a local run uses when no environment variable sets them. They match compose.dev.yaml. The configuration
// reads them when a variable is absent, and the integration test setup reads the same ones, so the local database and
// Redis have one address in the code. Local use only: production must set the URLs.
export const localDefaults = {
	host: "::",
	port: "8080",
	databaseUrl: "postgres://flash:flash@localhost:5432/flash",
	redisUrl: "redis://localhost:6379",
	ticketSecret: "local-development-ticket-secret",
};
