Feature: Rate limiting

  As an operator
  I want each user and each address limited to a number of write requests per window
  So that one client cannot flood the queue, the gate or the payment

  Scenario Outline: Every write route is limited per user
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And the limit is 3 requests per user in each 60 seconds
    When "ana" tries to <request> 4 times
    Then the first 3 requests are not limited
    And the response status is 429
    And the error is "rate_limited"
    And a Retry-After header of at least 1 second is given

    Examples:
      | request            |
      | join the queue     |
      | reserve an item    |
      | confirm a purchase |

  Scenario: Another user is not affected
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And the limit is 3 requests per user in each 60 seconds
    And "ana" has tried to join the queue 4 times
    When "ben" joins the queue
    Then the response status is 201

  Scenario: A single address is limited across users
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And the limit is 3 requests per address in each 60 seconds
    When 10 different shoppers join the queue from one address
    Then 3 requests are accepted
    And 7 requests are limited

  Scenario: The count starts again in the next window
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And the limit is 3 requests per user in each 2 seconds
    And "ana" has tried to join the queue 4 times
    When 2 seconds pass
    And "ana" joins the queue
    Then the response status is 200
