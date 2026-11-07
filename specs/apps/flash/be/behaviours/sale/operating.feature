Feature: Changing, removing and listing sales as an operator

  As an operator
  I want to change, remove and list sales through the API with a token
  So that I can fix a mistake or cancel a sale without a shell on the server

  Scenario: An operator changes a sale that has not started
    Given the admin token is "operator-secret-0001"
    And a sale was created with stock 5, opening in 10 minutes for 60 minutes
    When the operator changes that sale to stock 8 and a hold time of 30 seconds, using the token "operator-secret-0001"
    Then the response status is 200
    And the sale has stock 8 with 8 items remaining
    And the operator sees a hold time of 30 seconds on that sale

  Scenario: A sale that has started can get more stock
    Given the admin token is "operator-secret-0001"
    And a sale was created with stock 5, opened 10 minutes ago for 60 minutes
    When the operator changes that sale to stock 8, using the token "operator-secret-0001"
    Then the response status is 200
    And the sale has stock 8 with 8 items remaining

  Scenario Outline: A sale that has started keeps its start and its stock
    Given the admin token is "operator-secret-0001"
    And a sale was created with stock 5, opened 10 minutes ago for 60 minutes
    When the operator <change>, using the token "operator-secret-0001"
    Then the response status is 409
    And the error is "sale_locked"
    And the sale has stock 5 with 5 items remaining

    Examples:
      | change                                               |
      | changes that sale to stock 3                         |
      | moves that sale to open in 30 minutes for 60 minutes |

  Scenario: A sale that is over cannot be changed
    Given the admin token is "operator-secret-0001"
    And a sale was created with stock 5, opened 120 minutes ago for 60 minutes
    When the operator changes that sale to stock 8, using the token "operator-secret-0001"
    Then the response status is 409
    And the error is "sale_locked"

  Scenario: A change that would overlap another sale is refused
    Given the admin token is "operator-secret-0001"
    And a sale was created with stock 5, opening in 10 minutes for 60 minutes
    And another sale was created with stock 5, opening in 70 minutes for 60 minutes
    When the operator moves that sale to open in 30 minutes for 60 minutes, using the token "operator-secret-0001"
    Then the response status is 409
    And the error is "sale_overlaps"

  Scenario: A change that makes the sale unusable is refused
    Given the admin token is "operator-secret-0001"
    And a sale was created with stock 5, opening in 10 minutes for 60 minutes
    When the operator changes that sale to stock 0, using the token "operator-secret-0001"
    Then the response status is 400
    And the error is "invalid_sale"
    And the sale has stock 5 with 5 items remaining

  Scenario: An operator removes a sale that nobody bought from
    Given the admin token is "operator-secret-0001"
    And a sale was created with stock 5, opening in 10 minutes for 60 minutes
    When the operator removes that sale, using the token "operator-secret-0001"
    Then the response status is 200
    And the number of sales is 0

  Scenario: A sale with a purchase cannot be removed
    Given the admin token is "operator-secret-0001"
    And a sale was created with stock 5, opened 10 minutes ago for 60 minutes
    And an item of that sale was bought
    When the operator removes that sale, using the token "operator-secret-0001"
    Then the response status is 409
    And the error is "sale_has_purchases"
    And the number of sales is 1

  Scenario: An operator lists every sale, the one that opens last first
    Given the admin token is "operator-secret-0001"
    And a sale was created with stock 5, opening in 10 minutes for 60 minutes
    And another sale was created with stock 7, opening in 70 minutes for 60 minutes
    When the operator lists the sales, using the token "operator-secret-0001"
    Then the response status is 200
    And the listed sales have the stocks 7 and 5, in that order

  Scenario Outline: Changing, removing and listing need the token
    Given the admin token is "operator-secret-0001"
    And a sale was created with stock 5, opening in 10 minutes for 60 minutes
    When the operator <request>, without a token
    Then the response status is 401
    And the error is "invalid_admin_token"
    And the sale has stock 5 with 5 items remaining

    Examples:
      | request                      |
      | changes that sale to stock 8 |
      | removes that sale            |
      | lists the sales              |
