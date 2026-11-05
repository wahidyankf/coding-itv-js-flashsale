Feature: Liveness of the flash-be API

  As an operations engineer
  I want a liveness check that does not depend on other services
  So that I can tell a running process from a dead one

  Scenario: Liveness reports ok without checking dependencies
    When a client sends GET /health
    Then the response status is 200
    And the body has status "ok"
