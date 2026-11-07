Feature: Sale status

  As a shopper
  I want to see whether the sale is upcoming, active, sold out or ended
  So that I know whether I can still buy

  Scenario Outline: The sale reports its status from its window and its stock
    Given a sale with stock <stock> and <sold> sold that opens <opens> and closes <closes>
    When a client asks for that sale
    Then the response status is 200
    And the sale status is "<status>"
    And <remaining> items remain

    Examples:
      | stock | sold | opens       | closes     | status   | remaining |
      | 10    | 3    | in 1 hour   | in 2 hours | upcoming | 7         |
      | 10    | 3    | 1 hour ago  | in 1 hour  | active   | 7         |
      | 10    | 3    | 2 hours ago | 1 hour ago | ended    | 7         |
      | 10    | 10   | 1 hour ago  | in 1 hour  | sold_out | 0         |

  Scenario: The current sale is the one that is running, even when a later sale is scheduled
    Given a sale named "Running" that opens 1 hour ago and closes in 1 hour
    And a sale named "Later" that opens in 2 hours and closes in 3 hours
    When a client asks for the current sale
    Then the response status is 200
    And the sale name is "Running"

  Scenario: With no running sale the current sale is the one that opens next
    Given a sale named "Later" that opens in 3 hours and closes in 4 hours
    And a sale named "Soon" that opens in 1 hour and closes in 2 hours
    When a client asks for the current sale
    Then the response status is 200
    And the sale name is "Soon"

  Scenario: A sale that is over is not the current sale, but it can still be read by its id
    Given a sale named "Over" that opens 3 hours ago and closes 2 hours ago
    When a client asks for the current sale
    Then the response status is 404
    And the error is "sale_not_found"
    And the sale named "Over" has the status "ended" when read by its id

  Scenario: There is no current sale before one is created
    Given no sale exists
    When a client asks for the current sale
    Then the response status is 404
    And the error is "sale_not_found"

  Scenario Outline: An unknown sale is refused
    Given no sale exists
    When a client asks for the sale with id "<id>"
    Then the response status is 404
    And the error is "sale_not_found"

    Examples:
      | id                                   |
      | 00000000-0000-4000-8000-000000000000 |
      | not-a-uuid                           |
