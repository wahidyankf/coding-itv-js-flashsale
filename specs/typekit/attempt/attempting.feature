Feature: Turning a throwing call into a Result

  As a developer
  I want to catch only the failures I expect, in one place
  So that product code has no catch block and an unexpected bug is not hidden

  # Exemption(integration): a pure library opens no resource, so there is nothing to integrate with; alternative-proof: typekit:unit / Attempt returns Ok with the value of a call that does not throw
  # Exemption(e2e): a pure library has no process or page to drive from outside; alternative-proof: typekit:unit / Attempt returns Ok with the value of a call that does not throw
  @integration-exempt @e2e-exempt
  Scenario: Attempt returns Ok with the value of a call that does not throw
    Given a call that returns 7
    When it is attempted with the guard Error
    Then the result is an Ok holding 7

  # Exemption(integration): a pure library opens no resource, so there is nothing to integrate with; alternative-proof: typekit:unit / Attempt returns Err with an exception of a named type
  # Exemption(e2e): a pure library has no process or page to drive from outside; alternative-proof: typekit:unit / Attempt returns Err with an exception of a named type
  @integration-exempt @e2e-exempt
  Scenario: Attempt returns Err with an exception of a named type
    Given a call that throws a RangeError
    When it is attempted with the guard RangeError
    Then the result is an Err holding that same exception

  # Exemption(integration): a pure library opens no resource, so there is nothing to integrate with; alternative-proof: typekit:unit / Attempt lets an exception of another type through
  # Exemption(e2e): a pure library has no process or page to drive from outside; alternative-proof: typekit:unit / Attempt lets an exception of another type through
  @integration-exempt @e2e-exempt
  Scenario: Attempt lets an exception of another type through
    Given a call that throws a TypeError
    When it is attempted with the guard RangeError
    Then the same TypeError is thrown to the caller

  # Exemption(integration): a pure library opens no resource, so there is nothing to integrate with; alternative-proof: typekit:unit / Attempt accepts a type predicate as the guard
  # Exemption(e2e): a pure library has no process or page to drive from outside; alternative-proof: typekit:unit / Attempt accepts a type predicate as the guard
  @integration-exempt @e2e-exempt
  Scenario: Attempt accepts a type predicate as the guard
    Given a call that throws a plain string
    When it is attempted with a predicate that accepts strings
    Then the result is an Err holding that string

  # Exemption(integration): a pure library opens no resource, so there is nothing to integrate with; alternative-proof: typekit:unit / Attempt with no guard is a type error
  # Exemption(e2e): a pure library has no process or page to drive from outside; alternative-proof: typekit:unit / Attempt with no guard is a type error
  @integration-exempt @e2e-exempt
  Scenario: Attempt with no guard is a type error
    Given a call that may throw
    When it is attempted with no guard
    Then the type checker refuses the call
    And the call throws a TypeError at run time

  # Exemption(integration): a pure library opens no resource, so there is nothing to integrate with; alternative-proof: typekit:unit / AttemptAsync returns Ok with the value a promise resolves to
  # Exemption(e2e): a pure library has no process or page to drive from outside; alternative-proof: typekit:unit / AttemptAsync returns Ok with the value a promise resolves to
  @integration-exempt @e2e-exempt
  Scenario: AttemptAsync returns Ok with the value a promise resolves to
    Given a promise that resolves to 7
    When it is attempted with the guard Error
    Then the result is an Ok holding 7

  # Exemption(integration): a pure library opens no resource, so there is nothing to integrate with; alternative-proof: typekit:unit / AttemptAsync returns Err with a rejection of a named type
  # Exemption(e2e): a pure library has no process or page to drive from outside; alternative-proof: typekit:unit / AttemptAsync returns Err with a rejection of a named type
  @integration-exempt @e2e-exempt
  Scenario: AttemptAsync returns Err with a rejection of a named type
    Given a promise that rejects with a RangeError
    When it is attempted with the guard RangeError
    Then the result is an Err holding that same exception

  # Exemption(integration): a pure library opens no resource, so there is nothing to integrate with; alternative-proof: typekit:unit / AttemptAsync lets a rejection of another type through
  # Exemption(e2e): a pure library has no process or page to drive from outside; alternative-proof: typekit:unit / AttemptAsync lets a rejection of another type through
  @integration-exempt @e2e-exempt
  Scenario: AttemptAsync lets a rejection of another type through
    Given a promise that rejects with a TypeError
    When it is attempted with the guard RangeError
    Then the same TypeError is rejected to the caller

  # Exemption(integration): a pure library opens no resource, so there is nothing to integrate with; alternative-proof: typekit:unit / AttemptAsync catches a call that throws before it returns a promise
  # Exemption(e2e): a pure library has no process or page to drive from outside; alternative-proof: typekit:unit / AttemptAsync catches a call that throws before it returns a promise
  @integration-exempt @e2e-exempt
  Scenario: AttemptAsync catches a call that throws before it returns a promise
    Given a function that throws a RangeError at once
    When it is attempted with the guard RangeError
    Then the result is an Err holding that same exception
