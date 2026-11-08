Feature: Confirming a purchase

  As a shopper who holds an item
  I want to pay for it
  So that it is mine, once, and I am not charged for an item I do not get

  Scenario: A shopper pays for the held item
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has been admitted
    And "ana" has reserved an item
    When "ana" confirms the purchase
    Then the response status is 201
    And the user is "ana"
    And a purchase id is issued
    And 9 items remain

  Scenario: Confirming again returns the same purchase
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has been admitted
    And "ana" has reserved an item
    And "ana" has confirmed the purchase
    When "ana" confirms the purchase
    Then the response status is 200
    And the purchase is the one "ana" had before
    And 9 items remain

  Scenario: A buyer cannot reserve a second item
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has been admitted
    And "ana" has reserved an item
    And "ana" has confirmed the purchase
    When "ana" reserves an item
    Then the response status is 409
    And the error is "already_purchased"

  Scenario: A reservation id that does not exist is refused
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    When "ana" confirms the purchase with the reservation id "00000000-0000-4000-8000-000000000000"
    Then the response status is 404
    And the error is "reservation_not_found"

  Scenario: A reservation id that is not an id is refused
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    When "ana" confirms the purchase with the reservation id "not-an-id"
    Then the response status is 400
    And the error is "invalid_reservation"

  Scenario: Somebody else's reservation cannot be confirmed
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has been admitted
    And "ana" has reserved an item
    When "ben" confirms the purchase with the reservation of "ana"
    Then the response status is 404
    And the error is "reservation_not_found"

  Scenario: A hold that has expired cannot be confirmed
    Given a sale with stock 1 and 0 sold that opens 1 hour ago and closes in 1 hour
    And the hold time of the sale is 1 second
    And "ana" has been admitted
    And "ana" has reserved an item
    When 2 seconds pass
    And "ana" confirms the purchase
    Then the response status is 409
    And the error is "hold_expired"

  Scenario: A declined payment keeps the hold
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And the payment provider declines every payment
    And "ana" has been admitted
    And "ana" has reserved an item
    When "ana" confirms the purchase
    Then the response status is 402
    And the error is "payment_failed"
    And "ana" still holds the item
    And 10 items remain

  Scenario: A payment that finishes after the item is gone is refunded
    Given a sale with stock 1 and 0 sold that opens 1 hour ago and closes in 1 hour
    And the hold time of the sale is 1 second
    And the payment provider takes 3 seconds
    And "ana" has been admitted
    And "ana" has reserved an item
    When "ana" starts to confirm the purchase
    And 2 seconds pass
    And "ben" buys the last item
    And the confirmation finishes
    Then the response status is 409
    And the error is "sold_out"
    And the payment of "ana" is refunded
    And the payment of "ana" was charged once and refunded once
    And "ana" has no purchase

  Scenario: Two confirmations of one hold on two instances charge once
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And the payment provider takes 1 second
    And "ana" has been admitted
    And "ana" has reserved an item
    When "ana" confirms the purchase on two instances at the same time
    Then both confirmations answer with the same purchase
    And the payment of "ana" is charged once
    And 9 items remain

  Scenario: A shopper who is declined and tries again is charged once
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And the payment provider declines every payment
    And "ana" has been admitted
    And "ana" has reserved an item
    And "ana" has tried to confirm the purchase and was declined
    And the payment provider accepts every payment
    When "ana" confirms the purchase
    Then the response status is 201
    And the payment of "ana" is charged on the second attempt
    And 9 items remain

  # Exemption(e2e): the refund must land between this confirmation's charge and its commit, and a running server gives no way to place it there; alternative-proof: flash-be:unit / A confirm whose charge another confirm gave back first is refused, and the hold stays
  @e2e-exempt
  Scenario: A confirm whose charge another confirm gave back first is refused, and the hold stays
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has been admitted
    And "ana" has reserved an item
    And another confirmation of the hold gives the charge back before the commit of "ana"
    When "ana" confirms the purchase
    Then the response status is 402
    And the error is "payment_failed"
    And "ana" still holds the item
    And 10 items remain
    When "ana" confirms the purchase again
    Then the response status is 201
    And 9 items remain

  Scenario: Many buyers confirming at once sell exactly the stock
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And 30 shoppers have been admitted
    And all 30 shoppers have tried to reserve an item
    When every shopper who holds an item confirms the purchase at the same time
    Then 10 purchases are made
    And 0 items remain
    And the sale status is "sold_out"

  Scenario: A confirmation that names no reservation is refused
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    When "ana" confirms the purchase with an empty body
    Then the response status is 400
    And the error is "invalid_reservation"

  Scenario: A hold cannot be paid for once the sale has ended
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has been admitted
    And "ana" has reserved an item
    And the sale has ended
    When "ana" confirms the purchase
    Then the response status is 409
    And the error is "sale_ended"
    And 10 items remain

  Scenario: A buyer who confirms another reservation is told they already bought
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has been admitted
    And "ana" has reserved an item
    And "ana" has confirmed the purchase
    When "ana" confirms the purchase with the reservation id "00000000-0000-4000-8000-000000000000"
    Then the response status is 409
    And the error is "already_purchased"
    And 9 items remain
