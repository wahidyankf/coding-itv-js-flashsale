Feature: Requests the API cannot serve

  As a client
  I want a path the API does not serve, or a request it cannot read, to get a clear answer
  So that a typo or a broken body does not look like a working endpoint

  Scenario: Unknown routes return 404
    When a client sends GET /nope
    Then the response status is 404
    And the error is "not_found"

  Scenario: An error reply carries a sentence as well as a code
    When a client sends GET /nope
    Then the response status is 404
    And the error message is "Nothing was found at this address."

  Scenario: A request body that is not JSON is refused
    When a client sends POST /sales/00000000-0000-4000-8000-000000000000/queue with a body that is not JSON
    Then the response status is 400
    And the error is "invalid_request"

  Scenario Outline: A request body with a missing or mistyped field is refused with the code of that field
    When a client sends POST <path> with the body <body>
    Then the response status is 400
    And the error is "<error>"

    Examples:
      | path           | body                                          | error            |
      | /auth/register | {}                                            | invalid_user     |
      | /auth/register | {"username":5,"password":"a long password"}  | invalid_user     |
      | /auth/register | {"username":"ana"}                            | invalid_password |
      | /auth/register | {"username":"ana","password":7}              | invalid_password |
