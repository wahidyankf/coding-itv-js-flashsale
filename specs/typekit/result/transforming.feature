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

  # Exemption(integration): a pure library opens no resource, so there is nothing to integrate with; alternative-proof: typekit:unit / FlatMap continues an Ok with a step that may fail
  # Exemption(e2e): a pure library has no process or page to drive from outside; alternative-proof: typekit:unit / FlatMap continues an Ok with a step that may fail
  @integration-exempt @e2e-exempt
  Scenario: FlatMap continues an Ok with a step that may fail
    Given an Ok holding 2, an Ok holding 3 and an Err holding "bad"
    When each continues with a step that fails for odd numbers
    Then the Ok holding 2 stays an Ok
    And the Ok holding 3 becomes an Err
    And the Err is returned and the step does not run

  # Exemption(integration): a pure library opens no resource, so there is nothing to integrate with; alternative-proof: typekit:unit / FlatMapErr recovers an Err with a step that may fail
  # Exemption(e2e): a pure library has no process or page to drive from outside; alternative-proof: typekit:unit / FlatMapErr recovers an Err with a step that may fail
  @integration-exempt @e2e-exempt
  Scenario: FlatMapErr recovers an Err with a step that may fail
    Given an Ok holding 2 and an Err holding "bad"
    When both are recovered with a step that turns the fault into a value
    Then the Err becomes an Ok holding 3
    And the Ok is returned and the step does not run

  # Exemption(integration): a pure library opens no resource, so there is nothing to integrate with; alternative-proof: typekit:unit / Tap shows the value of an Ok and returns the result unchanged
  # Exemption(e2e): a pure library has no process or page to drive from outside; alternative-proof: typekit:unit / Tap shows the value of an Ok and returns the result unchanged
  @integration-exempt @e2e-exempt
  Scenario: Tap shows the value of an Ok and returns the result unchanged
    Given an Ok holding 2 and an Err holding "bad"
    When both are tapped with a recorder
    Then the recorder saw 2 only once
    And both results are returned unchanged

  # Exemption(integration): a pure library opens no resource, so there is nothing to integrate with; alternative-proof: typekit:unit / TapErr shows the fault of an Err and returns the result unchanged
  # Exemption(e2e): a pure library has no process or page to drive from outside; alternative-proof: typekit:unit / TapErr shows the fault of an Err and returns the result unchanged
  @integration-exempt @e2e-exempt
  Scenario: TapErr shows the fault of an Err and returns the result unchanged
    Given an Ok holding 2 and an Err holding "bad"
    When both are tapped on the fault with a recorder
    Then the recorder saw "bad" only once
    And both results are returned unchanged

  # Exemption(integration): a pure library opens no resource, so there is nothing to integrate with; alternative-proof: typekit:unit / A Result cannot be changed after it is built
  # Exemption(e2e): a pure library has no process or page to drive from outside; alternative-proof: typekit:unit / A Result cannot be changed after it is built
  @integration-exempt @e2e-exempt
  Scenario: A Result cannot be changed after it is built
    Given an Ok holding 2 and an Err holding "bad"
    When code tries to assign to a field of each
    Then each assignment throws
    And each stays as it was
