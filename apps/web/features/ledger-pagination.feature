Feature: The ledger honours its pagination
  Regression coverage for a live defect found by the first human run of the
  QA MCP server on 2026-08-27: the transactions endpoint accepted limit and
  offset, ignored both, and returned the full window while reporting success.

  The endpoint returns the latest event per payment — DISTINCT ON (payments.id),
  which is what the dashboard's "recent transactions" table shows — so its depth
  is the number of seeded payments, four, and not the number of events. These
  limits stay under that on purpose: a scenario that asks for more rows than can
  exist passes only on a database some earlier run left dirty, which is exactly
  how the first version of this file went green locally and red in CI.

  Scenario: A requested limit is honoured and echoed
    When the transactions ledger is read with a limit of 3
    Then exactly 3 transactions are returned
    And the response meta echoes a limit of 3

  Scenario: Consecutive pages do not overlap
    When the transactions ledger is read with a limit of 2 and an offset of 0
    And the transactions ledger is read with a limit of 2 and an offset of 2
    Then the two pages share no transaction ids
