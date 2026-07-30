-- =============================================================================
-- Docs are single-per-project (auto-generated) — enforce one doc per project.
-- =============================================================================
-- The product decision: every project has exactly ONE doc, created on demand;
-- users add PAGES within it, not more docs. Collapse any duplicates that were
-- created while multi-doc was allowed (keep the earliest per project; its pages
-- survive, the extras cascade away), then add the unique index so the app can
-- auto-create idempotently (insert races resolve to the single row).

delete from public.app_docs_docs d
    using public.app_docs_docs keep
    where d.project_id = keep.project_id
      and (
          keep.created_at < d.created_at
          or (keep.created_at = d.created_at and keep.id < d.id)
      );

create unique index if not exists app_docs_docs_project_unique
    on public.app_docs_docs (project_id);
