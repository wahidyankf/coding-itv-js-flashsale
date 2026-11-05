Feature: Sale status on the page

  As a shopper
  I want the page to show the sale, its status and how many items are left
  So that I know whether I can still buy

  Scenario Outline: The page shows the sale and its status
    Given a sale with stock 10 and <sold> sold that opens <opens> and closes <closes>
    When a visitor opens the page
    Then the page shows the status "<label>"
    And the page shows <left> items left
    And the "Buy Now" button is <button>

    Examples:
      | sold | opens       | closes     | label        | left | button   |
      | 3    | 1 hour ago  | in 1 hour  | On sale      | 7    | enabled  |
      | 3    | in 1 hour   | in 2 hours | Not open yet | 7    | disabled |
      | 3    | 2 hours ago | 1 hour ago | Ended        | 7    | disabled |
      | 10   | 1 hour ago  | in 1 hour  | Sold out     | 0    | disabled |

  Scenario: The page says so when no sale exists
    Given no sale exists
    When a visitor opens the page
    Then the page says "No sale is open right now."

  Scenario: The page follows the sale as it changes
    Given a sale with stock 10 and 3 sold that opens 1 hour ago and closes in 1 hour
    And a visitor has the page open
    When the sold count changes to 10
    Then the page shows the status "Sold out"
    And the page shows 0 items left

  Scenario: The page says so when the sale cannot be reached
    Given the sale cannot be reached
    When a visitor opens the page
    Then the page says "The sale could not be loaded."
