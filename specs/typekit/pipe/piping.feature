Feature: Chaining with pipe

  As a developer
  I want to write a chain in the order it runs
  So that each stage reads from the one before it

  # Exemption(integration): a pure library opens no resource, so there is nothing to integrate with; alternative-proof: typekit:unit / Pipe applies each function to the result of the one before
  # Exemption(e2e): a pure library has no process or page to drive from outside; alternative-proof: typekit:unit / Pipe applies each function to the result of the one before
  @integration-exempt @e2e-exempt
  Scenario: Pipe applies each function to the result of the one before
    Given the value 3 and the functions add one, double and stringify
    When they are piped
    Then the result is "8"
    And each function ran once in order

  # Exemption(integration): a pure library opens no resource, so there is nothing to integrate with; alternative-proof: typekit:unit / Pipe chains a Result through the curried combinators
  # Exemption(e2e): a pure library has no process or page to drive from outside; alternative-proof: typekit:unit / Pipe chains a Result through the curried combinators
  @integration-exempt @e2e-exempt
  Scenario: Pipe chains a Result through the curried combinators
    Given a Result parsed from text
    When it is piped through result.map and result.flatMap
    Then a good text gives an Ok
    And a bad text gives an Err and the later stages do not run

  # Exemption(integration): a pure library opens no resource, so there is nothing to integrate with; alternative-proof: typekit:unit / Pipe chains an Option through the curried combinators
  # Exemption(e2e): a pure library has no process or page to drive from outside; alternative-proof: typekit:unit / Pipe chains an Option through the curried combinators
  @integration-exempt @e2e-exempt
  Scenario: Pipe chains an Option through the curried combinators
    Given an Option read from a lookup
    When it is piped through option.map and option.okOr
    Then a found key gives an Ok
    And a missing key gives an Err and the later stages do not run

  # Exemption(integration): a pure library opens no resource, so there is nothing to integrate with; alternative-proof: typekit:unit / Pipe stops at the first function that throws
  # Exemption(e2e): a pure library has no process or page to drive from outside; alternative-proof: typekit:unit / Pipe stops at the first function that throws
  @integration-exempt @e2e-exempt
  Scenario: Pipe stops at the first function that throws
    Given three functions where the second throws
    When they are piped
    Then the exception reaches the caller
    And the third function never ran

  # Exemption(integration): a pure library opens no resource, so there is nothing to integrate with; alternative-proof: typekit:unit / Pipe refuses a mismatched stage
  # Exemption(e2e): a pure library has no process or page to drive from outside; alternative-proof: typekit:unit / Pipe refuses a mismatched stage
  @integration-exempt @e2e-exempt
  Scenario: Pipe refuses a mismatched stage
    Given a stage that expects a number after a stage that returns a string
    When they are piped
    Then the type checker refuses the call

  # Exemption(integration): a pure library opens no resource, so there is nothing to integrate with; alternative-proof: typekit:unit / Pipe nests to chain more than nine stages
  # Exemption(e2e): a pure library has no process or page to drive from outside; alternative-proof: typekit:unit / Pipe nests to chain more than nine stages
  @integration-exempt @e2e-exempt
  Scenario: Pipe nests to chain more than nine stages
    Given ten functions that each add one
    When the first nine are piped and the result is piped through the tenth
    Then the result is 10 and its type is a number
