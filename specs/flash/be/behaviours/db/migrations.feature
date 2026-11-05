Feature: Database migrations of the flash-be API

  As a developer
  I want the schema built by ordered, hand-written migrations
  So that every fresh database reaches the same schema

  # Exemption(e2e): the e2e suite talks to the API only and has no view of the schema; alternative-proof: flash-be:integration / The first migration creates the products table
  @e2e-exempt
  Scenario: The first migration creates the products table
    Given a database with no tables
    When the migrations run to the latest version
    Then the products table exists

  # Exemption(e2e): the e2e suite talks to the API only and has no view of the schema; alternative-proof: flash-be:integration / Rolling back the first migration removes the products table
  @e2e-exempt
  Scenario: Rolling back the first migration removes the products table
    Given a database migrated to the latest version
    When the first migration is rolled back
    Then the products table does not exist
