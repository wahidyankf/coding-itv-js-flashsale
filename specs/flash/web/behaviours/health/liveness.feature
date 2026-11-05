Feature: Liveness of the flash-web app

  As an operations engineer
  I want a liveness route for the web app
  So that the container health check and the e2e suite know the app is up

  # Exemption(integration): the route is a pure handler that returns a fixed body, and HTTP is a network boundary that the integration suite does not open for the web app; alternative-proof: flash-web:unit / Web liveness returns ok
  @integration-exempt
  Scenario: Web liveness returns ok
    When a client sends GET /api/health
    Then the response status is 200
    And the body has status "ok"
