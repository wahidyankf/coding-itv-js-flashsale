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

  Scenario Outline: A shopper who cannot reach the sale is told so when checking
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" is logged in
    And a visitor has the page open
    And <failure>
    When she presses Check my status
    Then the page says "The sale could not be reached. Please try again."

    Examples:
      | failure                                |
      | the sale cannot be reached             |
      | the connection to the web server fails |

  Scenario: A shopper whose login has ended is asked to log in again when checking
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" is logged in
    And a visitor has the page open
    And every login has ended
    When she presses Check my status
    Then the page says "Your login has ended. Please log in again."
    And the page says "Log in to buy"
    And the page has no "Buy Now" button
