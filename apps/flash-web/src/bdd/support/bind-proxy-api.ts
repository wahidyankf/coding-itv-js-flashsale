// Binds specs/apps/flash/web/behaviours/proxy/api.feature at both the unit and the integration layer: the steps of each
// scenario, over the layer's world. Each scenario keeps the reply of its own last request, so no reply carries from one
// scenario to the next. The layer names the scenarios in its own test file, where the behaviour checker reads the titles.
import { API_PATHS, isUuid } from "@flash/flash-commons";
import { expect } from "vitest";
import { fillSaleId } from "../../api-paths";
import {
	isLoggedIn,
	type OutlineBinder,
	openSaleWithThree,
	openTenSale,
	SALE_10,
	SALE_WITH_3,
	type ScenarioBinder,
	visitorOpensPage,
} from "./web-steps";
import type { ApiAnswer, WebWorld } from "./web-world";

// The reply to the last request a scenario sent through the web server, kept where its steps read it.
type AnswerBox = { answer: ApiAnswer | undefined };

// The reply to the last request. A step that reads it before any request was sent fails.
function answerOf(box: AnswerBox): ApiAnswer {
	if (!box.answer) throw new Error("no request was sent");
	return box.answer;
}

// The attributes (`HttpOnly`, `Path=/`, ...) of the cookie of that name in the last reply.
function attributesOf(box: AnswerBox, name: string): string[] {
	const cookie = answerOf(box).cookies.find((value) =>
		value.startsWith(`${name}=`),
	);
	expect(cookie, `a cookie named ${name}`).toBeDefined();
	return (cookie ?? "").split(";").map((part) => part.trim());
}

// "the response status is {int}": the last reply has the status the scenario names.
function statusIs(box: AnswerBox) {
	return (_ctx: unknown, status: number) => {
		expect(answerOf(box).status).toBe(status);
	};
}

// "the body has error {string}": the body of the last reply carries the error code the scenario names.
function errorIs(box: AnswerBox) {
	return (_ctx: unknown, error: string) => {
		expect(answerOf(box).json.errorCode).toBe(error);
	};
}

// The browser reads the sale through the web server, and gets the sale the API holds.
function readsSaleThroughWeb(world: WebWorld): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const last: AnswerBox = { answer: undefined };
		Given(SALE_WITH_3, openSaleWithThree(world));
		When("a client sends GET /api/v1/sales/current", async () => {
			last.answer = await world.send("GET", "/api/v1/sales/current");
		});
		Then("the response status is {int}", statusIs(last));
		And("the body names the sale", () => {
			expect(answerOf(last).json.id).toBe(world.saleId);
		});
	};
}

// The page the browser loads does not show the address of the API.
function pageHidesApi(world: WebWorld): ScenarioBinder {
	return ({ Given, When, Then }) => {
		Given(SALE_WITH_3, openSaleWithThree(world));
		When("a visitor opens the page", visitorOpensPage(world));
		Then("the page does not contain the address of the API", () => {
			expect(world.renderedPage()).not.toContain(world.apiAddress());
		});
	};
}

// A path outside the sale is refused by the web server, with the error the scenario names.
function pathsOutsideRefused(world: WebWorld): OutlineBinder {
	return ({ When, Then, And }, examples) => {
		const last: AnswerBox = { answer: undefined };
		When("a client sends GET <path>", async () => {
			last.answer = await world.send("GET", String(examples.path));
		});
		Then("the response status is {int}", statusIs(last));
		And("the body has error {string}", errorIs(last));
	};
}

// The operator routes are not reachable through the web server.
function operatorRoutesUnreachable(world: WebWorld): ScenarioBinder {
	return ({ When, Then, And }) => {
		const last: AnswerBox = { answer: undefined };
		When("a client sends GET /api/v1/admin/sales", async () => {
			last.answer = await world.send("GET", "/api/v1/admin/sales");
		});
		Then("the response status is {int}", statusIs(last));
		And("the body has error {string}", errorIs(last));
	};
}

// A write request is passed on to the API with the cookie of the shopper who sent it.
function writePassedOn(world: WebWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const last: AnswerBox = { answer: undefined };
		Given(SALE_10, openTenSale(world));
		And("{string} is logged in", isLoggedIn(world));
		When("a client joins the queue through the web server", async () => {
			last.answer = await world.send(
				"POST",
				fillSaleId(API_PATHS.queue, world.saleId),
				{},
			);
		});
		Then("the response status is {int}", statusIs(last));
		And("the body has a ticket", () => {
			expect(typeof answerOf(last).json.ticket).toBe("string");
		});
		And("the body names {string}", (_ctx, name: string) => {
			expect(answerOf(last).json.userId).toBe(name);
		});
	};
}

// A request to join the queue without a login is refused by the API, and the web server passes the refusal on.
function anonymousRefused(world: WebWorld): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const last: AnswerBox = { answer: undefined };
		Given(SALE_10, openTenSale(world));
		When("a client joins the queue through the web server", async () => {
			last.answer = await world.send(
				"POST",
				fillSaleId(API_PATHS.queue, world.saleId),
				{},
			);
		});
		Then("the response status is {int}", statusIs(last));
		And("the body has error {string}", errorIs(last));
	};
}

// Signing up sets both cookies, and the refresh cookie is only sent to the auth path.
function signUpSetsCookies(world: WebWorld): ScenarioBinder {
	return ({ When, Then, And }) => {
		const last: AnswerBox = { answer: undefined };
		When(
			"a client signs up through the web server as {string}",
			async (_ctx, name: string) => {
				last.answer = await world.send("POST", API_PATHS.authRegister, {
					username: name,
					password: "a long password",
				});
			},
		);
		Then("the response status is {int}", statusIs(last));
		And(
			"the response sets the cookie {string} for the path {string}",
			(_ctx, name: string, path: string) => {
				expect(attributesOf(last, name)).toContain(`Path=${path}`);
			},
		);
		And(
			'the response sets the cookie "refresh_token" for the path "/api/v1/auth"',
			() => {
				expect(attributesOf(last, "refresh_token")).toContain(
					"Path=/api/v1/auth",
				);
			},
		);
		And("both cookies are HttpOnly", () => {
			const reply = answerOf(last);
			expect(reply.cookies).toHaveLength(2);
			for (const cookie of reply.cookies) {
				expect(cookie.split(";").map((part) => part.trim())).toContain(
					"HttpOnly",
				);
			}
		});
		And("the body holds neither token", () => {
			const reply = answerOf(last);
			const body = JSON.stringify(reply.json);
			for (const cookie of reply.cookies) {
				const token = cookie.split(";")[0]?.split("=")[1] ?? "";
				expect(token).not.toBe("");
				expect(body).not.toContain(token);
			}
		});
	};
}

// A request from another site is refused before it reaches the API.
function otherSiteRefused(world: WebWorld): ScenarioBinder {
	return ({ Given, And, When, Then }) => {
		const last: AnswerBox = { answer: undefined };
		Given(SALE_10, openTenSale(world));
		And("{string} is logged in", isLoggedIn(world));
		When(
			"a client on another site sends POST /api/v1/auth/logout",
			async () => {
				last.answer = await world.send(
					"POST",
					"/api/v1/auth/logout",
					{},
					"http://evil.test",
				);
			},
		);
		Then("the response status is {int}", statusIs(last));
		And("the body has error {string}", errorIs(last));
		And("the API was not asked", () => {
			expect(answerOf(last).reachedApi).toBe(false);
		});
	};
}

// The API limits by address, so the web server tells it the address its socket saw, and never one the client wrote.
function callerAddressPassedOn(world: WebWorld): ScenarioBinder {
	return ({ When, Then, And }) => {
		When(
			"a client that writes its address as {string} sends GET /api/v1/sales/current",
			async (_ctx, written: string) => {
				await world.send("GET", "/api/v1/sales/current", undefined, undefined, {
					"x-forwarded-for": written,
				});
			},
		);
		Then("the API is told the address the request came from", () => {
			expect(world.apiTold("x-forwarded-for")).toBe(world.callerAddress());
		});
		And("the API is not told {string}", (_ctx, written: string) => {
			expect(world.apiTold("x-forwarded-for")).not.toContain(written);
		});
	};
}

// The web server gives each request an id of its own, which the API logs and the browser gets back, so one request can be
// traced from the reply to the logs. An id the client wrote is never passed on.
function requestIdShared(world: WebWorld): ScenarioBinder {
	return ({ When, Then, And }) => {
		const last: AnswerBox = { answer: undefined };
		When(
			"a client that writes the request id {string} sends GET /api/v1/sales/current",
			async (_ctx, written: string) => {
				last.answer = await world.send(
					"GET",
					"/api/v1/sales/current",
					undefined,
					undefined,
					{ "x-request-id": written },
				);
			},
		);
		Then("the API is told a request id that is a UUID", () => {
			expect(isUuid(world.apiTold("x-request-id") ?? "")).toBe(true);
		});
		And(
			"the API is not told the request id {string}",
			(_ctx, written: string) => {
				expect(world.apiTold("x-request-id")).not.toBe(written);
			},
		);
		And("the reply carries the request id the API was told", () => {
			expect(answerOf(last).requestId).toBe(world.apiTold("x-request-id"));
		});
	};
}

// The API cannot be reached, and the web server answers with a gateway error.
function apiUnreachable(world: WebWorld): ScenarioBinder {
	return ({ Given, When, Then, And }) => {
		const last: AnswerBox = { answer: undefined };
		Given("the sale cannot be reached", () => world.cutOff());
		When("a client sends GET /api/v1/sales/current", async () => {
			last.answer = await world.send("GET", "/api/v1/sales/current");
		});
		Then("the response status is {int}", statusIs(last));
		And("the body has error {string}", errorIs(last));
	};
}

// The steps of each scenario in the proxy feature, by the scenario's name in the layer's test file.
export function bindProxyApi(world: WebWorld) {
	return {
		readsSaleThroughWeb: readsSaleThroughWeb(world),
		pageHidesApi: pageHidesApi(world),
		pathsOutsideRefused: pathsOutsideRefused(world),
		operatorRoutesUnreachable: operatorRoutesUnreachable(world),
		writePassedOn: writePassedOn(world),
		anonymousRefused: anonymousRefused(world),
		signUpSetsCookies: signUpSetsCookies(world),
		otherSiteRefused: otherSiteRefused(world),
		callerAddressPassedOn: callerAddressPassedOn(world),
		requestIdShared: requestIdShared(world),
		apiUnreachable: apiUnreachable(world),
	};
}
