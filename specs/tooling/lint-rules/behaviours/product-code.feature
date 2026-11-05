Feature: Lint rules for product code

  As a maintainer
  I want the linter to refuse a catch clause and an incomplete switch in product code
  So that a failure is a value the caller handles and a new case cannot be forgotten

  # Exemption(integration): the rule is checked by running the real linter on sample code, and there is no service to integrate with; alternative-proof: lint-rules:unit / A catch clause in product code is an error
  # Exemption(e2e): the linter runs from a terminal and has no page or process to drive from outside; alternative-proof: lint-rules:unit / A catch clause in product code is an error
  @integration-exempt @e2e-exempt
  Scenario: A catch clause in product code is an error
    Given product code with a try block and a catch clause
    When the linter runs on it
    Then the run fails
    And the message tells the author to return a Result with attempt

  # Exemption(integration): the rule is checked by running the real linter on sample code, and there is no service to integrate with; alternative-proof: lint-rules:unit / A promise catch call in product code is an error
  # Exemption(e2e): the linter runs from a terminal and has no page or process to drive from outside; alternative-proof: lint-rules:unit / A promise catch call in product code is an error
  @integration-exempt @e2e-exempt
  Scenario: A promise catch call in product code is an error
    Given product code that calls .catch on a promise
    When the linter runs on it
    Then the run fails
    And the message tells the author to use attemptAsync

  # Exemption(integration): the rule is checked by running the real linter on sample code, and there is no service to integrate with; alternative-proof: lint-rules:unit / A try block with finally and no catch is allowed
  # Exemption(e2e): the linter runs from a terminal and has no page or process to drive from outside; alternative-proof: lint-rules:unit / A try block with finally and no catch is allowed
  @integration-exempt @e2e-exempt
  Scenario: A try block with finally and no catch is allowed
    Given product code with a try block and a finally clause only
    When the linter runs on it
    Then the run passes

  # Exemption(integration): the rule is checked by running the real linter on sample code, and there is no service to integrate with; alternative-proof: lint-rules:unit / A switch that forgets a case of a union is an error
  # Exemption(e2e): the linter runs from a terminal and has no page or process to drive from outside; alternative-proof: lint-rules:unit / A switch that forgets a case of a union is an error
  @integration-exempt @e2e-exempt
  Scenario: A switch that forgets a case of a union is an error
    Given product code with a switch over a union that handles two of three cases
    When the linter runs on it
    Then the run fails
    And the message says the switch is not exhaustive

  # Exemption(integration): the rule is checked by running the real linter on sample code, and there is no service to integrate with; alternative-proof: lint-rules:unit / A switch that handles every case of a union is allowed
  # Exemption(e2e): the linter runs from a terminal and has no page or process to drive from outside; alternative-proof: lint-rules:unit / A switch that handles every case of a union is allowed
  @integration-exempt @e2e-exempt
  Scenario: A switch that handles every case of a union is allowed
    Given product code with a switch over a union that handles all three cases
    When the linter runs on it
    Then the run passes
