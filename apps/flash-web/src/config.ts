// Server only. Settings the web server reads from its environment, used by the proxy and the server loaders. The browser never sees them.
export type Config = {
	backendUrl: string;
};

// Read inside server functions only, so process.env never reaches the client bundle.
export function buildConfig(env: NodeJS.ProcessEnv): Config {
	return {
		backendUrl: env.FLASH_BE_URL ?? "http://localhost:8080",
	};
}
