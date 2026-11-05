Feature: Transforming an Option

  As a developer
  I want an absent value to be tracked by the type and chained safely
  So that nothing reads through undefined by accident

  # Exemption(integration): a pure library opens no resource, so there is nothing to integrate with; alternative-proof: typekit:unit / FromOptional keeps a falsy value present
  # Exemption(e2e): a pure library has no process or page to drive from outside; alternative-proof: typekit:unit / FromOptional keeps a falsy value present
  @integration-exempt @e2e-exempt
  Scenario: FromOptional keeps a falsy value present
    Given the values 0, an empty string, false and undefined
    When each is turned into an Option
    Then the first three are present
    And undefined is absent

  # Exemption(integration): a pure library opens no resource, so there is nothing to integrate with; alternative-proof: typekit:unit / Some of undefined is present and holds undefined
  # Exemption(e2e): a pure library has no process or page to drive from outside; alternative-proof: typekit:unit / Some of undefined is present and holds undefined
  @integration-exempt @e2e-exempt
  Scenario: Some of undefined is present and holds undefined
    Given Some holding undefined
    When it is compared with absence
    Then it is present
    And its value is undefined

  # Exemption(integration): a pure library opens no resource, so there is nothing to integrate with; alternative-proof: typekit:unit / Option map changes a present value and leaves absence absent
  # Exemption(e2e): a pure library has no process or page to drive from outside; alternative-proof: typekit:unit / Option map changes a present value and leaves absence absent
  @integration-exempt @e2e-exempt
  Scenario: Option map changes a present value and leaves absence absent
    Given a present 2 and an absent value
    When both are mapped with a function that doubles
    Then the present value holds 4
    And absence stays absent

  # Exemption(integration): a pure library opens no resource, so there is nothing to integrate with; alternative-proof: typekit:unit / Option flatMap continues a present value with a step that may be absent
  # Exemption(e2e): a pure library has no process or page to drive from outside; alternative-proof: typekit:unit / Option flatMap continues a present value with a step that may be absent
  @integration-exempt @e2e-exempt
  Scenario: Option flatMap continues a present value with a step that may be absent
    Given a present 2 and an absent value
    When both continue with a step that is absent for odd numbers
    Then a step that answers presence gives a present value
    And a step that answers absence gives absence
    And absence is returned and the step does not run

  # Exemption(integration): a pure library opens no resource, so there is nothing to integrate with; alternative-proof: typekit:unit / Option tap shows a present value and returns the option unchanged
  # Exemption(e2e): a pure library has no process or page to drive from outside; alternative-proof: typekit:unit / Option tap shows a present value and returns the option unchanged
  @integration-exempt @e2e-exempt
  Scenario: Option tap shows a present value and returns the option unchanged
    Given a present 2 and an absent value
    When both are tapped with a recorder
    Then the recorder saw 2 only once
    And both options are returned unchanged

  # Exemption(integration): a pure library opens no resource, so there is nothing to integrate with; alternative-proof: typekit:unit / OkOr turns presence into Ok and absence into Err
  # Exemption(e2e): a pure library has no process or page to drive from outside; alternative-proof: typekit:unit / OkOr turns presence into Ok and absence into Err
  @integration-exempt @e2e-exempt
  Scenario: OkOr turns presence into Ok and absence into Err
    Given a present 2 and an absent value
    When both are turned into a Result with the fault "missing"
    Then the present value becomes an Ok holding 2
    And absence becomes an Err holding "missing"
