Feature: Creating a sale as an operator

  As an operator
  I want to create a sale through the API with a token
  So that I can set the stock and the window without a shell on the server

  Scenario: An operator creates a sale and shoppers see it
    Given the admin token is "operator-secret-0001"
    When the operator creates a sale with stock 5, opening in 10 minutes for 60 minutes, using the token "operator-secret-0001"
    Then the response status is 201
    And the new sale is "upcoming" with 5 items remaining
    And the current sale is the new sale

  Scenario: A request without a token is refused
    Given the admin token is "operator-secret-0001"
    When the operator creates a sale with stock 5, opening in 10 minutes for 60 minutes, without a token
    Then the response status is 401
    And the error is "invalid_admin_token"
    And the number of sales is 0

  Scenario: A request with the wrong token is refused
    Given the admin token is "operator-secret-0001"
    When the operator creates a sale with stock 5, opening in 10 minutes for 60 minutes, using the token "another-secret-0002"
    Then the response status is 401
    And the error is "invalid_admin_token"
    And the number of sales is 0

  Scenario: The admin route does not exist when no token is set
    Given no admin token is set
    When the operator creates a sale with stock 5, opening in 10 minutes for 60 minutes, using the token "operator-secret-0001"
    Then the response status is 404
    And the error is "not_found"
    And the number of sales is 0

  Scenario Outline: A sale that cannot work is refused
    Given the admin token is "operator-secret-0001"
    When the operator creates a sale with stock <stock>, opening in 10 minutes for <duration> minutes, using the token "operator-secret-0001"
    Then the response status is 400
    And the error is "invalid_sale"
    And the number of sales is 0

    Examples:
      | stock | duration |
      | 0     | 60       |
      | 5     | 0        |

  Scenario: A sale whose window overlaps another sale is refused
    Given the admin token is "operator-secret-0001"
    And a sale was created with stock 5, opening in 10 minutes for 60 minutes
    When the operator creates a sale with stock 3, opening in 30 minutes for 60 minutes, using the token "operator-secret-0001"
    Then the response status is 409
    And the error is "sale_overlaps"
    And the number of sales is 1

  Scenario: A sale that opens when another one closes is accepted
    Given the admin token is "operator-secret-0001"
    And a sale was created with stock 5, opening in 10 minutes for 60 minutes
    When the operator creates a sale with stock 3, opening in 70 minutes for 60 minutes, using the token "operator-secret-0001"
    Then the response status is 201
    And the number of sales is 2

  Scenario: Operators who create the same window at once get one sale
    Given the admin token is "operator-secret-0001"
    When 5 operators create a sale with stock 5, opening in 10 minutes for 60 minutes, at the same moment
    Then exactly 1 of them gets status 201
    And the others get status 409 with the error "sale_overlaps"
    And the number of sales is 1
