-- ---------------------------------------------------------------------------
-- Sales enums — the `archived` opportunity state.
--
-- Alone in its own file for the same reason 20260806000100 is: a label added
-- by `alter type … add value` cannot be *used* until the transaction that
-- added it commits, and each migration file runs as one implicit transaction.
-- ---------------------------------------------------------------------------

alter type public.pipeline_card_status add value if not exists 'archived';
