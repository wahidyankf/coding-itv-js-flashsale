Feature: Serving while Redis is down

  As a shopper
  I want to keep buying while Redis is down
  So that a lost cache never stops the sale, and never sells an item twice

  Scenario: A shopper joining the queue gets a ticket and is admitted at once
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And Redis is down
    When "ana" joins the queue
    Then the response status is 200
    And a ticket is issued
    And "ana" is admitted

  Scenario: A shopper reserves an item
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And Redis is down
    And "ana" has joined the queue
    When "ana" reserves an item
    Then the response status is 201
    And a reservation id is issued
    And the hold ends in 120 seconds

  Scenario: Reserving again without Redis returns the same hold
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And Redis is down
    And "ana" has joined the queue
    And "ana" has reserved an item
    When "ana" reserves an item
    Then the response status is 200
    And the reservation is the one "ana" had before

  Scenario: Reserving again without Redis after the hold expired keeps the old hold as a row marked deleted
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And the hold time of the sale is 1 second
    And Redis is down
    And "ana" has joined the queue
    And "ana" has reserved an item
    When 2 seconds pass
    And "ana" reserves an item
    Then the response status is 201
    And the reservation is a new one, not the one "ana" had before
    And the hold "ana" had before is kept as a row marked deleted by "ana"
    And "ana" has one hold that counts, the new one

  Scenario: Many shoppers reserving at once without Redis never hold more than the stock
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And Redis is down
    And 30 shoppers have been admitted
    When all 30 shoppers reserve an item at the same time
    Then 10 reservations are granted
    And 20 shoppers are told the item is sold out

  Scenario: A shopper pays for a hold taken before Redis went down
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has been admitted
    And "ana" has reserved an item
    And Redis is down
    When "ana" confirms the purchase
    Then the response status is 201
    And a purchase id is issued
    And 9 items remain

  Scenario: Paying while Redis is down is not slowed down
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has been admitted
    And "ben" has been admitted
    And "cai" has been admitted
    And "ana" has reserved an item
    And "ben" has reserved an item
    And "cai" has reserved an item
    And Redis is down
    And 4 seconds pass
    When "ana" confirms the purchase
    And "ben" confirms the purchase
    And "cai" confirms the purchase
    Then every confirmation answered in less than 500 milliseconds

  Scenario: Requests are still limited
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And the limit is 3 requests per user in each 60 seconds
    And Redis is down
    When "ana" tries to join the queue 4 times
    Then the first 3 requests are not limited
    And the response status is 429

  Scenario: A hold taken while Redis was down is counted when it comes back with its old data
    Given a sale with stock 2 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has been admitted
    And "ben" has been admitted
    And "cai" has been admitted
    And "ana" has reserved an item
    And Redis is down
    And "ben" has reserved an item
    And Redis is back with the data it had
    When "cai" reserves an item
    Then the response status is 409
    And the error is "sold_out"

  Scenario: A hold taken while Redis was down survives when it comes back with no data
    Given a sale with stock 2 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has been admitted
    And "ana" has reserved an item
    And Redis is down
    And "ben" has joined the queue
    And "ben" has reserved an item
    And Redis is back with no data
    And "cai" has been admitted
    When "cai" reserves an item
    Then the response status is 409
    And the error is "sold_out"
