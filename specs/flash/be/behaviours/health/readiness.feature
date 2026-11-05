Feature: Readiness of the flash-be API

  As an operations engineer
  I want to know whether the API can reach Postgres and Redis
  So that traffic goes only to instances that can serve it

  Scenario: Readiness is ok when Postgres and Redis answer
    When a client sends GET /ready
    Then the response status is 200
    And the readiness checks report database "ok" and redis "ok"

  # Exemption(e2e): the e2e stack shares one Postgres and cannot fail it without stopping other tests; alternative-proof: flash-be:integration / Readiness is unavailable when Postgres fails
  @e2e-exempt
  Scenario: Readiness is unavailable when Postgres fails
    Given Postgres does not answer
    When a client sends GET /ready
    Then the response status is 503
    And the readiness checks report database "error" and redis "ok"

  # Exemption(e2e): the e2e stack shares one Redis and cannot fail it without stopping other tests; alternative-proof: flash-be:integration / Readiness is unavailable when Redis fails
  @e2e-exempt
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
