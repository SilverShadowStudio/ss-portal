-- Full LLM parse payload for EVERY debrief (not only needs_review ones), so
-- accepted-and-wrong parses can be audited later and the auto-apply confidence
-- threshold (currently a guess at 0.75) can be tuned against real data.
-- Nullable: a manually-created interaction has no parse.
alter table public.interactions
  add column if not exists parse_json jsonb;

-- Partial index: the review queue only ever asks for the flagged ones.
create index if not exists interactions_needs_review_idx
  on public.interactions ((parse_json -> 'needs_review'))
  where parse_json is not null;
