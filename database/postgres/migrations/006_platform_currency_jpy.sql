-- The platform's currency is now JPY.
--
-- Metrics, the customers ledger and checkout are all scoped to one platform
-- currency, so rows recorded while it was USD would otherwise become invisible
-- to every aggregate forever. These are sandbox rows — no real funds ever
-- moved — so they are relabelled into the new platform currency rather than
-- orphaned: amount_minor is kept verbatim and only the label changes. JPY is
-- zero-decimal (one minor unit = one yen), so historic amounts stay plausible
-- sandbox figures.
--
-- Deliberately scoped to USD alone: integration suites seed GBP and EUR rows
-- precisely so they stay invisible to platform-currency aggregates, and this
-- migration must not promote them.

UPDATE payments SET currency = 'JPY' WHERE currency = 'USD';
UPDATE transactions SET currency = 'JPY' WHERE currency = 'USD';
