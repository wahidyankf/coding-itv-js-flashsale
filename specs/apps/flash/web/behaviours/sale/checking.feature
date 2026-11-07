Feature: Checking my status

  As a shopper
  I want to ask, once I am logged in, whether I got the item
  So that I can find out after I closed the page

  Scenario Outline: A shopper checks the outcome
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" <history>
    And "ana" is logged in
    And a visitor has the page open
    When she presses Check my status
    Then the page says "<message>"

    Examples:
      | history                | message                                  |
      | has bought an item     | You got it! Your purchase is confirmed.  |
      | holds an item          | An item is held for you.                 |
      | has done nothing       | You have no purchase and no hold.        |

  Scenario: A shopper who holds an item can confirm after checking
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" holds an item
    And "ana" is logged in
    And a visitor has the page open
    And she presses Check my status
    When she confirms the purchase
    Then the page says "You got it! Your purchase is confirmed."

  Scenario: A shopper who bought sees the Purchase ID after checking
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has bought an item
    And "ana" is logged in
    And a visitor has the page open
    When she presses Check my status
    Then the page says "You got it! Your purchase is confirmed."
    And the page shows the Purchase ID of "ana"'s purchase
