-- =============================================================================
-- Chat message reactions
-- =============================================================================
-- One row per (message, user, emoji). The unique constraint makes a reaction a
-- toggle: adding the same emoji twice is a no-op the client turns into a
-- delete, and it stops a double-click from double-counting.
--
-- Reading is gated by the same can_access_channel() rule the messages use, so
-- reactions can never leak from a channel the caller can't read. Users manage
-- only their OWN reactions (removing someone else's is not a thing).
-- =============================================================================

create table if not exists public.chat_message_reactions (
    id         uuid                     default gen_random_uuid() not null,
    message_id uuid                                               not null,
    user_id    uuid                                               not null,
    emoji      text                                               not null,
    created_at timestamp with time zone default current_timestamp not null,
    constraint chat_message_reactions_pk primary key (id),
    constraint chat_message_reactions_message_fk
        foreign key (message_id) references public.chat_messages (id) on delete cascade,
    constraint chat_message_reactions_user_fk
        foreign key (user_id) references public.users (id) on delete cascade,
    constraint chat_message_reactions_unique unique (message_id, user_id, emoji),
    -- Emoji are short; the cap stops the column being used as free text.
    constraint chat_message_reactions_emoji_check
        check (char_length(emoji) between 1 and 16)
);

create index if not exists chat_message_reactions_message_index
    on public.chat_message_reactions (message_id);

alter table public.chat_message_reactions enable row level security;

drop policy if exists chat_message_reactions_select on public.chat_message_reactions;
create policy chat_message_reactions_select on public.chat_message_reactions
    for select to authenticated
    using (
        public.can_access_channel(
            (select m.channel_id from public.chat_messages m where m.id = message_id)
        )
    );

drop policy if exists chat_message_reactions_insert on public.chat_message_reactions;
create policy chat_message_reactions_insert on public.chat_message_reactions
    for insert to authenticated
    with check (
        user_id = auth.uid()
        and public.can_access_channel(
            (select m.channel_id from public.chat_messages m where m.id = message_id)
        )
    );

drop policy if exists chat_message_reactions_delete on public.chat_message_reactions;
create policy chat_message_reactions_delete on public.chat_message_reactions
    for delete to authenticated
    using (user_id = auth.uid());

revoke all on public.chat_message_reactions from public, anon;
grant select, insert, delete on public.chat_message_reactions to authenticated;
grant all on public.chat_message_reactions to service_role;

-- Realtime: reactions should appear for everyone watching the channel.
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'chat_message_reactions'
    ) then
        alter publication supabase_realtime add table public.chat_message_reactions;
    end if;
end
$$;
