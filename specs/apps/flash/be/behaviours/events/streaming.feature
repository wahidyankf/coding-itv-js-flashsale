Feature: Live updates

  As a shopper
  I want the page to hear about the sale and my place as they change
  So that I do not have to keep asking

  Scenario: A client watching the sale gets its status at once
    Given a sale with stock 10 and 3 sold that opens 1 hour ago and closes in 1 hour
    When a client watches the sale
    Then the first event is "sale" with status "active" and 7 items remaining

  Scenario: A change in the sale is pushed to the client
    Given a sale with stock 10 and 3 sold that opens 1 hour ago and closes in 1 hour
    And a client is watching the sale
    When the sold count changes to 10
    Then the next event is "sale" with status "sold_out" and 0 items remaining

  Scenario: Watching an unknown sale is refused
    Given no sale exists
    When a client watches the sale with id "00000000-0000-4000-8000-000000000000"
    Then the response status is 404
    And the error is "sale_not_found"

  Scenario: A waiting shopper hears when they are admitted
    Given a sale with stock 10 and 0 sold that opens in 1 hour and closes in 2 hours
    And "ana" has joined the queue
    And "ana" is watching her place
    When the sale opens
    Then the next event is "place" with the state "admitted"

  Scenario: A shopper watching their place sees it first
    Given a sale with stock 10 and 0 sold that opens in 1 hour and closes in 2 hours
    And "ana" has joined the queue
    When "ana" watches her place
    Then the first event is "place" with the state "waiting" at place 1

  Scenario: Watching a place with a wrong ticket is refused
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has joined the queue
    When "ana" watches her place with a wrong ticket
    Then the response status is 401
    And the error is "invalid_ticket"

  Scenario: Watching a place in an unknown sale is refused
    Given no sale exists
    When "ana" watches her place in the sale with id "00000000-0000-4000-8000-000000000000"
    Then the response status is 404
    And the error is "sale_not_found"

  Scenario: A shopper whose place was lost before watching is told it is gone
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has joined the queue
    And the queue is lost
    When "ana" watches her place
    Then the first event is "place" with the state "absent"
