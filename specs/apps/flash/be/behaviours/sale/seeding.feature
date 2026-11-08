Feature: Seeding a sale

  As an operator
  I want to create a sale from the command line
  So that I can run a sale without editing the database by hand

  Scenario: Seeding creates a sale with the given stock and window
    Given a database migrated to the latest version
    When the sale is seeded with stock 100, opening in 10 minutes for 60 minutes
    Then the sales table holds 1 sale with stock 100
    And that sale is open for 60 minutes

  Scenario: Seeding refuses a stock that is not a positive integer
    Given a database migrated to the latest version
    When the sale is seeded with stock 0, opening in 10 minutes for 60 minutes
    Then seeding fails with "stock must be a positive integer"
    And the sales table holds 0 sales

  Scenario: Seeding refuses a window that lasts no minutes
    Given a database migrated to the latest version
    When the sale is seeded with stock 100, opening in 10 minutes for 0 minutes
    Then seeding fails with "duration-minutes must be a positive integer"
    And the sales table holds 0 sales

  Scenario: Seeding refuses a window that starts too far in the future
    Given a database migrated to the latest version
    When the sale is seeded with stock 100, opening in 9000000000000000 minutes for 60 minutes
    Then seeding fails with "the sale is not usable: its name, window or holds are out of range"
    And the sales table holds 0 sales
