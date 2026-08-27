Feature: The ledger honours its pagination
  Regression coverage for a live defect found by the first human run of the
  QA MCP server on 2026-08-27: the transactions endpoint accepted limit and
  offset, ignored both, and returned the full window while reporting success.

  Scenario: A requested limit is honoured and echoed
    When the transactions ledger is read with a limit of 5
    Then exactly 5 transactions are returned
    And the response meta echoes a limit of 5

  Scenario: Consecutive pages do not overlap
    When the transactions ledger is read with a limit of 3 and an offset of 0
    And the transactions ledger is read with a limit of 3 and an offset of 3
    Then the two pages share no transaction ids
