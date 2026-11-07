Feature: Logins of shoppers

  As a shopper
  I want my login to last while I shop, renew itself, and end when I log out
  So that I stay in line without logging in again, and a stolen cookie does not last

  Scenario: A shopper asks who is logged in
    Given "ana" has signed up with the password "a long password"
    When the shopper asks who is logged in
    Then the response status is 200
    And the account is "ana", a "shopper"

  Scenario: Logging out ends the login
    Given "ana" has signed up with the password "a long password"
    And the shopper keeps a copy of the tokens
    When the shopper logs out
    Then the response status is 200
    And the reply clears both cookies
    And the copy of the access token is refused

  Scenario: Logging out twice is harmless
    Given "ana" has signed up with the password "a long password"
    When the shopper logs out
    And the shopper logs out
    Then the response status is 200

  Scenario: An access token that has expired is refused
    Given "ana" has signed up with the password "a long password"
    When the access token expires
    And the shopper asks who is logged in
    Then the response status is 401
    And the error is "not_authenticated"

  Scenario: The refresh token trades for a new pair of tokens
    Given "ana" has signed up with the password "a long password"
    And the shopper keeps a copy of the tokens
    When the shopper refreshes the login
    Then the response status is 200
    And the reply sets an "access_token" cookie and a "refresh_token" cookie, both HttpOnly
    And the copy of the access token is refused
    And the shopper is logged in as "ana"

  Scenario: A refresh token used twice ends the login
    Given "ana" has signed up with the password "a long password"
    And the shopper keeps a copy of the tokens
    And the shopper refreshes the login
    When the copy of the refresh token is used
    Then the response status is 401
    And the error is "invalid_refresh_token"
    And the shopper is no longer logged in

  Scenario: A refresh without a refresh token is refused
    When someone who is not logged in refreshes the login
    Then the response status is 401
    And the error is "invalid_refresh_token"

  Scenario: The refresh cookie is sent only to the auth paths
    Given "ana" has signed up with the password "a long password"
    Then the "refresh_token" cookie is limited to the path "/auth"

  Scenario Outline: The routes of a shopper need a login
    When someone who is not logged in sends <method> <path>
    Then the response status is 401
    And the error is "not_authenticated"

    Examples:
      | method | path                                                       |
      | POST   | /sales/00000000-0000-4000-8000-000000000000/queue          |
      | GET    | /sales/00000000-0000-4000-8000-000000000000/queue/me       |
      | GET    | /sales/00000000-0000-4000-8000-000000000000/queue/me/events |
      | POST   | /sales/00000000-0000-4000-8000-000000000000/reservations  |
      | POST   | /sales/00000000-0000-4000-8000-000000000000/purchases     |
      | GET    | /sales/00000000-0000-4000-8000-000000000000/purchases/me  |
      | GET    | /auth/me                                                   |
