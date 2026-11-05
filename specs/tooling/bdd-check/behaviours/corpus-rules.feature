Feature: Behaviour check rules

  The behaviour check reads the Gherkin corpus and its bindings, then fails on any gap.
  Each defect in the outline is one behaviour. Every scenario here is bound at unit by
  calling the checker, at integration by running the command on a temporary corpus, and
  at e2e by running the checker the way the repository ships it.

  Scenario Outline: The check rejects a corpus with <defect>
    Given the corpus has the defect <defect>
    When the behaviour check runs
    Then the check reports failures
    And the failures name <problem>

    Examples:
      | defect                            | problem                                              |
      | unit binding missing              | Liveness returns ok: no unit binding                 |
      | integration binding missing       | Liveness returns ok: no integration binding          |
      | unused binding                    | unused unit binding: Ghost                           |
      | template title                    | dynamic scenario title                               |
      | e2e step missing                  | no e2e step matches "a client asks for liveness"     |
      | e2e step unused                   | unused e2e step                                      |
      | README link missing               | liveness.feature: not linked from README.md          |
      | exemption comment missing         | Liveness returns ok: missing Exemption(e2e) comment  |
      | comment above a Background        | not directly above a scenario's tags                 |
      | comment without proof             | malformed exemption comment                          |
      | proof names a missing scenario    | alternative-proof scenario not found: Ghost          |
      | exemption tag on the Feature      | exemption tag on Feature                             |
      | unknown exemption tag             | unknown exemption tag @unit-exempt                   |
      | integration exemption still bound | bound at integration although @integration-exempt    |

  Scenario: A corpus bound at every layer passes
    Given the corpus binds every scenario at every layer
    When the behaviour check runs
    Then the check reports no failures
    And one behaviour of one is covered

  Scenario: A plain-text e2e step matches its text exactly
    Given the e2e steps define each step as plain text
    When the behaviour check runs
    Then the failures do not name a missing e2e step

  Scenario: An exemption with a valid comment and alternative proof passes
    Given the scenario is e2e-exempt with a valid comment and alternative proof
    And the e2e steps are absent
    When the behaviour check runs
    Then the failures are empty
    And one behaviour of one is covered

  Scenario: An outline counts each Examples row as one behaviour
    Given the corpus has an outline with two Examples rows, bound at every layer
    When the behaviour check runs
    Then the failures are empty
    And two behaviours are counted
    And both behaviours are covered

  Scenario: The check passes on the real repository
    Given the repository's own corpus
    When the behaviour check runs
    Then the check reports no failures
    And every behaviour is covered
