Feature: Database migrations of the flash-be API

  As a developer
  I want the schema built by one hand-written migration
  So that every fresh database reaches the same schema, and the database itself refuses a sale it cannot honour

  Scenario: The migrations create the sales, purchases, reservations, products, users, sessions and payments tables
    Given a database with no tables
    When the migrations run to the latest version
    Then the sales, purchases, reservations, products, users, sessions and payments tables exist

  Scenario: Every table records who created, changed and deleted a row
    Given a database with no tables
    When the migrations run to the latest version
    Then each of those tables has the columns created_at, created_by, updated_at, updated_by, deleted_at and deleted_by

  Scenario: The migrations leave one user, the system, that acts for the migrations
    Given a database with no tables
    When the migrations run to the latest version
    Then the users table holds only the user "$system"

  Scenario: The database refuses a sale that has sold more than its stock
    Given a database migrated to the latest version
    When a sale with stock 5 and 6 sold is inserted
    Then the database refuses the row

  Scenario: The database refuses a sale that has no product
    Given a database migrated to the latest version
    When a sale with no product is inserted
    Then the database refuses the sale because its product is missing

  Scenario: The database refuses a user with a role it does not know
    Given a database migrated to the latest version
    When a user with the role "admin" is inserted
    Then the database refuses the user because its role is unknown

  Scenario: The database refuses a second purchase by the same user in one sale
    Given a database migrated to the latest version
    And a sale with stock 5 exists
    When the user "ana" is recorded as a buyer twice in that sale
    Then the database refuses the second purchase
