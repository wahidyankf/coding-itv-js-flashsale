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
    And the reply clears both cookies
    And the shopper is no longer logged in

  Scenario: A refresh token that has run out is refused, and the session stays open
    Given "ana" has signed up with the password "a long password"
    And the shopper keeps a copy of the tokens
    When the refresh token runs out
    And the shopper refreshes the login
    Then the response status is 401
    And the error is "invalid_refresh_token"
    And the reply clears both cookies
    And the session of the copied tokens is not ended

  Scenario: A refresh without a refresh token is refused
    When someone who is not logged in refreshes the login
    Then the response status is 401
    And the error is "invalid_refresh_token"
    And the reply clears both cookies

  Scenario: The refresh cookie is sent only to the auth paths
    Given "ana" has signed up with the password "a long password"
    Then the "refresh_token" cookie is limited to the path "/api/v1/auth"
    And the "access_token" cookie is limited to the path "/"

  Scenario Outline: The routes of a shopper need a login
    When someone who is not logged in sends <method> <path>
    Then the response status is 401
    And the error is "not_authenticated"

    Examples:
      | method | path                                                                       |
      | POST   | /api/v1/sales/00000000-0000-4000-8000-000000000000/queue                   |
      | GET    | /api/v1/sales/00000000-0000-4000-8000-000000000000/queue/me                |
      | GET    | /api/v1/sales/00000000-0000-4000-8000-000000000000/queue/me/events         |
      | POST   | /api/v1/sales/00000000-0000-4000-8000-000000000000/reservations            |
      | POST   | /api/v1/sales/00000000-0000-4000-8000-000000000000/purchases              |
      | GET    | /api/v1/sales/00000000-0000-4000-8000-000000000000/purchases/me           |
      | GET    | /api/v1/auth/me                                                            |

  Scenario: A login made on one instance is accepted by another
    Given two instances of the API share one database and one Redis
    And a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has signed up with the password "a long password" on the first instance
    When the shopper asks who is logged in on the second instance
    Then the response status is 200
    And the account is "ana", a "shopper"
    When the shopper joins the queue on the second instance
    Then the response status is 201

  Scenario: Logging out on one instance ends the login on every instance
    Given two instances of the API share one database and one Redis
    And "ana" has signed up with the password "a long password" on the first instance
    And the shopper keeps a copy of the tokens
    And the shopper has asked who is logged in on the second instance
    When the shopper logs out on the first instance
    And the copy of the access token is sent to the second instance
    Then the response status is 401
    And the error is "not_authenticated"

  Scenario: A refresh on one instance is honoured by another
    Given two instances of the API share one database and one Redis
    And "ana" has signed up with the password "a long password" on the first instance
    And the shopper keeps a copy of the tokens
    When the shopper refreshes the login on the first instance
    And the shopper asks who is logged in on the second instance
    Then the response status is 200
    And the account is "ana", a "shopper"
    When the copy of the refresh token is used on the second instance
    Then the response status is 401
    And the error is "invalid_refresh_token"
    And the shopper is no longer logged in on the second instance
