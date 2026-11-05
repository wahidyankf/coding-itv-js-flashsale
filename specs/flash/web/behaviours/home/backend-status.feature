Feature: Backend status on the home page

  As a shopper
  I want the home page to show whether the flash sale backend is reachable
  So that I know whether the site can serve me

  Scenario: Home shows the backend as ok when flash-be is live
    Given flash-be reports status "ok"
    When a visitor opens the home page
    Then the page heading is "Flash Sale"
    And the page says "Backend: ok"

  # Exemption(e2e): the e2e stack shares one flash-be and cannot make it unreachable without stopping other tests; alternative-proof: flash-web:integration / Home shows the backend as down when flash-be is unreachable
  @e2e-exempt
  Scenario: Home shows the backend as down when flash-be is unreachable
    Given flash-be cannot be reached
    When a visitor opens the home page
    Then the page says "Backend: down"

  # Exemption(e2e): the e2e stack shares one flash-be and cannot make it answer with an error without stopping other tests; alternative-proof: flash-web:integration / Home shows the backend as down when flash-be answers with an error
  @e2e-exempt
  Scenario: Home shows the backend as down when flash-be answers with an error
    Given flash-be answers /health with status 500
    When a visitor opens the home page
    Then the page says "Backend: down"

  # Exemption(e2e): the e2e stack shares one flash-be and cannot make it report another status without stopping other tests; alternative-proof: flash-web:integration / Home shows the backend as down when flash-be reports another status
  @e2e-exempt
  Scenario: Home shows the backend as down when flash-be reports another status
    Given flash-be reports status "starting"
    When a visitor opens the home page
    Then the page says "Backend: down"
