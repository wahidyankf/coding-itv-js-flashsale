// The checks of the production smoke test (scripts/smoke/prod.mjs) that look at the stack through Docker: one request
// followed by its id in the logs, and services that exit by themselves and are started again.
import {
	API_PATHS,
	HTTP_STATUS,
	isUuid,
	PROBE_PATHS,
	retryAsync,
} from "@flash/flash-commons";
import { sleep } from "@flash/flash-commons/timers";
import { Err, Ok } from "@flash/typekit";

// The port an API instance listens on inside its container (FLASH_BE_PORT in compose.prod.yaml).
const API_INTERNAL_PORT = 8080;
// A service that exited is waited for until Docker has started it again and it is healthy. Docker's restart backoff and
// the healthcheck interval (2 seconds for Redis, 10 for an API instance) fit well inside this.
const RECOVERY_POLICY = { baseMs: 250, capMs: 2000, maxAttempts: 60 };
// A log line can reach `docker compose logs` a moment after the reply. The trace looks again for a few seconds at most.
const LOG_POLICY = { baseMs: 100, capMs: 1000, maxAttempts: 10 };
const REQUEST_ID_HEADER = "x-request-id";

// The checks over one running stack. `stack` is its compose commands (docker.mjs), `step` prints a step, `origin` is the
// web server's address on this machine, and `instances` are the names of the API services.
export function stackChecks({ stack, step, origin, instances }) {
	// Waits until the logs of `services` hold `id`, so a line written just after the reply still counts.
	async function logsHold(services, id) {
		const found = await retryAsync(
			async () =>
				stack.run("logs", "--no-color", ...services).includes(id)
					? new Ok(id)
					: new Err(id),
			{ ...LOG_POLICY, sleep, random: Math.random },
		);
		return found.isOk();
	}

	// Whether one API instance answers /ready with 200, which it does only when both Postgres and Redis answer it. Asked
	// inside the instance, so nginx does not pick which instance answers.
	function instanceReady(service) {
		return stack.succeeds(
			"exec",
			"-T",
			service,
			"wget",
			"-qO-",
			`http://127.0.0.1:${API_INTERNAL_PORT}${PROBE_PATHS.ready}`,
		);
	}

	// Makes the process of a service exit from inside, as a crash would, then waits until Docker has started it again
	// (restart: unless-stopped) and `isReady` holds. `docker stop` would prove nothing: a container stopped on purpose is
	// not started again. The command that ends the process may itself fail as the container goes, so its exit is not read.
	async function exitAndComeBack(service, command, isReady) {
		const before = stack.state(service).restarts;
		stack.succeeds("exec", "-T", service, ...command);
		const back = await retryAsync(
			async () => {
				const state = stack.state(service);
				return state.restarts > before && state.up && isReady()
					? new Ok(state)
					: new Err(state);
			},
			{ ...RECOVERY_POLICY, sleep, random: Math.random },
		);
		if (back.isErr()) {
			throw new Error(
				`${service} did not come back: ${JSON.stringify(back.error)}`,
			);
		}
	}

	return {
		// One request through the web server can be followed by its id: the reply carries it, and nginx and the API
		// instance that served it log it. nginx's port 8081 and flash-be keep the id flash-web made, so all show the same one.
		async checkTrace() {
			step(
				"a request through the web server carries a request id that nginx and an API instance both log",
			);
			const reply = await fetch(`${origin}${API_PATHS.saleCurrent}`);
			const id = reply.headers.get(REQUEST_ID_HEADER) ?? "";
			if (reply.status !== HTTP_STATUS.ok || !isUuid(id)) {
				throw new Error(
					`the current sale answered ${reply.status} with request id "${id}"`,
				);
			}
			if (!(await logsHold(["nginx"], id))) {
				throw new Error(`nginx did not log the request id ${id}`);
			}
			if (!(await logsHold(instances, id))) {
				throw new Error(`no API instance logged the request id ${id}`);
			}
		},

		// A store or an instance that exits is started again, so the API does not stay on its Postgres-only path, nor short
		// of an instance, for good. `seesSale` checks after each that the sale can still be read.
		async checkRecovery(seesSale) {
			step(
				"Redis exits by itself, Docker starts it again, and every API instance is ready again",
			);
			await exitAndComeBack("redis", ["redis-cli", "SHUTDOWN", "NOSAVE"], () =>
				instances.every(instanceReady),
			);
			await seesSale();

			const instance = instances[1];
			step(`${instance} exits, Docker starts it again, and it is ready again`);
			// SIGTERM, which flash-be answers by closing and exiting. A process that is PID 1 ignores a signal it has no
			// handler for.
			await exitAndComeBack(instance, ["kill", "1"], () =>
				instanceReady(instance),
			);
			await seesSale();
		},
	};
}
