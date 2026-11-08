Feature: The web server in front of the API

  As an operator
  I want the browser to reach the sale only through the web server
  So that the address of the API never leaves the server

  Scenario: The browser reads the sale through the web server
    Given a sale with stock 10 and 3 sold that opens 1 hour ago and closes in 1 hour
    When a client sends GET /api/v1/sales/current
    Then the response status is 200
    And the body names the sale

  Scenario: The page does not contain the address of the API
    Given a sale with stock 10 and 3 sold that opens 1 hour ago and closes in 1 hour
    When a visitor opens the page
    Then the page does not contain the address of the API

  Scenario Outline: Paths outside the sale are refused
    When a client sends GET <path>
    Then the response status is 404
    And the body has error "not_found"

    Examples:
      | path                                                         |
      | /api/v1/sales/..%2Fready                                     |
      | /api/v1/sales/not-a-sale-id                                  |
      | /api/v1/auth/other                                           |
      | /api/v1/sales/11111111-1111-4111-8111-111111111111/queue/ana |

  Scenario Outline: An API path without the version is refused
    When a client sends GET <path>
    Then the response status is 404
    And the body has error "not_found"

    Examples:
      | path                                                  |
      | /api/sales/current                                    |
      | /api/auth/me                                          |
      | /api/sales/11111111-1111-4111-8111-111111111111       |

  Scenario: The operator routes are not reachable through the web server
    When a client sends GET /api/v1/admin/sales
    Then the response status is 404
    And the body has error "not_found"

  Scenario: A write request is passed on with the cookie of the shopper
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" is logged in
    When a client joins the queue through the web server
    Then the response status is 201
    And the body has a ticket
    And the body names "ana"

  Scenario: A shopper who is not logged in is refused by the API
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    When a client joins the queue through the web server
    Then the response status is 401
    And the body has error "not_authenticated"

  Scenario: Signing up sets both cookies, and the refresh cookie is set for the auth path
    When a client signs up through the web server as "ana"
    Then the response status is 201
    And the response sets the cookie "access_token" for the path "/"
    And the response sets the cookie "refresh_token" for the path "/api/v1/auth"
    And both cookies are HttpOnly
    And the body holds neither token

  Scenario: A request from another site is refused before it reaches the API
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" is logged in
    When a client on another site sends POST /api/v1/auth/logout
    Then the response status is 403
    And the body has error "cross_site"
    And the API was not asked

  Scenario: The API is told the shopper's own address, not one the browser wrote
    When a client that writes its address as "6.6.6.6" sends GET /api/v1/sales/current
    Then the API is told the address the request came from
    And the API is not told "6.6.6.6"

  Scenario: An API that cannot be reached gives a gateway error
    Given the sale cannot be reached
    When a client sends GET /api/v1/sales/current
    Then the response status is 502
    And the body has error "backend_unavailable"
