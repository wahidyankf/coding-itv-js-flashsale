// The standard HTTP status numbers by name, and the two lowest error statuses, so `404` is written once.
// These are HTTP's numbers, not this project's contract: flash-be maps error codes to statuses, and the e2e and k6 tests write those codes themselves. Part of the pure main entry.

// Status numbers by name. The compiler checks each name, so a typo cannot pass as a status.
export const HTTP_STATUS = {
	ok: 200,
	created: 201,
	badRequest: 400,
	unauthorized: 401,
	paymentRequired: 402,
	forbidden: 403,
	notFound: 404,
	conflict: 409,
	tooManyRequests: 429,
	internalServerError: 500,
	badGateway: 502,
	serviceUnavailable: 503,
} as const;

// The lowest status that is an error. Every status from here up is a refusal or a failure, so `status >= this` means error.
export const FIRST_ERROR_STATUS = HTTP_STATUS.badRequest;

// The lowest server-side error. Statuses from here up are failures of the server, not of the request.
export const FIRST_SERVER_ERROR_STATUS = HTTP_STATUS.internalServerError;
