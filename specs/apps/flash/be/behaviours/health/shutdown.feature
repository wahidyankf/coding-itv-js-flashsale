Feature: Shutdown of the flash-be API

  As an operations engineer
  I want the API to stop cleanly when it is asked to
  So that a release or a scale-down loses no request, and no balancer sends work to an instance that is going away

  Scenario: Readiness answers 503 once the API is asked to stop
    Given the API keeps answering for 1 second after it is asked to stop
    When the API is asked to stop
    And a client sends GET /ready
    Then the response status is 503
    And the readiness status is "stopping"
    And the readiness checks report database "ok" and redis "ok"

  Scenario: A request in flight when the API is asked to stop still gets its answer
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And the API keeps answering for 1 second after it is asked to stop
    And the payment provider takes 2 seconds
    And "ana" has been admitted
    And "ana" has reserved an item
    When "ana" starts to confirm the purchase
    And the API is asked to stop
    And the confirmation finishes
    Then the response status is 201
    And a purchase id is issued

  Scenario: Open event streams are ended when the API stops
    Given a sale with stock 10 and 3 sold that opens 1 hour ago and closes in 1 hour
    And the API keeps answering for 1 second after it is asked to stop
    And a client is watching the sale
    When the API is asked to stop
    Then the event stream ends

  Scenario: The API exits once its work is done
    Given the API is running
    When the API is asked to stop
    Then the API exits with code 0 within 10 seconds
