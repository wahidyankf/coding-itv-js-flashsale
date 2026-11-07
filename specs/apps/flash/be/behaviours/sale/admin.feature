Feature: Creating a sale as an operator

  As an operator
  I want to create a sale through the API after I log in
  So that I can set the stock and the window without a shell on the server

  Scenario: An operator creates a sale and shoppers see it
    Given an operator is logged in
    When the operator creates a sale with stock 5, opening in 10 minutes for 60 minutes
    Then the response status is 201
    And the new sale is "upcoming" with 5 items remaining
    And the current sale is the new sale

  Scenario: A request from someone who is not logged in is refused
    When someone who is not logged in creates a sale with stock 5, opening in 10 minutes for 60 minutes
    Then the response status is 401
    And the error is "not_authenticated"
    And the number of sales is 0

  Scenario: A shopper cannot create a sale
    Given a shopper is logged in
    When the shopper creates a sale with stock 5, opening in 10 minutes for 60 minutes
    Then the response status is 403
    And the error is "forbidden"
    And the number of sales is 0

  Scenario Outline: A sale that cannot work is refused
    Given an operator is logged in
    When the operator creates a sale with stock <stock>, opening in 10 minutes for <duration> minutes
    Then the response status is 400
    And the error is "invalid_sale"
    And the number of sales is 0

    Examples:
      | stock | duration |
      | 0     | 60       |
      | 5     | 0        |

  Scenario: A sale whose window overlaps another sale is refused
    Given an operator is logged in
    And a sale was created with stock 5, opening in 10 minutes for 60 minutes
    When the operator creates a sale with stock 3, opening in 30 minutes for 60 minutes
    Then the response status is 409
    And the error is "sale_overlaps"
    And the number of sales is 1

  Scenario: A sale that opens when another one closes is accepted
    Given an operator is logged in
    And a sale was created with stock 5, opening in 10 minutes for 60 minutes
    When the operator creates a sale with stock 3, opening in 70 minutes for 60 minutes
    Then the response status is 201
    And the number of sales is 2

  Scenario: Operators who create the same window at once get one sale
    Given an operator is logged in
    When 5 operators create a sale with stock 5, opening in 10 minutes for 60 minutes, at the same moment
    Then exactly 1 of them gets status 201
    And the others get status 409 with the error "sale_overlaps"
    And the number of sales is 1

  Scenario: An operator creates a sale for a product that exists
    Given an operator is logged in
    And a product named "Phone" exists
    When the operator creates a sale of that product with stock 5, opening in 10 minutes for 60 minutes
    Then the response status is 201
    And the new sale sells that product

  Scenario: A sale for a product that does not exist is refused
    Given an operator is logged in
    When the operator creates a sale of a product that does not exist with stock 5, opening in 10 minutes for 60 minutes
    Then the response status is 404
    And the error is "product_not_found"
    And the number of sales is 0

  Scenario: Sales created without a product share one product
    Given an operator is logged in
    And a sale was created with stock 5, opening in 10 minutes for 60 minutes
    When the operator creates a sale with stock 7, opening in 70 minutes for 60 minutes
    Then the response status is 201
    And the number of sales is 2
    And the sales sell 1 product
