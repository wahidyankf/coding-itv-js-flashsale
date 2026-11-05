Feature: The outcome of a shopper

  As a shopper
  I want to ask whether I got an item
  So that I know where I stand after a refresh or a lost connection

  Scenario: A buyer sees the purchase
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has been admitted
    And "ana" has reserved an item
    And "ana" has confirmed the purchase
    When a client asks for the outcome of "ana"
    Then the response status is 200
    And the outcome state is "purchased"
    And the purchase is the one "ana" had before

  Scenario: A shopper who holds an item sees the hold
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has been admitted
    And "ana" has reserved an item
    When a client asks for the outcome of "ana"
    Then the outcome state is "holding"
    And the reservation is the one "ana" had before

  Scenario: A shopper with nothing sees none
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    When a client asks for the outcome of "ana"
    Then the outcome state is "none"

  Scenario: An expired hold is no longer shown
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And the hold time of the sale is 1 second
    And "ana" has been admitted
    And "ana" has reserved an item
    When 2 seconds pass
    And a client asks for the outcome of "ana"
    Then the outcome state is "none"

  Scenario: The outcome of an unknown sale is refused
    Given no sale exists
    When a client asks for the outcome of "ana" in the sale with id "00000000-0000-4000-8000-000000000000"
    Then the response status is 404
    And the error is "sale_not_found"

  Scenario: The outcome of a bad user id is refused
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    When a client asks for the outcome of "has space"
    Then the response status is 400
    And the error is "invalid_user"
