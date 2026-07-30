-- =============================================================================
-- Chat attachments — images/files shared in channels and DMs
-- =============================================================================
-- chat_messages gains `attachments`: a JSONB array of
--   { url, name, type, size }
-- objects pointing at already-uploaded storage objects (the client uploads to
-- the public bucket first, exactly like inline task-description images, then
-- sends the message referencing the resulting public URLs).
--
-- The body CHECK is relaxed accordingly: a message may now have an EMPTY body
-- as long as it carries at least one attachment (an image-only message), but a
-- message with neither body nor attachments is still rejected.
-- =============================================================================

alter table public.chat_messages
    add column if not exists attachments jsonb not null default '[]'::jsonb;

alter table public.chat_messages
    drop constraint if exists chat_messages_body_check;

alter table public.chat_messages
    add constraint chat_messages_body_check
    check (char_length(body) <= 4000);

alter table public.chat_messages
    drop constraint if exists chat_messages_attachments_is_array;
alter table public.chat_messages
    add constraint chat_messages_attachments_is_array
    check (jsonb_typeof(attachments) = 'array');

-- Something must be said or shown.
alter table public.chat_messages
    drop constraint if exists chat_messages_not_empty;
alter table public.chat_messages
    add constraint chat_messages_not_empty
    check (char_length(btrim(body)) > 0 or jsonb_array_length(attachments) > 0);

-- Cap the array so a crafted client can't stuff a message with thousands of
-- entries (the composer allows a handful).
alter table public.chat_messages
    drop constraint if exists chat_messages_attachments_max;
alter table public.chat_messages
    add constraint chat_messages_attachments_max
    check (jsonb_array_length(attachments) <= 10);
