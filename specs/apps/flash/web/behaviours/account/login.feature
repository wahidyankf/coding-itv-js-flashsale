Feature: Logging in to buy

  As a shopper
  I want to sign up and log in on the page
  So that the sale knows who I am without me typing my name on every request

  Scenario: A visitor who is not logged in sees the form instead of the buying buttons
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    When a visitor opens the page
    Then the page says "Log in to buy"
    And the page has no "Buy Now" button
    And the page has no "Log out" button

  Scenario: A new shopper signs up and is logged in
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And a visitor has the page open
    When the visitor signs up as "ana" with the password "a long password"
    Then the page says "Signed in as ana"
    And the "Buy Now" button is enabled

  Scenario: A shopper with an account logs in
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has an account with the password "a long password"
    And a visitor has the page open
    When the visitor logs in as "ana" with the password "a long password"
    Then the page says "Signed in as ana"
    And the "Buy Now" button is enabled

  Scenario Outline: A login or a sign up that the server refuses is explained in words
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has an account with the password "a long password"
    And a visitor has the page open
    When the visitor <action> as "<name>" with the password "<password>"
    Then the page says "<message>"
    And the page has no "Buy Now" button

    Examples:
      | action   | name | password         | message                                  |
      | logs in  | ana  | a wrong password | Wrong name or password.                  |
      | logs in  | ben  | a long password  | Wrong name or password.                  |
      | signs up | ana  | another password | That name is taken. Choose another one.  |

  Scenario Outline: A name or a password that cannot be used is refused on the form
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And a visitor has the page open
    When the visitor signs up as "<name>" with the password "<password>"
    Then the page says "<message>"
    And the page has no "Buy Now" button

    Examples:
      | name      | password        | message                                               |
      | has space | a long password | Use 1 to 64 letters, digits or . _ @ + - characters.  |
      | ana       | short           | Use 8 to 128 characters for the password.             |

  Scenario: A shopper who is logged in is known when the page opens again
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" is logged in
    When a visitor opens the page
    Then the page says "Signed in as ana"
    And the page has no "Log in" button

  Scenario: A shopper logs out
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" is logged in
    And a visitor has the page open
    When the visitor logs out
    Then the page says "Log in to buy"
    And the page has no "Buy Now" button
    And the browser holds no login

  Scenario: A login that lost only its short token carries on without asking again
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" is logged in
    And a visitor has the page open
    And the short token of every login has ended
    When she presses Buy Now
    Then the page says "An item is held for you."
    And the page says "Signed in as ana"

  Scenario: A login that ended is replaced by the form, with the reason
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" is logged in
    And a visitor has the page open
    And every login has ended
    When she presses Buy Now
    Then the page says "Your login has ended. Please log in again."
    And the page says "Log in to buy"
    And the page has no "Buy Now" button
