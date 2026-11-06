Feature: Rebuilding the reservation state

  As an operator
  I want Redis to be rebuilt from Postgres when it loses its state
  So that a restart never gives away an item that someone holds

  Scenario: Live holds survive the loss of Redis state
    Given a sale with stock 1 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has been admitted
    And "ben" has been admitted
    And "ana" has reserved an item
    And the reservation state of the sale is lost from Redis
    When "ben" reserves an item
    Then the response status is 409
    And the error is "sold_out"

  Scenario: The holder gets the same hold after the loss
    Given a sale with stock 1 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has been admitted
    And "ana" has reserved an item
    And the reservation state of the sale is lost from Redis
    When "ana" reserves an item
    Then the response status is 200
    And the reservation is the one "ana" had before

  Scenario: Expired holds are not rebuilt
    Given a sale with stock 1 and 0 sold that opens 1 hour ago and closes in 1 hour
    And the hold time of the sale is 1 second
    And "ana" has been admitted
    And "ben" has been admitted
    And "ana" has reserved an item
    And the reservation state of the sale is lost from Redis
    When 2 seconds pass
    And "ben" reserves an item
    Then the response status is 201
