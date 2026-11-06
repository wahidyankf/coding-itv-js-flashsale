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

  Scenario: The current sale is the one that opens last
    Given a sale named "Earlier" that opened 2 hours ago
    And a sale named "Later" that opened 1 hour ago
    When a client asks for the current sale
    Then the response status is 200
    And the sale name is "Later"

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
