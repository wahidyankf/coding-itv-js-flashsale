Feature: Accounts of shoppers

  As a shopper
  I want to sign up and log in with a name and a password
  So that the sale knows who I am without me typing my name on every request

  Scenario: A new shopper signs up and is logged in
    When "ana" signs up with the password "a long password"
    Then the response status is 201
    And the account is "ana", a "shopper"
    And the reply sets an "access_token" cookie and a "refresh_token" cookie, both HttpOnly
    And the shopper is logged in as "ana"

  Scenario: The name is trimmed and lowercased when signing up
    When "  ANA " signs up with the password "a long password"
    Then the response status is 201
    And the account is "ana", a "shopper"

  Scenario Outline: A name or a password that cannot be used is refused
    When "<name>" signs up with the password "<password>"
    Then the response status is 400
    And the error is "<error>"
    And the reply sets no cookie

    Examples:
      | name                                                              | password                                                                                                                          | error            |
      | has space                                                         | a long password                                                                                                                   | invalid_user     |
      | semi;colon                                                        | a long password                                                                                                                   | invalid_user     |
      | aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa | a long password                                                                                                                   | invalid_user     |
      | ana                                                               | short                                                                                                                             | invalid_password |
      | ana                                                               | ppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppppp | invalid_password |

  Scenario: A name that is taken is refused, whatever its case
    Given "ana" has signed up with the password "a long password"
    When "ANA" signs up with the password "another password"
    Then the response status is 409
    And the error is "username_taken"
    And the reply sets no cookie

  Scenario: A shopper logs in with the right password
    Given "ana" has signed up with the password "a long password"
    When "ana" logs in with the password "a long password"
    Then the response status is 200
    And the reply sets an "access_token" cookie and a "refresh_token" cookie, both HttpOnly
    And the shopper is logged in as "ana"

  Scenario: A login records the user as the one who changed their row
    Given "ana" has signed up with the password "a long password"
    When "ana" logs in with the password "a long password"
    Then the response status is 200
    And the stored row of "ana" was last changed by "ana", at the time of the login

  Scenario Outline: A wrong password and an unknown name are refused in the same way
    Given "ana" has signed up with the password "a long password"
    When "<name>" logs in with the password "<password>"
    Then the response status is 401
    And the error is "invalid_credentials"
    And the reply sets no cookie

    Examples:
      | name  | password       |
      | ana   | wrong password |
      | nobody | a long password |

  Scenario: Only a hash of the password is stored
    When "ana" signs up with the password "a long password"
    Then the stored passwords do not contain "a long password"
    And the stored logins hold hashes of the tokens, not the tokens
