-- =============================================================================
-- Chat — notify recipients of new messages (bell + Inbox + Web Push).
-- =============================================================================
-- A new chat message notifies every OTHER member of the channel (DMs, private
-- and joined public channels alike). Notifications are COALESCED per (user,
-- channel): the first unread message inserts a notification (which fires push);
-- follow-up messages just refresh that same row, so the bell shows one entry
-- per conversation and push doesn't spam. Opening the channel (marking it read)
-- clears the row automatically.

/* ------------------------------------------------------- new message */

create or replace function public.chat_messages_notify()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
as
$$
declare
    ch        public.chat_channels;
    v_sender  text;
    v_flat    text;
    v_snippet text;
    v_msg     text;
    v_url     text;
    v_count   integer;
    r record;
begin
    select * into ch from public.chat_channels where id = new.channel_id;
    if ch.id is null then
        return new;
    end if;

    select name into v_sender from public.users where id = new.user_id;
    v_sender := coalesce(v_sender, 'Someone');

    -- Single-line, trimmed snippet of the message body.
    v_flat := btrim(regexp_replace(new.body, '\s+', ' ', 'g'));
    v_snippet := left(v_flat, 90);
    if char_length(v_flat) > 90 then
        v_snippet := v_snippet || '…';
    end if;

    if ch.kind = 'dm' then
        v_msg := v_sender || ': ' || v_snippet;
    else
        v_msg := v_sender || ' in #' || coalesce(ch.name, 'channel') || ': ' || v_snippet;
    end if;
    v_url := '/chat/' || new.channel_id::text;

    for r in
        select user_id
        from public.chat_channel_members
        where channel_id = new.channel_id
          and user_id <> new.user_id
    loop
        -- Refresh an existing unread notification for this channel; only insert
        -- a fresh one (and thus fire push) when there isn't one already.
        update public.user_notifications
           set message = v_msg, created_at = current_timestamp, read = false
         where user_id = r.user_id
           and type = 'chat_message'
           and url = v_url
           and read = false;
        get diagnostics v_count = row_count;

        if v_count = 0 then
            perform public.create_notification(
                r.user_id, v_msg, 'chat_message', v_url, ch.team_id, null, null);
        end if;
    end loop;

    return new;
end;
$$;

drop trigger if exists chat_messages_notify_trg on public.chat_messages;
create trigger chat_messages_notify_trg
    after insert on public.chat_messages
    for each row execute function public.chat_messages_notify();

/* ------------------------------------- clear on read (open the channel) */

create or replace function public.chat_read_clear_notifications()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
as
$$
begin
    update public.user_notifications
       set read = true
     where user_id = new.user_id
       and type = 'chat_message'
       and url = '/chat/' || new.channel_id::text
       and read = false;
    return new;
end;
$$;

drop trigger if exists chat_read_clear_notifications_trg on public.chat_channel_members;
create trigger chat_read_clear_notifications_trg
    after insert or update of last_read_at on public.chat_channel_members
    for each row execute function public.chat_read_clear_notifications();
