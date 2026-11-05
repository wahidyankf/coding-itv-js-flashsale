Feature: Sale read cache

  As an operator
  I want sale reads answered from a short cache
  So that many shoppers watching the sale do not each cost a database read

  Scenario: A sale read is answered from the cache for the cache time
    Given a sale with stock 10 and 3 sold that opens 1 hour ago and closes in 1 hour
    And the sale reads are cached for 2 seconds
    And a client has asked for that sale
    When the sold count changes to 4
    And a client asks for that sale again
    Then the reply shows 7 items remaining

  Scenario: A change shows once the cache time is over
    Given a sale with stock 10 and 3 sold that opens 1 hour ago and closes in 1 hour
    And the sale reads are cached for 2 seconds
    And a client has asked for that sale
    When the sold count changes to 4
    And 3 seconds pass
    And a client asks for that sale again
    Then the reply shows 6 items remaining

  Scenario: Without a cache time every read is fresh
    Given a sale with stock 10 and 3 sold that opens 1 hour ago and closes in 1 hour
    And the sale reads are not cached
    And a client has asked for that sale
    When the sold count changes to 4
    And a client asks for that sale again
    Then the reply shows 6 items remaining
    And no Cache-Control header is given

  Scenario: A cached reply tells clients how long they may keep it
    Given a sale with stock 10 and 3 sold that opens 1 hour ago and closes in 1 hour
    And the sale reads are cached for 2 seconds
    When a client asks for that sale
    Then the response status is 200
    And the Cache-Control header is "public, max-age=2"

  Scenario: A sale that is not found is not cached
    Given no sale exists
    And the sale reads are cached for 2 seconds
    And a client has asked for the current sale
    And a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    When a client asks for the current sale
    Then the response status is 200

  Scenario: Joining the queue does not read the cache
    Given a sale with stock 10 and 3 sold that opens 1 hour ago and closes in 1 hour
    And the sale reads are cached for 2 seconds
    And a client has asked for that sale
    And the sold count changes to 10
    When "ana" joins the queue
    Then the response status is 409
    And the error is "sold_out"
    When a client asks for that sale again
    Then the reply shows 7 items remaining
