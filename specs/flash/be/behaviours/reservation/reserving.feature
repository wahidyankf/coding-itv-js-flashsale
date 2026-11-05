Feature: Reserving an item

  As an admitted shopper
  I want to hold one item for a short time
  So that I can pay for it without someone else taking it

  Scenario: An admitted shopper reserves an item
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has been admitted
    When "ana" reserves an item
    Then the response status is 201
    And the user is "ana"
    And a reservation id is issued
    And the hold ends in 120 seconds

  Scenario: Reserving again returns the same hold
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has been admitted
    And "ana" has reserved an item
    When "ana" reserves an item
    Then the response status is 200
    And the reservation is the one "ana" had before

  Scenario: A shopper who is still waiting cannot reserve
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has joined the queue
    When "ana" reserves an item
    Then the response status is 403
    And the error is "not_admitted"

  Scenario: A shopper with a wrong ticket cannot reserve
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has been admitted
    When "ana" reserves an item with a wrong ticket
    Then the response status is 401
    And the error is "invalid_ticket"

  Scenario Outline: A sale that is not selling does not take reservations
    Given a sale with stock 10 and <sold> sold that opens <opens> and closes <closes>
    When "ana" reserves an item
    Then the response status is 409
    And the error is "<error>"

    Examples:
      | sold | opens       | closes     | error            |
      | 0    | in 1 hour   | in 2 hours | sale_not_started |
      | 3    | 2 hours ago | 1 hour ago | sale_ended       |
      | 10   | 1 hour ago  | in 1 hour  | sold_out         |

  Scenario: Reserving in an unknown sale is refused
    Given no sale exists
    When "ana" reserves an item in the sale with id "00000000-0000-4000-8000-000000000000"
    Then the response status is 404
    And the error is "sale_not_found"

  Scenario: Holds count against the stock
    Given a sale with stock 2 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has been admitted
    And "ben" has been admitted
    And "cai" has been admitted
    And "ana" has reserved an item
    And "ben" has reserved an item
    When "cai" reserves an item
    Then the response status is 409
    And the error is "sold_out"

  Scenario: An expired hold gives the item back
    Given a sale with stock 1 and 0 sold that opens 1 hour ago and closes in 1 hour
    And the hold time of the sale is 1 second
    And "ana" has been admitted
    And "ben" has been admitted
    And "ana" has reserved an item
    When 2 seconds pass
    And "ben" reserves an item
    Then the response status is 201

  Scenario: Many shoppers reserving at once never hold more than the stock
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And 30 shoppers have been admitted
    When all 30 shoppers reserve an item at the same time
    Then 10 reservations are granted
    And 20 shoppers are told the item is sold out

  Scenario: A failed write to Postgres gives the item back
    Given a sale with stock 1 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has been admitted
    And "ben" has been admitted
    And Postgres refuses to save reservations
    When "ana" reserves an item and the write fails
    And Postgres saves reservations again
    And "ben" reserves an item
    Then the response status is 201
