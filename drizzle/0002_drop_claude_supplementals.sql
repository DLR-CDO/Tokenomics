-- Claude Enterprise v2 cleanup: drop the orphaned manual receipt ledger.
--
-- Background: prior to v2, supplemental_purchases_claude_enterprise stored
-- manually-entered receipts for Anthropic Prepaid Extra Usage credit-pack
-- purchases. The v2 redesign makes the Anthropic Analytics API the single
-- source of truth for extras consumption, so those receipts would now
-- double-count (the API reports the same dollars as consumption).
--
-- The v2 application code no longer reads this key for any source. This
-- migration removes the residual data so it can't be accidentally resurrected
-- by a future change to SupplementalPurchasesCard.
--
-- Idempotent: a no-op if the row was never written or has already been
-- deleted.

DELETE FROM "dashboard_settings"
WHERE "key" = 'supplemental_purchases_claude_enterprise';
