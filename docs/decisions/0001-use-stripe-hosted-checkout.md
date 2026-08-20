# 1. Use Stripe hosted Checkout rather than a custom payment form

**Status:** Accepted · **Date:** 2026-08-19

## Context

The platform needs to take a card payment. Two shapes were available: collect card details
in our own form using Stripe Elements, or redirect to a Stripe-hosted Checkout Session.

A custom form looks more impressive in a screenshot. It also means card data touches our
frontend, which changes the PCI DSS obligation from the lightest self-assessment
questionnaire to a substantially heavier one, and makes us responsible for the correctness
of 3-D Secure handling, wallet support, and every localisation Stripe already ships.

## Decision

Redirect to a Stripe-hosted Checkout Session. Card details never reach our origin.

## Consequences

Payment method coverage, Strong Customer Authentication, wallets and localisation are
Stripe's problem, not ours. The user leaves our domain briefly, which is a real cost to the
experience and a deliberate trade.

We lose the ability to style the payment step, and we gain a system where the sensitive
surface area is a single server-to-server call and one signed webhook.

For a portfolio prototype the reasoning matters more than the pixels: choosing the option
with the smaller compliance burden is the choice a payments team would expect, and the
opposite choice would invite the question of why we wanted card data in scope.
