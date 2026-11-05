Feature: Database migrations of the flash-be API

  As a developer
  I want the schema built by ordered, hand-written migrations
  So that every fresh database reaches the same schema, and the database itself refuses a sale it cannot honour

  Scenario: The migrations create the sales, purchases and reservations tables
    Given a database with no tables
    When the migrations run to the latest version
    Then the sales, purchases and reservations tables exist
    And the products table does not exist

  Scenario: The database refuses a sale that has sold more than its stock
    Given a database migrated to the latest version
    When a sale with stock 5 and 6 sold is inserted
    Then the database refuses the row

  Scenario: The database refuses a second purchase by the same user in one sale
    Given a database migrated to the latest version
    And a sale with stock 5 exists
    When the user "ana" is recorded as a buyer twice in that sale
    Then the database refuses the second purchase
