Feature: Sign-in failures reveal nothing
  A failed sign-in must not disclose whether the account exists or what state
  it is in. A wrong password, an account that has never existed and a disabled
  account all produce byte-identical responses, so an attacker probing the
  login form learns nothing from the differences.

  Scenario: A wrong password and a nonexistent account are indistinguishable
    When someone signs in as the operator with the wrong password
    And someone signs in as "no-such-account@zerofayyz.test" with any password
    Then both attempts fail with status 401
    And the two response bodies are byte-identical

  @reenable-operator
  Scenario: A disabled account is indistinguishable from a wrong password
    Given the admin is signed in
    And the admin disables the operator's account
    When someone signs in as the operator with the correct password
    And someone signs in as the operator with the wrong password
    Then both attempts fail with status 401
    And the two response bodies are byte-identical
    And the admin re-enables the operator's account

  Scenario: A successful sign-in issues a cookie the browser cannot read
    When someone signs in as the operator with the correct password
    Then the sign-in succeeds
    And the session cookie is marked HttpOnly
