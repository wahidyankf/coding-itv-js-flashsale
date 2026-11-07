Feature: Joining the queue

  As a shopper
  I want to join the waiting queue after I log in
  So that I get a place in line and a ticket that proves it

  Scenario: Joining the queue returns a ticket and a place
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    When "ana" joins the queue
    Then the response status is 201
    And the user is "ana"
    And a ticket is issued
    And the place in line is 1

  Scenario: Shoppers are placed in the order they join
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    When "ana" joins the queue
    And "ben" joins the queue
    And "cai" joins the queue
    Then the place in line of "ana" is 1
    And the place in line of "ben" is 2
    And the place in line of "cai" is 3

  Scenario: Joining twice keeps the place and the ticket
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has joined the queue
    And "ben" has joined the queue
    When "ana" joins the queue again
    Then the response status is 200
    And the place in line is 1
    And the ticket is the one "ana" had before

  Scenario: A user name is trimmed and lowercased
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    When "ANA" joins the queue
    Then the user is "ana"

  Scenario Outline: A sale that cannot sell any more does not take new shoppers
    Given a sale with stock 10 and <sold> sold that opens 2 hours ago and closes <closes>
    When "ana" joins the queue
    Then the response status is 409
    And the error is "<error>"

    Examples:
      | sold | closes     | error      |
      | 3    | 1 hour ago | sale_ended |
      | 10   | in 1 hour  | sold_out   |

  Scenario: Joining the queue of an unknown sale is refused
    Given no sale exists
    When "ana" joins the queue of the sale with id "00000000-0000-4000-8000-000000000000"
    Then the response status is 404
    And the error is "sale_not_found"
