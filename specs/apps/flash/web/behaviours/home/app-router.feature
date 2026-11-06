Feature: The app router serves the home page

  As a shopper
  I want the home page to be served through the app's router
  So that the page works when a visitor opens it in a browser

  # Exemption(integration): the home page loads its status through a TanStack server function, which needs the Start server runtime; the integration layer runs no server, so this boundary is proven by the browser; alternative-proof: flash-web:e2e / Home shows the backend as ok when flash-be is live
  @integration-exempt
  Scenario: The app router serves the home page
    Given flash-be reports status "ok"
    When a visitor opens the home page
    Then the page heading is "Flash Sale"
    And the page says "Backend: ok"
