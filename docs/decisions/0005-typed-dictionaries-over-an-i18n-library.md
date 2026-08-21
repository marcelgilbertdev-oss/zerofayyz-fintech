# 5. Typed dictionaries over an i18n library

**Status:** Accepted · **Date:** 2026-08-21

## Context

The dashboard needed English and Japanese. The reflex is an i18n framework
(next-intl, i18next): extraction, interpolation, plurals, lazy loading.

This application renders two locales in server components. There is no client
bundle of translations to ship, no runtime switching to coordinate, and the
genuinely hard parts — currency, number, date and relative-time formatting per
locale — are already built into the platform as `Intl`.

## Decision

Two TypeScript dictionaries. English defines the shape; the Japanese object is
typed against it, so a missing translation is a compile error naming the key.
Formatting goes through `Intl` with the BCP 47 tag for the active locale.
Locale negotiation happens once, in the proxy, and is attached to the request.

## Consequences

No dependency, no extraction step, and the strongest guarantee an i18n library
offers — "no missing translations" — enforced by the compiler instead of a
lint rule. Interpolated strings are plain functions, visible in the type.

The cost is real: this does not scale to ten locales or to translator-managed
content, and plural rules beyond en/ja's simple cases would need `Intl.PluralRules`
handled by hand. If locale count grows, the dictionaries are already shaped like
the JSON an i18n library would consume — the migration is mechanical.

One trap is worth recording: the English dictionary must NOT be `as const`.
Literal types would make every English string the only assignable value, and no
translation could satisfy the type. Structure is enforced; wording is free.
