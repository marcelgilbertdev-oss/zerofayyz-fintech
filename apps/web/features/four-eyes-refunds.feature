@refunds
Feature: Four-eyes refund approval
  Money leaves the platform only when two different people agree it should.
  The rule is enforced in the database UPDATE itself — the approval's WHERE
  clause excludes the requester — so no code path around the handler can
  approve a request single-handedly.

  Background:
    Given the admin is signed in
    And the operator is signed in
    And no refund request is pending

  Scenario: The person who requested a refund cannot approve it
    When the admin requests a refund on a succeeded payment because "Duplicate charge reported by the customer"
    And the admin tries to approve that refund request
    Then the approval is refused with status 403
    And the refusal explains "A refund cannot be approved by the person who requested it"
    And that refund request is still pending

  Scenario: A different person can decide the same request
    When the operator requests a refund on a succeeded payment because "Customer returned the goods"
    And the admin rejects that refund request with the note "Outside the return window"
    Then the refund request is rejected

  Scenario: An operator can request but never decide
    When the operator requests a refund on a succeeded payment because "Card charged twice in error"
    And the operator tries to approve that refund request
    Then the approval is refused with status 403

  Scenario: A refund cannot exceed the payment it refunds
    When the admin requests a refund of 1000000000 minor units on a succeeded payment because "Fat-fingered amount"
    Then the request is refused with status 400
    And the refusal explains "A refund cannot exceed the payment it refunds"
