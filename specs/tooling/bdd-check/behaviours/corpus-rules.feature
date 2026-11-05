Feature: Behaviour check rules

  The behaviour check reads the Gherkin corpus and its bindings, then fails on any gap.
  These scenarios pin the rules it enforces. Most rules run on small fixture corpora,
  so those scenarios need no browser, server or database.

  # Exemption(integration): a pure rule over fixture text, with no database or process; alternative-proof: tooling:unit / A corpus bound at every layer passes
  # Exemption(e2e): a pure rule over fixture text, with no browser or server; alternative-proof: tooling:unit / A corpus bound at every layer passes
  @integration-exempt @e2e-exempt
  Scenario: A corpus bound at every layer passes
    Given the corpus binds every scenario at every layer
    When the behaviour check runs
    Then the check reports no failures
    And one behaviour of one is covered

  # Exemption(integration): a pure rule over fixture text, with no database or process; alternative-proof: tooling:unit / A scenario with no unit binding fails
  # Exemption(e2e): a pure rule over fixture text, with no browser or server; alternative-proof: tooling:unit / A scenario with no unit binding fails
  @integration-exempt @e2e-exempt
  Scenario: A scenario with no unit binding fails
    Given the unit binding file is missing
    When the behaviour check runs
    Then the failures name the missing unit binding for Liveness returns ok

  # Exemption(integration): a pure rule over fixture text, with no database or process; alternative-proof: tooling:unit / A scenario with no integration binding fails when it is not exempt
  # Exemption(e2e): a pure rule over fixture text, with no browser or server; alternative-proof: tooling:unit / A scenario with no integration binding fails when it is not exempt
  @integration-exempt @e2e-exempt
  Scenario: A scenario with no integration binding fails when it is not exempt
    Given the integration binding file is missing
    When the behaviour check runs
    Then the failures name the missing integration binding for Liveness returns ok

  # Exemption(integration): a pure rule over fixture text, with no database or process; alternative-proof: tooling:unit / A binding whose title matches no scenario fails
  # Exemption(e2e): a pure rule over fixture text, with no browser or server; alternative-proof: tooling:unit / A binding whose title matches no scenario fails
  @integration-exempt @e2e-exempt
  Scenario: A binding whose title matches no scenario fails
    Given the unit binding file also binds a scenario named Ghost
    When the behaviour check runs
    Then the failures name the unused unit binding Ghost

  # Exemption(integration): a pure rule over fixture text, with no database or process; alternative-proof: tooling:unit / A dynamic scenario title fails because the checker cannot read it
  # Exemption(e2e): a pure rule over fixture text, with no browser or server; alternative-proof: tooling:unit / A dynamic scenario title fails because the checker cannot read it
  @integration-exempt @e2e-exempt
  Scenario: A dynamic scenario title fails because the checker cannot read it
    Given the unit binding file uses a template title with a placeholder
    When the behaviour check runs
    Then the failures name a dynamic scenario title

  # Exemption(integration): a pure rule over fixture text, with no database or process; alternative-proof: tooling:unit / A step with no e2e step definition fails
  # Exemption(e2e): a pure rule over fixture text, with no browser or server; alternative-proof: tooling:unit / A step with no e2e step definition fails
  @integration-exempt @e2e-exempt
  Scenario: A step with no e2e step definition fails
    Given the e2e steps have no definition for the step a client asks for liveness
    When the behaviour check runs
    Then the failures name the step that has no e2e definition

  # Exemption(integration): a pure rule over fixture text, with no database or process; alternative-proof: tooling:unit / A plain-text e2e step matches its text exactly
  # Exemption(e2e): a pure rule over fixture text, with no browser or server; alternative-proof: tooling:unit / A plain-text e2e step matches its text exactly
  @integration-exempt @e2e-exempt
  Scenario: A plain-text e2e step matches its text exactly
    Given the e2e steps define each step as plain text
    When the behaviour check runs
    Then the failures do not name a missing e2e step

  # Exemption(integration): a pure rule over fixture text, with no database or process; alternative-proof: tooling:unit / An e2e step that no scenario uses fails
  # Exemption(e2e): a pure rule over fixture text, with no browser or server; alternative-proof: tooling:unit / An e2e step that no scenario uses fails
  @integration-exempt @e2e-exempt
  Scenario: An e2e step that no scenario uses fails
    Given the e2e steps define an extra step that no scenario uses
    When the behaviour check runs
    Then the failures name an unused e2e step

  # Exemption(integration): a pure rule over fixture text, with no database or process; alternative-proof: tooling:unit / A feature that its README does not link fails
  # Exemption(e2e): a pure rule over fixture text, with no browser or server; alternative-proof: tooling:unit / A feature that its README does not link fails
  @integration-exempt @e2e-exempt
  Scenario: A feature that its README does not link fails
    Given the folder README does not link the feature
    When the behaviour check runs
    Then the failures name the feature that its README does not link

  # Exemption(integration): a pure rule over fixture text, with no database or process; alternative-proof: tooling:unit / An exemption with a valid comment and alternative proof passes
  # Exemption(e2e): a pure rule over fixture text, with no browser or server; alternative-proof: tooling:unit / An exemption with a valid comment and alternative proof passes
  @integration-exempt @e2e-exempt
  Scenario: An exemption with a valid comment and alternative proof passes
    Given the scenario is e2e-exempt with a valid comment and alternative proof
    And the e2e steps are absent
    When the behaviour check runs
    Then the failures are empty
    And one behaviour of one is covered

  # Exemption(integration): a pure rule over fixture text, with no database or process; alternative-proof: tooling:unit / An exempt scenario with no exemption comment fails
  # Exemption(e2e): a pure rule over fixture text, with no browser or server; alternative-proof: tooling:unit / An exempt scenario with no exemption comment fails
  @integration-exempt @e2e-exempt
  Scenario: An exempt scenario with no exemption comment fails
    Given the scenario is e2e-exempt without an exemption comment
    And the e2e steps are absent
    When the behaviour check runs
    Then the failures name the missing e2e exemption comment

  # Exemption(integration): a pure rule over fixture text, with no database or process; alternative-proof: tooling:unit / An exemption comment above a Background fails
  # Exemption(e2e): a pure rule over fixture text, with no browser or server; alternative-proof: tooling:unit / An exemption comment above a Background fails
  @integration-exempt @e2e-exempt
  Scenario: An exemption comment above a Background fails
    Given an exemption comment sits above a Background
    When the behaviour check runs
    Then the failures name an exemption comment that is not above a scenario

  # Exemption(integration): a pure rule over fixture text, with no database or process; alternative-proof: tooling:unit / An exemption comment with no alternative proof fails
  # Exemption(e2e): a pure rule over fixture text, with no browser or server; alternative-proof: tooling:unit / An exemption comment with no alternative proof fails
  @integration-exempt @e2e-exempt
  Scenario: An exemption comment with no alternative proof fails
    Given the exemption comment has no alternative proof
    And the e2e steps are absent
    When the behaviour check runs
    Then the failures name a malformed exemption comment

  # Exemption(integration): a pure rule over fixture text, with no database or process; alternative-proof: tooling:unit / An alternative proof that names a missing scenario fails
  # Exemption(e2e): a pure rule over fixture text, with no browser or server; alternative-proof: tooling:unit / An alternative proof that names a missing scenario fails
  @integration-exempt @e2e-exempt
  Scenario: An alternative proof that names a missing scenario fails
    Given the alternative proof names a scenario named Ghost
    And the e2e steps are absent
    When the behaviour check runs
    Then the failures name an alternative proof whose scenario is not found

  # Exemption(integration): a pure rule over fixture text, with no database or process; alternative-proof: tooling:unit / An exemption tag on the Feature fails
  # Exemption(e2e): a pure rule over fixture text, with no browser or server; alternative-proof: tooling:unit / An exemption tag on the Feature fails
  @integration-exempt @e2e-exempt
  Scenario: An exemption tag on the Feature fails
    Given the exemption tag sits on the Feature
    When the behaviour check runs
    Then the failures name an exemption tag on the Feature

  # Exemption(integration): a pure rule over fixture text, with no database or process; alternative-proof: tooling:unit / An unknown exemption tag fails
  # Exemption(e2e): a pure rule over fixture text, with no browser or server; alternative-proof: tooling:unit / An unknown exemption tag fails
  @integration-exempt @e2e-exempt
  Scenario: An unknown exemption tag fails
    Given the scenario carries the unknown tag unit-exempt
    When the behaviour check runs
    Then the failures name an unknown exemption tag

  # Exemption(integration): a pure rule over fixture text, with no database or process; alternative-proof: tooling:unit / An integration-exempt scenario with an integration binding fails
  # Exemption(e2e): a pure rule over fixture text, with no browser or server; alternative-proof: tooling:unit / An integration-exempt scenario with an integration binding fails
  @integration-exempt @e2e-exempt
  Scenario: An integration-exempt scenario with an integration binding fails
    Given the scenario is integration-exempt and still has an integration binding
    When the behaviour check runs
    Then the failures name an integration exemption with an integration binding

  # Exemption(integration): a pure rule over fixture text, with no database or process; alternative-proof: tooling:unit / An outline counts each Examples row as one behaviour
  # Exemption(e2e): a pure rule over fixture text, with no browser or server; alternative-proof: tooling:unit / An outline counts each Examples row as one behaviour
  @integration-exempt @e2e-exempt
  Scenario: An outline counts each Examples row as one behaviour
    Given the corpus has an outline with two Examples rows, bound at every layer
    When the behaviour check runs
    Then the failures are empty
    And two behaviours are counted
    And both behaviours are covered

  # Exemption(e2e): the command runs in a shell with no browser or server; alternative-proof: tooling:integration / The check passes on the real repository
  @e2e-exempt
  Scenario: The check passes on the real repository
    Given the repository's own corpus
    When the behaviour check runs
    Then the check reports no failures
    And every behaviour is covered
