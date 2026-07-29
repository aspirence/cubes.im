-- =============================================================================
-- Cubes chat — RLS test (chat_*)
-- =============================================================================
-- Self-contained, plain-SQL test (no pgTAP), mirroring the crm_rls.sql pattern.
-- Proves the chat access model after the chat_v2 migration:
--   (a) can_access_channel: a public channel is visible to team members and
--       invisible to another tenant; a private channel only to its roster.
--   (b) create_group_dm: a member can start a group with 2 others; a guest and
--       a non-member are blocked; guests don't count toward the roster.
--   (c) chat_saved_messages: a user can save a message they can access, cannot
--       save one they can't, and sees only their OWN saved rows.
--   (d) search_chat_messages: returns hits from accessible public channels and
--       NOTHING from a private channel the caller isn't in.
--   (e) set_message_pinned: a member with access can pin someone else's
--       message; an outsider is blocked.
--   (f) mute: a muted member receives NO user_notification for a new channel
--       message while an unmuted member does.
--
-- HOW TO RUN (against the local Supabase db container):
--   docker exec -i supabase_db_cubes_local psql -U postgres \
--       -v ON_ERROR_STOP=1 < supabase/tests/chat_rls.sql
--
-- Runs in one transaction and ROLLS BACK — leaves no data behind.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Fixture (runs as postgres -> RLS bypassed). The auth trigger provisions each
-- tenant. Alice OWNS team A. Bob + Carol join as NON-admin members, Erin joins
-- as a GUEST. Dave is a separate tenant.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_team uuid;
begin
    insert into auth.users (id, instance_id, aud, role, email)
    values
        ('aa111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'alice-chat@example.com'),
        ('bb222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'bob-chat@example.com'),
        ('cc333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'carol-chat@example.com'),
        ('dd444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'dave-chat@example.com'),
        ('ee555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', 'erin-chat@example.com');

    select id into _alice_team from public.teams
        where user_id = 'aa111111-1111-1111-1111-111111111111';

    insert into public.team_members (user_id, team_id, role_id, active)
    select 'bb222222-2222-2222-2222-222222222222', _alice_team, r.id, true
    from public.roles r
    where r.team_id = _alice_team and r.default_role = true;

    insert into public.team_members (user_id, team_id, role_id, active)
    select 'cc333333-3333-3333-3333-333333333333', _alice_team, r.id, true
    from public.roles r
    where r.team_id = _alice_team and r.default_role = true;

    insert into public.team_members (user_id, team_id, role_id, active, member_type)
    select 'ee555555-5555-5555-5555-555555555555', _alice_team, r.id, true, 'guest'
    from public.roles r
    where r.team_id = _alice_team and r.default_role = true;
end
$$;

-- -----------------------------------------------------------------------------
-- Fixture 2: Alice (team owner -> is_team_admin) creates one PUBLIC channel
-- ('general') and one PRIVATE channel ('secret', roster: Alice + Bob), and
-- posts one message into each (distinct needles for the search test).
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_team uuid;
    _pub  uuid;
    _priv uuid;
begin
    select id into _alice_team from public.teams
        where user_id = 'aa111111-1111-1111-1111-111111111111';

    perform set_config('request.jwt.claims',
        '{"sub":"aa111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _pub := public.create_chat_channel(
        _alice_team, 'general', null, false, '{}'::uuid[]);
    _priv := public.create_chat_channel(
        _alice_team, 'secret', null, true,
        array['bb222222-2222-2222-2222-222222222222']::uuid[]);
    insert into public.chat_messages (channel_id, user_id, body)
    values (_pub, 'aa111111-1111-1111-1111-111111111111',
            'hello world needle-public-chatrls');
    insert into public.chat_messages (channel_id, user_id, body)
    values (_priv, 'aa111111-1111-1111-1111-111111111111',
            'classified needle-private-chatrls');
    execute 'reset role';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (a): can_access_channel — Bob (member) sees the public channel AND the
--   private one (he's on the roster); Carol (member, not on the roster) is
--   locked out of the private one; Dave (other tenant) can't see the public one.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_team uuid;
    _pub  uuid;
    _priv uuid;
    _bob_pub boolean; _bob_priv boolean; _carol_priv boolean; _dave_pub boolean;
begin
    select id into _alice_team from public.teams
        where user_id = 'aa111111-1111-1111-1111-111111111111';
    select id into _pub from public.chat_channels
        where team_id = _alice_team and name = 'general';
    select id into _priv from public.chat_channels
        where team_id = _alice_team and name = 'secret';

    perform set_config('request.jwt.claims',
        '{"sub":"bb222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _bob_pub := public.can_access_channel(_pub);
    _bob_priv := public.can_access_channel(_priv);
    execute 'reset role';

    perform set_config('request.jwt.claims',
        '{"sub":"cc333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _carol_priv := public.can_access_channel(_priv);
    execute 'reset role';

    perform set_config('request.jwt.claims',
        '{"sub":"dd444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _dave_pub := public.can_access_channel(_pub);
    execute 'reset role';

    if _bob_pub is not true then
        raise exception 'TEST (a) FAILED: a team member cannot access a public channel';
    end if;
    if _bob_priv is not true then
        raise exception 'TEST (a) FAILED: a private-channel roster member was locked out';
    end if;
    if _carol_priv is not false then
        raise exception 'TEST (a) FAILED: a non-roster member can access a private channel';
    end if;
    if _dave_pub is not false then
        raise exception 'TEST (a) FAILED: another tenant can access a public channel';
    end if;

    raise notice 'TEST (a) PASSED: can_access_channel gates public by team, private by roster';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (b): create_group_dm — Bob starts a group with Alice + Carol (3 people
--   total). Dave (non-member) is blocked. Erin (guest) is blocked as a caller,
--   and guests don't count toward the 2-other-members minimum.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_team uuid;
    _gid uuid;
    _members int;
    _blocked boolean;
begin
    select id into _alice_team from public.teams
        where user_id = 'aa111111-1111-1111-1111-111111111111';

    -- Bob (member) creates a group with 2 other members.
    perform set_config('request.jwt.claims',
        '{"sub":"bb222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _gid := public.create_group_dm(_alice_team,
        array['aa111111-1111-1111-1111-111111111111',
              'cc333333-3333-3333-3333-333333333333']::uuid[]);
    execute 'reset role';
    _members := (select count(*) from public.chat_channel_members
                 where channel_id = _gid);
    if _members <> 3 then
        raise exception 'TEST (b) FAILED: expected a 3-person group, got % members', _members;
    end if;

    -- Dave (non-member) must be blocked.
    perform set_config('request.jwt.claims',
        '{"sub":"dd444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _blocked := false;
    begin
        perform public.create_group_dm(_alice_team,
            array['aa111111-1111-1111-1111-111111111111',
                  'bb222222-2222-2222-2222-222222222222']::uuid[]);
    exception when others then _blocked := true;
    end;
    execute 'reset role';
    if not _blocked then
        raise exception 'TEST (b) FAILED: a non-member was allowed to create a group DM';
    end if;

    -- Erin (guest) must be blocked as a caller (guests are not team members).
    perform set_config('request.jwt.claims',
        '{"sub":"ee555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _blocked := false;
    begin
        perform public.create_group_dm(_alice_team,
            array['aa111111-1111-1111-1111-111111111111',
                  'bb222222-2222-2222-2222-222222222222']::uuid[]);
    exception when others then _blocked := true;
    end;
    execute 'reset role';
    if not _blocked then
        raise exception 'TEST (b) FAILED: a guest was allowed to create a group DM';
    end if;

    -- Guests don't count toward the roster: Alice + [Erin(guest), Bob] leaves
    -- only 1 valid other member -> refused.
    perform set_config('request.jwt.claims',
        '{"sub":"aa111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _blocked := false;
    begin
        perform public.create_group_dm(_alice_team,
            array['ee555555-5555-5555-5555-555555555555',
                  'bb222222-2222-2222-2222-222222222222']::uuid[]);
    exception when others then _blocked := true;
    end;
    execute 'reset role';
    if not _blocked then
        raise exception 'TEST (b) FAILED: a guest counted toward the group roster';
    end if;

    raise notice 'TEST (b) PASSED: members create group DMs; guests and non-members are blocked';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (c): saved messages — Bob saves the private message (he has access);
--   Carol cannot save it (no access -> RLS refuses); Carol saves the public
--   one and sees ONLY her own saved row.
-- -----------------------------------------------------------------------------
do $$
declare
    _pub_msg  uuid;
    _priv_msg uuid;
    _rows int;
    _blocked boolean;
begin
    select id into _pub_msg from public.chat_messages
        where body like '%needle-public-chatrls%' limit 1;
    select id into _priv_msg from public.chat_messages
        where body like '%needle-private-chatrls%' limit 1;

    -- Bob (roster member of the private channel) saves the private message.
    perform set_config('request.jwt.claims',
        '{"sub":"bb222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.chat_saved_messages (user_id, message_id)
    values ('bb222222-2222-2222-2222-222222222222', _priv_msg);
    execute 'reset role';

    -- Carol must NOT be able to save a message she can't access.
    perform set_config('request.jwt.claims',
        '{"sub":"cc333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _blocked := false;
    begin
        insert into public.chat_saved_messages (user_id, message_id)
        values ('cc333333-3333-3333-3333-333333333333', _priv_msg);
    exception when insufficient_privilege then _blocked := true;
    end;
    if not _blocked then
        execute 'reset role';
        raise exception 'TEST (c) FAILED: a user saved a message they cannot access';
    end if;

    -- Carol saves the public message and sees only her OWN saved rows
    -- (Bob's row from above must stay invisible).
    insert into public.chat_saved_messages (user_id, message_id)
    values ('cc333333-3333-3333-3333-333333333333', _pub_msg);
    _rows := (select count(*) from public.chat_saved_messages);
    execute 'reset role';
    if _rows <> 1 then
        raise exception 'TEST (c) FAILED: expected Carol to see exactly 1 saved row, got %', _rows;
    end if;

    raise notice 'TEST (c) PASSED: saved messages honor access and stay per-user';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (d): search_chat_messages — Carol finds the public needle but NOT the
--   private one; Bob (roster member) does find the private one.
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_team uuid;
    _carol_pub int; _carol_priv int; _bob_priv int;
begin
    select id into _alice_team from public.teams
        where user_id = 'aa111111-1111-1111-1111-111111111111';

    perform set_config('request.jwt.claims',
        '{"sub":"cc333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _carol_pub := (select count(*)
        from public.search_chat_messages(_alice_team, 'needle-public-chatrls', 10));
    _carol_priv := (select count(*)
        from public.search_chat_messages(_alice_team, 'needle-private-chatrls', 10));
    execute 'reset role';

    perform set_config('request.jwt.claims',
        '{"sub":"bb222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _bob_priv := (select count(*)
        from public.search_chat_messages(_alice_team, 'needle-private-chatrls', 10));
    execute 'reset role';

    if _carol_pub <> 1 then
        raise exception 'TEST (d) FAILED: expected 1 public search hit for a member, got %', _carol_pub;
    end if;
    if _carol_priv <> 0 then
        raise exception 'TEST (d) FAILED: search leaked % private-channel hit(s) to a non-roster member', _carol_priv;
    end if;
    if _bob_priv <> 1 then
        raise exception 'TEST (d) FAILED: expected 1 private hit for a roster member, got %', _bob_priv;
    end if;

    raise notice 'TEST (d) PASSED: search is scoped by can_access_channel per row';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (e): set_message_pinned — Bob (member with access) pins ALICE's public
--   message; Dave (other tenant) is blocked.
-- -----------------------------------------------------------------------------
do $$
declare
    _pub_msg uuid;
    _pinned timestamp with time zone;
    _blocked boolean;
begin
    select id into _pub_msg from public.chat_messages
        where body like '%needle-public-chatrls%' limit 1;

    perform set_config('request.jwt.claims',
        '{"sub":"bb222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    perform public.set_message_pinned(_pub_msg, true);
    execute 'reset role';
    select pinned_at into _pinned from public.chat_messages where id = _pub_msg;
    if _pinned is null then
        raise exception 'TEST (e) FAILED: a member could not pin another member''s message';
    end if;

    perform set_config('request.jwt.claims',
        '{"sub":"dd444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
    execute 'set local role authenticated';
    _blocked := false;
    begin
        perform public.set_message_pinned(_pub_msg, false);
    exception when others then _blocked := true;
    end;
    execute 'reset role';
    if not _blocked then
        raise exception 'TEST (e) FAILED: an outsider was allowed to pin/unpin';
    end if;

    raise notice 'TEST (e) PASSED: pinning requires channel access; outsiders are blocked';
end
$$;

-- -----------------------------------------------------------------------------
-- TEST (f): mute — Bob and Carol join #general; Bob mutes it. A new message
--   from Alice notifies Carol (unmuted) and NOT Bob (muted).
-- -----------------------------------------------------------------------------
do $$
declare
    _alice_team uuid;
    _pub uuid;
    _bob_n int; _carol_n int;
begin
    select id into _alice_team from public.teams
        where user_id = 'aa111111-1111-1111-1111-111111111111';
    select id into _pub from public.chat_channels
        where team_id = _alice_team and name = 'general';

    -- Bob joins and mutes (own-row insert + update, both RLS-allowed).
    perform set_config('request.jwt.claims',
        '{"sub":"bb222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.chat_channel_members (channel_id, user_id)
    values (_pub, 'bb222222-2222-2222-2222-222222222222')
    on conflict (channel_id, user_id) do nothing;
    update public.chat_channel_members
       set muted_at = current_timestamp
     where channel_id = _pub
       and user_id = 'bb222222-2222-2222-2222-222222222222';
    execute 'reset role';

    -- Carol joins, unmuted.
    perform set_config('request.jwt.claims',
        '{"sub":"cc333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.chat_channel_members (channel_id, user_id)
    values (_pub, 'cc333333-3333-3333-3333-333333333333')
    on conflict (channel_id, user_id) do nothing;
    execute 'reset role';

    -- Clean slate (as postgres), then Alice posts.
    delete from public.user_notifications where type = 'chat_message';

    perform set_config('request.jwt.claims',
        '{"sub":"aa111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
    execute 'set local role authenticated';
    insert into public.chat_messages (channel_id, user_id, body)
    values (_pub, 'aa111111-1111-1111-1111-111111111111', 'ping after mute');
    execute 'reset role';

    _bob_n := (select count(*) from public.user_notifications
               where user_id = 'bb222222-2222-2222-2222-222222222222'
                 and type = 'chat_message'
                 and url = '/chat/' || _pub::text);
    _carol_n := (select count(*) from public.user_notifications
                 where user_id = 'cc333333-3333-3333-3333-333333333333'
                   and type = 'chat_message'
                   and url = '/chat/' || _pub::text);

    if _carol_n <> 1 then
        raise exception 'TEST (f) FAILED: expected 1 notification for the unmuted member, got %', _carol_n;
    end if;
    if _bob_n <> 0 then
        raise exception 'TEST (f) FAILED: a muted member received % notification(s)', _bob_n;
    end if;

    raise notice 'TEST (f) PASSED: muted members receive no chat notifications; unmuted members do';
end
$$;

rollback;
