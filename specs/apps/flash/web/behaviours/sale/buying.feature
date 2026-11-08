Feature: Buying the item

  As a shopper
  I want to press Buy Now after I log in, wait my turn, and confirm
  So that I get the item without anyone else taking it

  Scenario: A shopper buys the item
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" is logged in
    And a visitor has the page open
    When she presses Buy Now
    Then the page says "An item is held for you."
    And the "Confirm purchase" button is enabled
    When she confirms the purchase
    Then the page says "You got it! Your purchase is confirmed."
    And the page shows the Purchase ID of "ana"'s purchase
    And the page shows 9 items left

  Scenario: A waiting shopper sees their place
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And the queue admits shoppers slowly
    And 5 shoppers are ahead in the queue
    And "ana" is logged in
    And a visitor has the page open
    When she presses Buy Now
    Then the page says "You are in the queue. Your place: 6."

  Scenario: A shopper who is told the item is gone
    Given a sale with stock 1 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ben" holds the last item
    And "ana" is logged in
    And a visitor has the page open
    When she presses Buy Now
    Then the page says "Sold out. No items are left."

  Scenario: A shopper who already bought is told so
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has bought an item
    And "ana" is logged in
    And a visitor has the page open
    When she presses Buy Now
    Then the page says "You already bought an item."

  Scenario: A shopper who waits while the sale ends is told so
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And the queue admits shoppers slowly
    And 5 shoppers are ahead in the queue
    And "ana" is logged in
    And a visitor has the page open
    And she presses Buy Now
    When the sale ends
    Then the page says "The sale has ended."

  Scenario: A shopper who waits while the last items are sold is told so
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And the queue admits shoppers slowly
    And 5 shoppers are ahead in the queue
    And "ana" is logged in
    And a visitor has the page open
    And she presses Buy Now
    When the sold count changes to 10
    Then the page says "Sold out. No items are left."

  Scenario: A shopper who sends too many requests is told to wait
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And each user may send 1 write request in each 60 seconds
    And "ana" is logged in
    And a visitor has the page open
    When she presses Buy Now
    Then the page says "Too many requests. Try again in"

  Scenario: A declined payment keeps the hold
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And the payment provider declines every charge
    And "ana" is logged in
    And a visitor has the page open
    And she presses Buy Now
    When she confirms the purchase
    Then the page says "Payment failed. Your item is still held. Press Confirm purchase to try again."
    And the "Confirm purchase" button is enabled

  Scenario: A hold that runs out is shown as ended
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And a hold lasts 2 seconds
    And "ana" is logged in
    And a visitor has the page open
    When she presses Buy Now
    And 3 seconds pass
    Then the page says "Your hold has ended. Press Buy Now to try again."
    And the "Confirm purchase" button is disabled

  Scenario: A waiting shopper whose place is lost is told to join again
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And the queue admits shoppers slowly
    And 5 shoppers are ahead in the queue
    And "ana" is logged in
    And a visitor has the page open
    When she presses Buy Now
    Then the page says "You are in the queue. Your place: 6."
    When the queue is lost
    Then the page says "Your place was lost. Press Buy Now to join again."
