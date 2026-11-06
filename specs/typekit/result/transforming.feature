Feature: Transforming a Result

  As a developer
  I want to change and chain a Result without unpacking it
  So that a failure travels along the chain as a value and is handled once

  # Exemption(integration): a pure library opens no resource, so there is nothing to integrate with; alternative-proof: typekit:unit / Map changes the value of an Ok and leaves an Err alone
  # Exemption(e2e): a pure library has no process or page to drive from outside; alternative-proof: typekit:unit / Map changes the value of an Ok and leaves an Err alone
  @integration-exempt @e2e-exempt
  Scenario: Map changes the value of an Ok and leaves an Err alone
    Given an Ok holding 2 and an Err holding "bad"
    When both are mapped with a function that doubles
    Then the Ok holds 4
    And the Err still holds "bad"

  # Exemption(integration): a pure library opens no resource, so there is nothing to integrate with; alternative-proof: typekit:unit / MapErr changes the fault of an Err and leaves an Ok alone
  # Exemption(e2e): a pure library has no process or page to drive from outside; alternative-proof: typekit:unit / MapErr changes the fault of an Err and leaves an Ok alone
  @integration-exempt @e2e-exempt
  Scenario: MapErr changes the fault of an Err and leaves an Ok alone
    Given an Ok holding 2 and an Err holding "bad"
    When both are mapped on the fault with a function that upper-cases
    Then the Err holds "BAD"
    And the Ok still holds 2

  # Exemption(integration): a pure library opens no resource, so there is nothing to integrate with; alternative-proof: typekit:unit / A Result cannot be changed after it is built
  # Exemption(e2e): a pure library has no process or page to drive from outside; alternative-proof: typekit:unit / A Result cannot be changed after it is built
  @integration-exempt @e2e-exempt
  Scenario: A Result cannot be changed after it is built
    Given an Ok holding 2 and an Err holding "bad"
    When code tries to assign to a field of each
    Then each assignment throws
    And each stays as it was
