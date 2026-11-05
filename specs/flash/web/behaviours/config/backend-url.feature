Feature: Backend address of the flash-web app

  As an operator
  I want flash-web to find flash-be from its environment
  So that the same build runs locally and in containers

  # Exemption(integration): the rule is a pure function of an environment object and opens no resource; alternative-proof: flash-web:unit / Backend URL defaults to the local flash-be port
  # Exemption(e2e): the rule is decided inside the server before any page is served, so no page can show it; alternative-proof: flash-web:unit / Backend URL defaults to the local flash-be port
  @integration-exempt @e2e-exempt
  Scenario: Backend URL defaults to the local flash-be port
    Given FLASH_BE_URL is not set
    When the backend URL is read
    Then the backend URL is "http://localhost:8080"

  # Exemption(integration): the rule is a pure function of an environment object and opens no resource; alternative-proof: flash-web:unit / Backend URL is read from FLASH_BE_URL
  # Exemption(e2e): the rule is decided inside the server before any page is served, so no page can show it; alternative-proof: flash-web:unit / Backend URL is read from FLASH_BE_URL
  @integration-exempt @e2e-exempt
  Scenario: Backend URL is read from FLASH_BE_URL
    Given FLASH_BE_URL is "http://flash-be:8080"
    When the backend URL is read
    Then the backend URL is "http://flash-be:8080"
