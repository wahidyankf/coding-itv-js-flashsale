Feature: Matching exhaustively

  As a developer
  I want a forgotten case to fail the build
  So that a new error or a new state cannot slip through unhandled

  # Exemption(integration): a pure library opens no resource, so there is nothing to integrate with; alternative-proof: typekit:unit / Match on a Result runs the handler of its side
  # Exemption(e2e): a pure library has no process or page to drive from outside; alternative-proof: typekit:unit / Match on a Result runs the handler of its side
  @integration-exempt @e2e-exempt
  Scenario: Match on a Result runs the handler of its side
    Given an Ok holding 2 and an Err holding "bad"
    When each is matched with a handler per side
    Then the Ok runs the ok handler with 2
    And the Err runs the err handler with "bad"

  # Exemption(integration): a pure library opens no resource, so there is nothing to integrate with; alternative-proof: typekit:unit / A match without a handler for a side is a type error
  # Exemption(e2e): a pure library has no process or page to drive from outside; alternative-proof: typekit:unit / A match without a handler for a side is a type error
  @integration-exempt @e2e-exempt
  Scenario: A match without a handler for a side is a type error
    Given a Result
    When each is matched without one of its handlers
    Then the type checker refuses the call
