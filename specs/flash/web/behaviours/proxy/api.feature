Feature: The web server in front of the API

  As an operator
  I want the browser to reach the sale only through the web server
  So that the address of the API never leaves the server

  Scenario: The browser reads the sale through the web server
    Given a sale with stock 10 and 3 sold that opens 1 hour ago and closes in 1 hour
    When a client sends GET /api/sales/current
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
      | path                       |
      | /api/sales/..%2Fready      |
      | /api/sales/not-a-sale-id   |

  Scenario: A write request is passed on with the ticket
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    When a client joins the queue through the web server
    Then the response status is 201
    And the body has a ticket

  Scenario: An API that cannot be reached gives a gateway error
    Given the sale cannot be reached
    When a client sends GET /api/sales/current
    Then the response status is 502
    And the body has error "backend_unavailable"
