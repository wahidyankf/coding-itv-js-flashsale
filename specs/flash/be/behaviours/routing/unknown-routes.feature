Feature: Unknown routes on the API

  As a client
  I want a path the API does not serve to get a clear "not found" answer
  So that a typo does not look like a working endpoint

  Scenario: Unknown routes return 404
    When a client sends GET /nope
    Then the response status is 404
