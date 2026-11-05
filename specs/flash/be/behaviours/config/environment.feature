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

  # Exemption(integration): the rule is a pure function of an environment object and opens no resource; alternative-proof: flash-be:unit / Production requires TICKET_SECRET
  @integration-exempt
  Scenario: Production requires TICKET_SECRET
    Given NODE_ENV is production
    And DATABASE_URL is set
    And REDIS_URL is set
    When the configuration is built
    Then building the configuration fails with "TICKET_SECRET is required in production"

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

  # Exemption(integration): the rule is a pure function of an environment object and opens no resource; alternative-proof: flash-be:unit / Invalid queue timings are refused
  @integration-exempt
  Scenario Outline: Invalid queue timings are refused
    Given <name> is "<value>"
    When the configuration is built
    Then building the configuration fails with "<name> must be a positive integer"

    Examples:
      | name                  | value |
      | ADMISSION_TICK_MS     | 0     |
      | ADMISSION_TICK_MS     | fast  |
      | ADMISSION_TTL_SECONDS | -5    |

  # Exemption(integration): the rule is a pure function of an environment object and opens no resource; alternative-proof: flash-be:unit / Payment defaults apply outside production
  @integration-exempt
  Scenario: Payment defaults apply outside production
    Given NODE_ENV is not production
    When the configuration is built from an empty environment
    Then the payment takes 150 ms
    And the payment declines 2 percent of charges

  # Exemption(integration): the rule is a pure function of an environment object and opens no resource; alternative-proof: flash-be:unit / Invalid payment settings are refused
  @integration-exempt
  Scenario Outline: Invalid payment settings are refused
    Given <name> is "<value>"
    When the configuration is built
    Then building the configuration fails with "<name> <rule>"

    Examples:
      | name                 | value | rule                                |
      | PAYMENT_FAILURE_RATE | 2     | must be a number from 0 to 1        |
      | PAYMENT_FAILURE_RATE | lots  | must be a number from 0 to 1        |
      | PAYMENT_LATENCY_MS   | -1    | must be zero or a positive integer  |
      | PAYMENT_LATENCY_MS   | slow  | must be zero or a positive integer  |

  # Exemption(integration): the rule is a pure function of an environment object and opens no resource; alternative-proof: flash-be:unit / Rate limit defaults apply outside production
  @integration-exempt
  Scenario: Rate limit defaults apply outside production
    Given NODE_ENV is not production
    When the configuration is built from an empty environment
    Then the limit is 30 requests per user and 600 per address in each 10 seconds
    And proxy headers are not trusted

  # Exemption(integration): the rule is a pure function of an environment object and opens no resource; alternative-proof: flash-be:unit / Invalid rate limit settings are refused
  @integration-exempt
  Scenario Outline: Invalid rate limit settings are refused
    Given <name> is "<value>"
    When the configuration is built
    Then building the configuration fails with "<name> <rule>"

    Examples:
      | name                      | value | rule                         |
      | RATE_LIMIT_WINDOW_SECONDS | 0     | must be a positive integer   |
      | RATE_LIMIT_PER_USER       | abc   | must be a positive integer   |
      | RATE_LIMIT_PER_IP         | -1    | must be a positive integer   |
      | TRUST_PROXY               | maybe | must be true or false        |

  # Exemption(integration): the rule is a pure function of an environment object and opens no resource; alternative-proof: flash-be:unit / The sale cache time defaults to one second outside production
  @integration-exempt
  Scenario: The sale cache time defaults to one second outside production
    Given NODE_ENV is not production
    When the configuration is built from an empty environment
    Then sale reads are cached for 1000 ms

  # Exemption(integration): the rule is a pure function of an environment object and opens no resource; alternative-proof: flash-be:unit / An invalid sale cache time is refused
  @integration-exempt
  Scenario Outline: An invalid sale cache time is refused
    Given <name> is "<value>"
    When the configuration is built
    Then building the configuration fails with "<name> <rule>"

    Examples:
      | name          | value | rule                              |
      | SALE_CACHE_MS | abc   | must be zero or a positive integer |
      | SALE_CACHE_MS | -1    | must be zero or a positive integer |
      | SALE_CACHE_MS | 1.5   | must be zero or a positive integer |

  # Exemption(integration): the rule is a pure function of an environment object and opens no resource; alternative-proof: flash-be:unit / The event interval defaults to one second outside production
  @integration-exempt
  Scenario: The event interval defaults to one second outside production
    Given NODE_ENV is not production
    When the configuration is built from an empty environment
    Then event streams read every 1000 ms

  # Exemption(integration): the rule is a pure function of an environment object and opens no resource; alternative-proof: flash-be:unit / An invalid event interval is refused
  @integration-exempt
  Scenario Outline: An invalid event interval is refused
    Given <name> is "<value>"
    When the configuration is built
    Then building the configuration fails with "<name> <rule>"

    Examples:
      | name               | value | rule                       |
      | EVENTS_INTERVAL_MS | 0     | must be a positive integer |
      | EVENTS_INTERVAL_MS | abc   | must be a positive integer |
      | EVENTS_INTERVAL_MS | -5    | must be a positive integer |
