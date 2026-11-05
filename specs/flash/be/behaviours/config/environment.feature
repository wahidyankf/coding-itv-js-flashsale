Feature: Configuration of the flash-be API

  As an operator
  I want flash-be to read its settings from the environment
  So that the same build runs locally and in production

  # Exemption(integration): the rule is a pure function of an environment object and opens no resource; alternative-proof: flash-be:unit / Local defaults apply outside production
  @integration-exempt
  Scenario: Local defaults apply outside production
    Given NODE_ENV is not production
    When the configuration is built from an empty environment
    Then the port is 8080
    And the database host is localhost on port 5432
    And the Redis host is localhost on port 6379

  # Exemption(integration): the rule is a pure function of an environment object and opens no resource; alternative-proof: flash-be:unit / Production requires DATABASE_URL
  @integration-exempt
  Scenario: Production requires DATABASE_URL
    Given NODE_ENV is production
    And REDIS_URL is set
    When the configuration is built
    Then building the configuration fails with "DATABASE_URL is required in production"

  # Exemption(integration): the rule is a pure function of an environment object and opens no resource; alternative-proof: flash-be:unit / Production requires REDIS_URL
  @integration-exempt
  Scenario: Production requires REDIS_URL
    Given NODE_ENV is production
    And DATABASE_URL is set
    When the configuration is built
    Then building the configuration fails with "REDIS_URL is required in production"

  # Exemption(integration): the rule is a pure function of an environment object and opens no resource; alternative-proof: flash-be:unit / Invalid FLASH_BE_PORT is refused
  @integration-exempt
  Scenario Outline: Invalid FLASH_BE_PORT is refused
    Given FLASH_BE_PORT is "<value>"
    When the configuration is built
    Then building the configuration fails with "FLASH_BE_PORT must be a valid port number"

    Examples:
      | value |
      | abc   |
      | 0     |
      | 99999 |

  # Exemption(integration): the rule is a pure function of an environment object and opens no resource; alternative-proof: flash-be:unit / Configured port is read from the environment
  @integration-exempt
  Scenario: Configured port is read from the environment
    Given FLASH_BE_PORT is "9000"
    When the configuration is built
    Then the port is 9000

  # Exemption(integration): the rule is a pure function of an environment object and opens no resource; alternative-proof: flash-be:unit / Configured database and Redis hosts are read from the environment
  @integration-exempt
  Scenario: Configured database and Redis hosts are read from the environment
    Given DATABASE_URL is "postgres://u:p@db:5432/x"
    And REDIS_URL is "redis://cache:6379"
    When the configuration is built
    Then the database host is db on port 5432
    And the Redis host is cache on port 6379
