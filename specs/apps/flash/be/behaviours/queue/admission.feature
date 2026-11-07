Feature: Admission from the queue

  As a shopper
  I want the queue to let me in when it is my turn
  So that the sale is not flooded and the order is fair

  Scenario: The queue admits shoppers in order at the sale's rate
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And the sale admits 2 users per second
    And "ana", "ben" and "cai" have joined the queue in that order
    When admission runs once
    Then "ana" is admitted
    And "ben" is admitted
    And "cai" is waiting at place 1

  Scenario: Nobody is admitted before the sale opens
    Given a sale with stock 10 and 0 sold that opens in 1 hour and closes in 2 hours
    And "ana" has joined the queue
    When admission runs once
    Then "ana" is waiting at place 1

  Scenario: The queue of the running sale is admitted while a later sale is scheduled
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And a later sale that opens in 2 hours and closes in 3 hours
    And "ana" has joined the queue
    When admission runs once
    Then "ana" is admitted

  Scenario: A shopper reads their place with their ticket
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has joined the queue
    And "ben" has joined the queue
    When "ben" checks the queue with their ticket
    Then the response status is 200
    And the place in line is 2

  Scenario: A wrong ticket is refused
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has joined the queue
    When "ana" checks the queue with a wrong ticket
    Then the response status is 401
    And the error is "invalid_ticket"

  Scenario: A shopper whose place was lost is told to join again
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has joined the queue
    And the queue is lost
    When "ana" checks the queue with their ticket
    Then the response status is 404
    And the error is "not_in_queue"
