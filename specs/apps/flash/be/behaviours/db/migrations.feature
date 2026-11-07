Feature: Database migrations of the flash-be API

  As a developer
  I want the schema built by ordered, hand-written migrations
  So that every fresh database reaches the same schema, and the database itself refuses a sale it cannot honour

  Scenario: The migrations create the sales, purchases, reservations, products, users and sessions tables
    Given a database with no tables
    When the migrations run to the latest version
    Then the sales, purchases, reservations, products, users and sessions tables exist

  Scenario: Every table records who created, changed and deleted a row
    Given a database with no tables
    When the migrations run to the latest version
    Then each of those tables has the columns created_at, created_by, updated_at, updated_by, deleted_at and deleted_by

  Scenario: The migrations leave one user, the system, that acts for the migrations
    Given a database with no tables
    When the migrations run to the latest version
    Then the users table holds only the user "$system"

  # Exemption(e2e): the shipped migrate command only goes to the latest version, so no process can stop at an older one; alternative-proof: flash-be:integration / An existing database keeps its data when it is migrated
  @e2e-exempt
  Scenario: An existing database keeps its data when it is migrated
    Given a database migrated to the version before users and products
    And that database holds a sale named "Sneakers" with a hold and a purchase by "ana"
    When the migrations run to the latest version
    Then the sale belongs to a product named "Sneakers"
    And the user "ana" holds that hold and that purchase

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
