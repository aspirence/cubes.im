-- Seed demo Spaces (project folders) + favorites for the Projects
-- tree, in the demo (Acme) team.  psql "$SUPABASE_DB_URL" -f scripts/seed-projects-spaces.sql
do $$
declare
  tid uuid; uid uuid; f_client uuid; f_internal uuid; pids uuid[];
begin
  select active_team into tid from users where email='demo@cubes.test';
  select id into uid from users where email='demo@cubes.test';
  update projects set folder_id=null where team_id=tid;
  delete from project_folders where team_id=tid;
  delete from favorite_projects where user_id=uid;

  insert into project_folders (name, key, color_code, team_id, created_by)
    values ('Client Work','CLW','#5a5ad6', tid, uid) returning id into f_client;
  insert into project_folders (name, key, color_code, team_id, created_by)
    values ('Internal','INT','#3a9d6e', tid, uid) returning id into f_internal;

  select array_agg(id order by name) into pids from projects where team_id=tid;
  if array_length(pids,1) >= 1 then update projects set folder_id=f_client   where id=pids[1]; end if;
  if array_length(pids,1) >= 2 then update projects set folder_id=f_client   where id=pids[2]; end if;
  if array_length(pids,1) >= 3 then update projects set folder_id=f_client   where id=pids[3]; end if;
  if array_length(pids,1) >= 4 then update projects set folder_id=f_internal where id=pids[4]; end if;
  if array_length(pids,1) >= 5 then update projects set folder_id=f_internal where id=pids[5]; end if;

  if array_length(pids,1) >= 1 then insert into favorite_projects (user_id, project_id) values (uid, pids[1]) on conflict do nothing; end if;
  if array_length(pids,1) >= 4 then insert into favorite_projects (user_id, project_id) values (uid, pids[4]) on conflict do nothing; end if;
end $$;
