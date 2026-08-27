Feature: Yen is a zero-decimal currency
  One minor unit is one yen. There is no hundredth to divide by, so any code
  path that assumes cents corrupts real amounts by a factor of one hundred.
  This platform learned that during its yen conversion: a test asserting
  "17.35" was not a rounding preference but a defect that would have moved
  the wrong amount of money.

  Scenario: The ledger stores whole yen, never fractions
    When the transactions ledger is read from the API
    Then every amount is a whole number of minor units
    And every currency is "JPY"

  Scenario: The dashboard renders yen without decimals
    When a visitor opens the dashboard
    Then every yen amount on the page is shown without a decimal fraction
