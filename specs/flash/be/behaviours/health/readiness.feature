Feature: Readiness of the flash-be API

  As an operations engineer
  I want to know whether the API can reach Postgres and Redis
  So that traffic goes only to instances that can serve it

  Scenario: Readiness is ok when Postgres and Redis answer
    When a client sends GET /ready
    Then the response status is 200
    And the readiness checks report database "ok" and redis "ok"

  Scenario: Readiness is unavailable when Postgres fails
    Given Postgres does not answer
    When a client sends GET /ready
    Then the response status is 503
    And the readiness checks report database "error" and redis "ok"

  Scenario: Readiness is unavailable when Redis fails
    Given Redis does not answer
    When a client sends GET /ready
    Then the response status is 503
    And the readiness checks report database "ok" and redis "error"

  Scenario: Readiness recovers after Redis drops the API's connection
    Given the API is running and Redis answers
    When Redis drops the API's connection
    And Redis reconnects
    And a client sends GET /ready
    Then the response status is 200
    And the readiness checks report database "ok" and redis "ok"
