-- =============================================================================
-- get_client_portal v2 — surface the new portal presentation fields plus
-- reviews, invoices and the client's own requests, so the redesigned public
-- portal can render everything from one anonymous read.
-- =============================================================================

create or replace function public.get_client_portal(p_token uuid)
    returns json
    language sql
    stable
    security definer
    set search_path = public
as
$$
    select json_build_object(
        'portal', json_build_object(
            'title',          pp.title,
            'intro',          pp.intro,
            'accent',         pp.accent,
            'logo_url',       pp.logo_url,
            'template',       pp.template,
            'show_tasks',     pp.show_tasks,
            'show_progress',  pp.show_progress,
            'show_reviews',   pp.show_reviews,
            'show_billing',   pp.show_billing,
            'allow_requests', pp.allow_requests,
            'client_name',    c.name,
            'updated_at',     pp.updated_at
        ),
        'projects', coalesce(
            (
                select json_agg(
                    json_build_object(
                        'name',         p.name,
                        'color_code',   p.color_code,
                        'notes',        p.notes,
                        'start_date',   p.start_date,
                        'end_date',     p.end_date,
                        'status',       ps.name,
                        'status_color', ps.color_code,
                        'total_tasks',  coalesce(tk.total_tasks, 0),
                        'done_tasks',   coalesce(tk.done_tasks, 0),
                        'tasks', case when pp.show_tasks then coalesce(
                            (
                                select json_agg(
                                    json_build_object(
                                        'name',     t.name,
                                        'done',     t.done,
                                        'end_date', t.end_date,
                                        'priority', pr.name,
                                        'status',   ts.name,
                                        'status_color', tsc.color_code
                                    )
                                    order by t.sort_order
                                )
                                from public.tasks t
                                left join public.task_statuses ts on ts.id = t.status_id
                                left join public.sys_task_status_categories tsc on tsc.id = ts.category_id
                                left join public.task_priorities pr on pr.id = t.priority_id
                                where t.project_id = p.id
                                  and t.archived = false
                                  and t.parent_task_id is null
                            ),
                            '[]'::json
                        ) else '[]'::json end
                    )
                    order by cpp.sort_order
                )
                from public.app_client_portal_projects cpp
                join public.projects p on p.id = cpp.project_id
                left join public.sys_project_statuses ps on ps.id = p.status_id
                left join lateral (
                    select count(*)                               as total_tasks,
                           count(*) filter (where t2.done is true) as done_tasks
                    from public.tasks t2
                    where t2.project_id = p.id
                      and t2.archived = false
                      and t2.parent_task_id is null
                ) tk on true
                where cpp.portal_id = pp.id
            ),
            '[]'::json
        ),
        'reviews', case when pp.show_reviews then coalesce(
            (
                select json_agg(
                    json_build_object(
                        'title',        v.title,
                        'status',       v.status,
                        'project_name', p2.name,
                        'revision',     v.latest_revision,
                        'updated_at',   v.updated_at
                    )
                    order by v.updated_at desc
                )
                from public.app_video_review_videos v
                join public.app_client_portal_projects cpp2 on cpp2.project_id = v.project_id
                join public.projects p2 on p2.id = v.project_id
                where cpp2.portal_id = pp.id
                  and v.deleted = false
            ),
            '[]'::json
        ) else '[]'::json end,
        'invoices', case when pp.show_billing then coalesce(
            (
                select json_agg(
                    json_build_object(
                        'number',       i.number,
                        'title',        i.title,
                        'amount_cents', i.amount_cents,
                        'currency',     i.currency,
                        'status',       i.status,
                        'issued_on',    i.issued_on,
                        'due_on',       i.due_on,
                        'note',         i.note
                    )
                    order by i.created_at desc
                )
                from public.app_client_portal_invoices i
                where i.portal_id = pp.id
            ),
            '[]'::json
        ) else '[]'::json end,
        'requests', coalesce(
            (
                select json_agg(
                    json_build_object(
                        'title',      r.title,
                        'details',    r.details,
                        'priority',   r.priority,
                        'status',     r.status,
                        'created_at', r.created_at
                    )
                    order by r.created_at desc
                )
                from public.app_client_portal_requests r
                where r.portal_id = pp.id
            ),
            '[]'::json
        ),
        'updates', coalesce(
            (
                select json_agg(
                    json_build_object(
                        'title',      u.title,
                        'body',       u.body,
                        'created_at', u.created_at
                    )
                    order by u.created_at desc
                )
                from public.app_client_portal_updates u
                where u.portal_id = pp.id
            ),
            '[]'::json
        )
    )
    from public.app_client_portal_portals pp
    join public.clients c on c.id = pp.client_id
    where pp.share_token = p_token
      and pp.status = 'live';
$$;

revoke all on function public.get_client_portal(uuid) from public;
grant execute on function public.get_client_portal(uuid) to anon, authenticated;
