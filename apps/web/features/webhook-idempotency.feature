Feature: Webhook delivery is idempotent
  Stripe delivers at least once, so the same event can and does arrive twice.
  The platform must accept every delivery — refusing a duplicate would make
  Stripe retry forever — while recording its effect exactly once, a guarantee
  enforced by a unique constraint rather than application branching.

  Scenario: The same signed event delivered twice is recorded once
    Given the recorded event count is known
    When Stripe delivers a signed payment event
    And Stripe delivers the identical event again
    Then both deliveries are accepted with status 200
    And exactly one new event is recorded

  Scenario: A tampered payload is rejected
    When Stripe delivers a payment event whose signature does not match its payload
    Then the delivery is rejected with status 400
