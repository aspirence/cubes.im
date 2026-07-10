"use client";

import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/* ------------------------------------------------------------------- types */

export interface PortalTask {
  name: string;
  done: boolean;
  end_date: string | null;
  priority: string | null;
  status: string | null;
  status_color: string | null;
}
export interface PortalProject {
  name: string;
  color_code: string | null;
  notes: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string | null;
  status_color: string | null;
  total_tasks: number;
  done_tasks: number;
  tasks: PortalTask[];
}
export interface PortalReview {
  title: string;
  status: string;
  project_name: string | null;
  revision: number;
  updated_at: string;
}
export interface PortalInvoice {
  number: string;
  title: string | null;
  amount_cents: number;
  currency: string;
  status: string;
  issued_on: string | null;
  due_on: string | null;
  note: string | null;
}
export interface PortalRequest {
  title: string;
  details: string | null;
  priority: string;
  status: string;
  created_at: string;
}
export interface PortalUpdate {
  title: string;
  body: string | null;
  created_at: string;
}
export interface ClientPortalData {
  portal: {
    title: string;
    intro: string | null;
    accent: string;
    logo_url: string | null;
    template: "dashboard" | "sheet" | "board" | "timeline" | "minimal";
    show_tasks: boolean;
    show_progress: boolean;
    show_reviews: boolean;
    show_billing: boolean;
    allow_requests: boolean;
    client_name: string;
    updated_at: string;
  };
  projects: PortalProject[];
  reviews: PortalReview[];
  invoices: PortalInvoice[];
  requests: PortalRequest[];
  updates: PortalUpdate[];
}

/* --------------------------------------------------------------- helpers */

function MIcon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, color }}>
      {name}
    </span>
  );
}

function fmtDate(v: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtShort(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function money(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

const PRIORITY_COLOR: Record<string, string> = { high: "#e0655c", medium: "#d3a13a", low: "#4aa06b" };
const REVIEW_META: Record<string, { label: string; color: string }> = {
  in_review: { label: "In review", color: "#d3a13a" },
  approved: { label: "Approved", color: "#2f8f5f" },
  changes_requested: { label: "Changes requested", color: "#c0453c" },
  draft: { label: "Draft", color: "#8b90a4" },
};
const INVOICE_META: Record<string, { label: string; color: string }> = {
  paid: { label: "Paid", color: "#2f8f5f" },
  sent: { label: "Sent", color: "#3d7de0" },
  overdue: { label: "Overdue", color: "#c0453c" },
  draft: { label: "Draft", color: "#8b90a4" },
};
const REQUEST_META: Record<string, { label: string; color: string }> = {
  new: { label: "New", color: "#3d7de0" },
  accepted: { label: "Accepted", color: "#2f8f5f" },
  declined: { label: "Declined", color: "#c0453c" },
  done: { label: "Done", color: "#6a6d78" },
};

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11.5,
        fontWeight: 700,
        color,
        background: `${color}18`,
        padding: "2px 9px",
        borderRadius: 999,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: color }} />
      {label}
    </span>
  );
}

/* --------------------------------------------------------------- component */

export function PortalApp({ data, token }: { data: ClientPortalData; token: string }) {
  const { portal, projects, reviews, invoices, updates } = data;
  const accent = portal.accent || "#4a4ad0";

  const [tab, setTab] = useState<"work" | "reviews" | "billing" | "activity">("work");
  const [reqOpen, setReqOpen] = useState(false);
  const [localReqs, setLocalReqs] = useState<PortalRequest[]>(data.requests);

  // Flatten tasks across projects for the sheet / board / timeline views.
  const allTasks = useMemo(
    () =>
      projects.flatMap((p) => p.tasks.map((t) => ({ ...t, project: p.name, projectColor: p.color_code }))),
    [projects],
  );

  const stats = useMemo(() => {
    const total = projects.reduce((a, p) => a + p.total_tasks, 0);
    const done = projects.reduce((a, p) => a + p.done_tasks, 0);
    const openReviews = reviews.filter((r) => r.status !== "approved").length;
    return { projects: projects.length, total, done, openReviews, pct: total ? Math.round((done / total) * 100) : 0 };
  }, [projects, reviews]);

  const outstanding = useMemo(
    () => invoices.filter((i) => i.status !== "paid").reduce((a, i) => a + i.amount_cents, 0),
    [invoices],
  );

  const tabs = [
    { key: "work" as const, label: "Work", icon: "grid_view", show: true },
    { key: "reviews" as const, label: "Reviews", icon: "movie", show: portal.show_reviews, badge: reviews.length },
    { key: "billing" as const, label: "Billing", icon: "receipt_long", show: portal.show_billing, badge: invoices.length },
    { key: "activity" as const, label: "Activity", icon: "notifications", show: true, badge: updates.length + localReqs.length },
  ].filter((t) => t.show);

  return (
    <div className="pt-root">
      <style>{css(accent)}</style>

      {/* Header */}
      <header className="pt-header">
        <div className="pt-header-inner">
          <div className="pt-brand">
            {portal.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={portal.logo_url} alt="" className="pt-logo" />
            ) : (
              <span className="pt-logo pt-logo-fallback">{initials(portal.client_name || portal.title)}</span>
            )}
            <div>
              <div className="pt-client">{portal.client_name}</div>
              <div className="pt-title">{portal.title}</div>
            </div>
          </div>
          {portal.allow_requests ? (
            <button className="pt-btn primary" onClick={() => setReqOpen(true)}>
              <MIcon name="add" size={18} /> Request work
            </button>
          ) : null}
        </div>
        {portal.intro ? <p className="pt-intro">{portal.intro}</p> : null}

        {/* Nav */}
        <nav className="pt-nav">
          {tabs.map((t) => (
            <button key={t.key} className={`pt-tab${tab === t.key ? " on" : ""}`} onClick={() => setTab(t.key)}>
              <MIcon name={t.icon} size={17} /> {t.label}
              {"badge" in t && t.badge ? <span className="pt-badge">{t.badge}</span> : null}
            </button>
          ))}
        </nav>
      </header>

      <main className="pt-main">
        {tab === "work" ? (
          <WorkView portal={portal} projects={projects} allTasks={allTasks} stats={stats} />
        ) : null}
        {tab === "reviews" ? <ReviewsView reviews={reviews} /> : null}
        {tab === "billing" ? <BillingView invoices={invoices} outstanding={outstanding} /> : null}
        {tab === "activity" ? <ActivityView updates={updates} requests={localReqs} /> : null}
      </main>

      <footer className="pt-footer">
        <span>Read-only client portal · powered by <b>Cubes</b></span>
        {portal.updated_at ? <span>Updated {fmtDate(portal.updated_at)}</span> : null}
      </footer>

      {reqOpen ? (
        <RequestModal
          token={token}
          accent={accent}
          onClose={() => setReqOpen(false)}
          onSubmitted={(r) => setLocalReqs((prev) => [r, ...prev])}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- WORK view */

function WorkView({
  portal,
  projects,
  allTasks,
  stats,
}: {
  portal: ClientPortalData["portal"];
  projects: PortalProject[];
  allTasks: (PortalTask & { project: string; projectColor: string | null })[];
  stats: { projects: number; total: number; done: number; openReviews: number; pct: number };
}) {
  return (
    <>
      {/* Stat row */}
      <div className="pt-stats">
        {[
          { label: "Projects", value: stats.projects, icon: "folder" },
          { label: "Tasks", value: stats.total, icon: "task_alt" },
          { label: "Completed", value: stats.done, icon: "check_circle" },
          { label: "Progress", value: `${stats.pct}%`, icon: "trending_up" },
        ].map((s) => (
          <div key={s.label} className="pt-stat">
            <span className="pt-stat-icon"><MIcon name={s.icon} size={18} /></span>
            <div>
              <div className="pt-stat-v">{s.value}</div>
              <div className="pt-stat-l">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {projects.length === 0 ? (
        <Empty icon="folder_off" text="No projects have been shared yet." />
      ) : portal.template === "sheet" ? (
        <SheetView tasks={allTasks} />
      ) : portal.template === "board" ? (
        <BoardView tasks={allTasks} />
      ) : portal.template === "timeline" ? (
        <TimelineView tasks={allTasks} />
      ) : portal.template === "minimal" ? (
        <MinimalView projects={projects} showTasks={portal.show_tasks} />
      ) : (
        <DashboardView projects={projects} showProgress={portal.show_progress} showTasks={portal.show_tasks} />
      )}
    </>
  );
}

/* Dashboard template */
function DashboardView({ projects, showProgress, showTasks }: { projects: PortalProject[]; showProgress: boolean; showTasks: boolean }) {
  return (
    <div className="pt-grid">
      {projects.map((p) => {
        const pct = p.total_tasks ? Math.round((p.done_tasks / p.total_tasks) * 100) : 0;
        return (
          <div key={p.name} className="pt-card">
            <div className="pt-card-head">
              <span className="pt-dot" style={{ background: p.color_code ?? "#9aa0b4" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="pt-card-title">{p.name}</div>
                {p.start_date || p.end_date ? (
                  <div className="pt-muted">{fmtShort(p.start_date)} → {fmtShort(p.end_date)}</div>
                ) : null}
              </div>
              {p.status ? <Pill label={p.status} color={p.status_color ?? "#8b90a4"} /> : null}
            </div>
            {showProgress ? (
              <div className="pt-prog-wrap">
                <div className="pt-prog"><div className="pt-prog-fill" style={{ width: `${pct}%` }} /></div>
                <span className="pt-muted" style={{ flex: "none" }}>{p.done_tasks}/{p.total_tasks}</span>
              </div>
            ) : null}
            {p.notes ? <p className="pt-notes">{p.notes}</p> : null}
            {showTasks && p.tasks.length ? (
              <div className="pt-tasklist">
                {p.tasks.slice(0, 5).map((t, i) => (
                  <div key={i} className="pt-taskrow">
                    <MIcon name={t.done ? "check_circle" : "radio_button_unchecked"} size={16} color={t.done ? "#2f8f5f" : "#c3c7d6"} />
                    <span className={t.done ? "pt-task-done" : ""} style={{ flex: 1, minWidth: 0 }}>{t.name}</span>
                    {t.status ? <span className="pt-tinytag" style={{ color: t.status_color ?? "#8b90a4" }}>{t.status}</span> : null}
                  </div>
                ))}
                {p.tasks.length > 5 ? <div className="pt-muted" style={{ paddingLeft: 24 }}>+{p.tasks.length - 5} more</div> : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/* Google-Sheet template */
function SheetView({ tasks }: { tasks: (PortalTask & { project: string; projectColor: string | null })[] }) {
  const cols = ["Project", "Task", "Status", "Priority", "Due"];
  return (
    <div className="pt-sheet-wrap">
      <div className="pt-sheet-toolbar">
        <MIcon name="table_chart" size={18} color="#0f9d58" />
        <span style={{ fontWeight: 700 }}>Worksheet</span>
        <span className="pt-muted" style={{ marginLeft: "auto" }}>{tasks.length} rows</span>
      </div>
      <div className="pt-sheet-scroll">
        <table className="pt-sheet">
          <thead>
            <tr className="pt-sheet-cols">
              <th className="pt-sheet-corner" />
              {cols.map((_, i) => (
                <th key={i} className="pt-sheet-colhead">{String.fromCharCode(65 + i)}</th>
              ))}
            </tr>
            <tr className="pt-sheet-fields">
              <th className="pt-sheet-rownum" />
              {cols.map((c) => <th key={c}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {tasks.map((t, i) => (
              <tr key={i}>
                <td className="pt-sheet-rownum">{i + 1}</td>
                <td>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span className="pt-dot sm" style={{ background: t.projectColor ?? "#9aa0b4" }} />
                    {t.project}
                  </span>
                </td>
                <td className={t.done ? "pt-task-done" : ""}>{t.name}</td>
                <td style={{ color: t.status_color ?? "#3a3f52", fontWeight: 600 }}>{t.status ?? "—"}</td>
                <td style={{ color: t.priority ? PRIORITY_COLOR[t.priority.toLowerCase()] ?? "#3a3f52" : "#9aa0b4", fontWeight: 600 }}>
                  {t.priority ?? "—"}
                </td>
                <td className="pt-mono">{fmtShort(t.end_date)}</td>
              </tr>
            ))}
            {tasks.length === 0 ? (
              <tr><td className="pt-sheet-rownum">1</td><td colSpan={5} className="pt-muted">No tasks yet.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* Board template */
function BoardView({ tasks }: { tasks: (PortalTask & { project: string; projectColor: string | null })[] }) {
  const groups = useMemo(() => {
    const m = new Map<string, { color: string; items: typeof tasks }>();
    for (const t of tasks) {
      const key = t.status ?? "No status";
      if (!m.has(key)) m.set(key, { color: t.status_color ?? "#8b90a4", items: [] });
      m.get(key)!.items.push(t);
    }
    return [...m.entries()];
  }, [tasks]);
  return (
    <div className="pt-board">
      {groups.map(([name, g]) => (
        <div key={name} className="pt-col">
          <div className="pt-col-head">
            <span className="pt-dot sm" style={{ background: g.color }} /> {name}
            <span className="pt-muted" style={{ marginLeft: "auto" }}>{g.items.length}</span>
          </div>
          {g.items.map((t, i) => (
            <div key={i} className="pt-col-card">
              <div className={t.done ? "pt-task-done" : ""} style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</div>
              <div className="pt-col-meta">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span className="pt-dot sm" style={{ background: t.projectColor ?? "#9aa0b4" }} />{t.project}
                </span>
                <span className="pt-mono">{fmtShort(t.end_date)}</span>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* Timeline template */
function TimelineView({ tasks }: { tasks: (PortalTask & { project: string; projectColor: string | null })[] }) {
  const buckets = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const wk = new Date(today); wk.setDate(wk.getDate() + 7);
    const b: Record<string, typeof tasks> = { Overdue: [], "This week": [], Later: [], "No date": [] };
    for (const t of tasks) {
      if (!t.end_date) { b["No date"].push(t); continue; }
      const d = new Date(t.end_date);
      if (t.done) { b.Later.push(t); continue; }
      if (d < today) b.Overdue.push(t);
      else if (d < wk) b["This week"].push(t);
      else b.Later.push(t);
    }
    return b;
  }, [tasks]);
  const tone: Record<string, string> = { Overdue: "#c0453c", "This week": "#c98a1b", Later: "#3d7de0", "No date": "#8b90a4" };
  return (
    <div className="pt-timeline">
      {Object.entries(buckets).filter(([, v]) => v.length).map(([name, items]) => (
        <div key={name} className="pt-tl-group">
          <div className="pt-tl-head" style={{ color: tone[name] }}>{name} <span className="pt-muted">{items.length}</span></div>
          <div className="pt-card" style={{ padding: 6 }}>
            {items.map((t, i) => (
              <div key={i} className="pt-taskrow" style={{ padding: "9px 10px" }}>
                <MIcon name={t.done ? "check_circle" : "radio_button_unchecked"} size={16} color={t.done ? "#2f8f5f" : "#c3c7d6"} />
                <span className={t.done ? "pt-task-done" : ""} style={{ flex: 1, minWidth: 0 }}>{t.name}</span>
                <span className="pt-muted" style={{ flex: "none" }}>{t.project}</span>
                <span className="pt-mono" style={{ flex: "none", width: 56, textAlign: "right" }}>{fmtShort(t.end_date)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* Minimal template */
function MinimalView({ projects, showTasks }: { projects: PortalProject[]; showTasks: boolean }) {
  return (
    <div className="pt-minimal">
      {projects.map((p) => (
        <section key={p.name} className="pt-min-sec">
          <div className="pt-min-head">
            <span className="pt-dot" style={{ background: p.color_code ?? "#9aa0b4" }} />
            <h3>{p.name}</h3>
            <span className="pt-muted">{p.done_tasks}/{p.total_tasks}</span>
          </div>
          {showTasks ? (
            <div>
              {p.tasks.map((t, i) => (
                <div key={i} className="pt-min-row">
                  <MIcon name={t.done ? "check_circle" : "radio_button_unchecked"} size={17} color={t.done ? "#2f8f5f" : "#c3c7d6"} />
                  <span className={t.done ? "pt-task-done" : ""}>{t.name}</span>
                  <span className="pt-mono" style={{ marginLeft: "auto" }}>{fmtShort(t.end_date)}</span>
                </div>
              ))}
              {p.tasks.length === 0 ? <div className="pt-muted" style={{ padding: "8px 0" }}>No tasks.</div> : null}
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}

/* --------------------------------------------------------- REVIEWS view */

function ReviewsView({ reviews }: { reviews: PortalReview[] }) {
  if (reviews.length === 0) return <Empty icon="movie" text="Nothing is waiting for your review right now." />;
  return (
    <div className="pt-grid">
      {reviews.map((r, i) => {
        const meta = REVIEW_META[r.status] ?? { label: r.status, color: "#8b90a4" };
        return (
          <div key={i} className="pt-card">
            <div className="pt-card-head">
              <span className="pt-thumb"><MIcon name="play_circle" size={22} color="#fff" /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="pt-card-title">{r.title}</div>
                <div className="pt-muted">{r.project_name ?? "—"} · v{r.revision}</div>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
              <Pill label={meta.label} color={meta.color} />
              <span className="pt-muted">{fmtDate(r.updated_at)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------- BILLING view */

function BillingView({ invoices, outstanding }: { invoices: PortalInvoice[]; outstanding: number }) {
  const currency = invoices[0]?.currency ?? "USD";
  const total = invoices.reduce((a, i) => a + i.amount_cents, 0);
  const paid = invoices.filter((i) => i.status === "paid").reduce((a, i) => a + i.amount_cents, 0);
  return (
    <>
      <div className="pt-stats">
        {[
          { label: "Billed", value: money(total, currency), icon: "receipt_long" },
          { label: "Paid", value: money(paid, currency), icon: "check_circle" },
          { label: "Outstanding", value: money(outstanding, currency), icon: "schedule" },
        ].map((s) => (
          <div key={s.label} className="pt-stat">
            <span className="pt-stat-icon"><MIcon name={s.icon} size={18} /></span>
            <div><div className="pt-stat-v">{s.value}</div><div className="pt-stat-l">{s.label}</div></div>
          </div>
        ))}
      </div>
      {invoices.length === 0 ? (
        <Empty icon="receipt_long" text="No invoices yet." />
      ) : (
        <div className="pt-card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="pt-sheet-scroll">
            <table className="pt-invtable">
              <thead>
                <tr><th>Invoice</th><th>Issued</th><th>Due</th><th style={{ textAlign: "right" }}>Amount</th><th>Status</th></tr>
              </thead>
              <tbody>
                {invoices.map((inv, i) => {
                  const meta = INVOICE_META[inv.status] ?? { label: inv.status, color: "#8b90a4" };
                  return (
                    <tr key={i}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{inv.number}</div>
                        {inv.title ? <div className="pt-muted">{inv.title}</div> : null}
                      </td>
                      <td className="pt-mono">{fmtShort(inv.issued_on)}</td>
                      <td className="pt-mono">{fmtShort(inv.due_on)}</td>
                      <td className="pt-mono" style={{ textAlign: "right", fontWeight: 700 }}>{money(inv.amount_cents, inv.currency)}</td>
                      <td><Pill label={meta.label} color={meta.color} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------- ACTIVITY view */

function ActivityView({ updates, requests }: { updates: PortalUpdate[]; requests: PortalRequest[] }) {
  return (
    <div className="pt-activity">
      <div>
        <h3 className="pt-sec-title"><MIcon name="campaign" size={18} /> Updates from your team</h3>
        {updates.length === 0 ? (
          <Empty icon="notifications_off" text="No updates yet." small />
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {updates.map((u, i) => (
              <div key={i} className="pt-card">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div className="pt-card-title">{u.title}</div>
                  <span className="pt-muted" style={{ flex: "none" }}>{fmtDate(u.created_at)}</span>
                </div>
                {u.body ? <p className="pt-notes">{u.body}</p> : null}
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <h3 className="pt-sec-title"><MIcon name="assignment" size={18} /> Your requests</h3>
        {requests.length === 0 ? (
          <Empty icon="inbox" text="You haven't requested anything yet." small />
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {requests.map((r, i) => {
              const meta = REQUEST_META[r.status] ?? { label: r.status, color: "#8b90a4" };
              return (
                <div key={i} className="pt-card">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                    <div className="pt-card-title">{r.title}</div>
                    <Pill label={meta.label} color={meta.color} />
                  </div>
                  {r.details ? <p className="pt-notes">{r.details}</p> : null}
                  <div className="pt-muted">{fmtDate(r.created_at)} · {r.priority} priority</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- request modal */

function RequestModal({
  token,
  accent,
  onClose,
  onSubmitted,
}: {
  token: string;
  accent: string;
  onClose: () => void;
  onSubmitted: (r: PortalRequest) => void;
}) {
  const supabase = useMemo(() => createClient() as unknown as SupabaseClient, []);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [priority, setPriority] = useState<"low" | "normal" | "high">("normal");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!title.trim()) { setErr("Please add a title."); return; }
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("submit_client_portal_request", {
      p_token: token,
      p_title: title.trim(),
      p_details: details.trim() || null,
      p_priority: priority,
    });
    setBusy(false);
    if (error) { setErr("Couldn't submit — please try again."); return; }
    onSubmitted({ title: title.trim(), details: details.trim() || null, priority, status: "new", created_at: new Date().toISOString() });
    setDone(true);
  };

  return (
    <div className="pt-overlay" onClick={onClose}>
      <div className="pt-modal" onClick={(e) => e.stopPropagation()}>
        <button className="pt-modal-x" onClick={onClose} aria-label="Close"><MIcon name="close" size={20} /></button>
        {done ? (
          <div style={{ textAlign: "center", padding: "16px 8px" }}>
            <span className="pt-check" style={{ background: `${accent}18`, color: accent }}><MIcon name="check" size={30} /></span>
            <h2 style={{ margin: "14px 0 6px", fontSize: 19 }}>Request sent 🎉</h2>
            <p className="pt-muted" style={{ marginBottom: 18 }}>Your team has been notified. You&apos;ll see status updates under Activity.</p>
            <button className="pt-btn primary" style={{ width: "100%", justifyContent: "center" }} onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <h2 style={{ margin: "0 0 4px", fontSize: 19, fontWeight: 800 }}>Request new work</h2>
            <p className="pt-muted" style={{ marginBottom: 16 }}>Tell your team what you need — they&apos;ll pick it up and keep you posted.</p>
            <label className="pt-label">What do you need?</label>
            <input className="pt-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. New landing page for the spring campaign" maxLength={200} autoFocus />
            <label className="pt-label">Details (optional)</label>
            <textarea className="pt-input" rows={4} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Any context, links, or specifics…" maxLength={8000} />
            <label className="pt-label">Priority</label>
            <div className="pt-prio">
              {(["low", "normal", "high"] as const).map((p) => (
                <button key={p} className={`pt-prio-btn${priority === p ? " on" : ""}`} onClick={() => setPriority(p)}>{p}</button>
              ))}
            </div>
            {err ? <div className="pt-err">{err}</div> : null}
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button className="pt-btn ghost" style={{ flex: 1, justifyContent: "center" }} onClick={onClose}>Cancel</button>
              <button className="pt-btn primary" style={{ flex: 1, justifyContent: "center" }} disabled={busy} onClick={submit}>
                {busy ? "Sending…" : "Send request"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ misc */

function Empty({ icon, text, small }: { icon: string; text: string; small?: boolean }) {
  return (
    <div className="pt-empty" style={small ? { padding: 24 } : undefined}>
      <MIcon name={icon} size={small ? 26 : 34} color="#b9bccb" />
      <span>{text}</span>
    </div>
  );
}

/* -------------------------------------------------------------------- CSS */

function css(accent: string): string {
  return `
.pt-root{min-height:100vh;background:#f6f7fb;color:#1c1f2a;font-family:var(--font-geist-sans),system-ui,sans-serif;padding-bottom:56px;}
.pt-root *{box-sizing:border-box;}
.pt-header{background:linear-gradient(135deg, ${accent}, ${accent}cc);color:#fff;padding:26px 20px 0;box-shadow:0 12px 34px -20px ${accent};position:relative;z-index:2;}
.pt-header-inner{max-width:1080px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:16px;}
.pt-brand{display:flex;align-items:center;gap:14px;min-width:0;}
.pt-logo{width:52px;height:52px;border-radius:14px;object-fit:cover;background:rgba(255,255,255,.15);flex:none;}
.pt-logo-fallback{display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:19px;color:#fff;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.25);}
.pt-client{font-size:22px;font-weight:800;letter-spacing:-.02em;line-height:1.1;}
.pt-title{font-size:13.5px;opacity:.85;}
.pt-intro{max-width:1080px;margin:16px auto 0;font-size:14px;line-height:1.6;opacity:.92;}
.pt-nav{max-width:1080px;margin:20px auto 0;display:flex;gap:4px;overflow-x:auto;}
.pt-tab{display:inline-flex;align-items:center;gap:7px;padding:11px 15px;border:none;background:transparent;color:rgba(255,255,255,.8);font-size:14px;font-weight:600;cursor:pointer;border-bottom:3px solid transparent;white-space:nowrap;}
.pt-tab:hover{color:#fff;}
.pt-tab.on{color:#fff;border-bottom-color:#fff;}
.pt-badge{font-size:10.5px;font-weight:800;background:rgba(255,255,255,.25);border-radius:999px;padding:1px 7px;}

.pt-main{max-width:1080px;margin:0 auto;padding:24px 20px 0;}
.pt-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px;}
.pt-stat{background:#fff;border:1px solid #eceef4;border-radius:14px;padding:16px;display:flex;align-items:center;gap:12px;box-shadow:0 1px 2px rgba(20,24,40,.03);}
.pt-stat-icon{width:36px;height:36px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;background:${accent}14;color:${accent};flex:none;}
.pt-stat-v{font-size:22px;font-weight:800;letter-spacing:-.02em;}
.pt-stat-l{font-size:12.5px;color:#6a6d78;}

.pt-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;}
.pt-card{background:#fff;border:1px solid #eceef4;border-radius:16px;padding:16px;box-shadow:0 1px 2px rgba(20,24,40,.03);}
.pt-card-head{display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;}
.pt-card-title{font-weight:700;font-size:15px;letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;}
.pt-dot{width:11px;height:11px;border-radius:999px;flex:none;margin-top:4px;}
.pt-dot.sm{width:8px;height:8px;margin-top:0;}
.pt-muted{font-size:12px;color:#8b90a4;}
.pt-prog-wrap{display:flex;align-items:center;gap:10px;margin:6px 0 4px;}
.pt-prog{flex:1;height:8px;border-radius:999px;background:#eef0f6;overflow:hidden;}
.pt-prog-fill{height:100%;border-radius:999px;background:${accent};}
.pt-notes{font-size:13px;color:#565a6b;line-height:1.55;margin:8px 0 0;}
.pt-tasklist{margin-top:12px;border-top:1px solid #f1f2f7;padding-top:8px;display:grid;gap:2px;}
.pt-taskrow{display:flex;align-items:center;gap:8px;font-size:13px;padding:5px 0;}
.pt-task-done{text-decoration:line-through;color:#9aa0b4;}
.pt-tinytag{font-size:11px;font-weight:600;flex:none;}
.pt-thumb{width:44px;height:44px;border-radius:11px;display:inline-flex;align-items:center;justify-content:center;background:linear-gradient(135deg, ${accent}, ${accent}aa);flex:none;}

/* sheet */
.pt-sheet-wrap{background:#fff;border:1px solid #dfe3ea;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(20,24,40,.05);}
.pt-sheet-toolbar{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid #e6e9f0;font-size:13.5px;background:#f8faf9;}
.pt-sheet-scroll{overflow-x:auto;}
.pt-sheet{border-collapse:collapse;width:100%;font-size:13px;}
.pt-sheet th,.pt-sheet td{border:1px solid #e6e9f0;padding:8px 12px;text-align:left;white-space:nowrap;}
.pt-sheet-colhead{background:#f1f3f4;color:#5f6368;font-weight:600;text-align:center;font-size:11px;height:22px;padding:2px;}
.pt-sheet-corner{background:#f1f3f4;width:40px;}
.pt-sheet-fields th{background:#f8f9fa;color:#3c4043;font-weight:700;font-size:12px;}
.pt-sheet-rownum{background:#f1f3f4;color:#5f6368;text-align:center;font-size:11px;width:40px;font-variant-numeric:tabular-nums;}
.pt-sheet tbody tr:nth-child(even) td{background:#fbfcfe;}
.pt-sheet tbody tr:hover td{background:${accent}0c;}
.pt-mono{font-family:var(--font-geist-mono),ui-monospace,monospace;font-size:12px;color:#565a6b;}

/* board */
.pt-board{display:flex;gap:12px;overflow-x:auto;padding-bottom:8px;}

/* Scrollbars are hidden platform-wide; re-show a slim horizontal-only bar on
   these regions so clients see that columns/rows continue off-screen. */
.pt-nav,.pt-sheet-scroll,.pt-board{scrollbar-width:thin;}
.pt-nav::-webkit-scrollbar,.pt-sheet-scroll::-webkit-scrollbar,.pt-board::-webkit-scrollbar{width:0;height:8px;display:block;}
.pt-nav::-webkit-scrollbar-thumb,.pt-sheet-scroll::-webkit-scrollbar-thumb,.pt-board::-webkit-scrollbar-thumb{background:rgba(20,24,40,.22);border-radius:999px;border:2px solid transparent;background-clip:content-box;}
.pt-nav::-webkit-scrollbar-track,.pt-sheet-scroll::-webkit-scrollbar-track,.pt-board::-webkit-scrollbar-track{background:transparent;}
.pt-col{flex:0 0 260px;background:#fff;border:1px solid #eceef4;border-radius:14px;padding:10px;}
.pt-col-head{display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;color:#3a3f52;padding:4px 6px 10px;}
.pt-col-card{background:#f8f9fc;border:1px solid #eef0f6;border-radius:11px;padding:10px;margin-bottom:8px;}
.pt-col-meta{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:8px;font-size:11.5px;color:#8b90a4;}

/* timeline */
.pt-timeline{display:grid;gap:20px;}
.pt-tl-head{font-size:12.5px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px;display:flex;gap:8px;align-items:center;}

/* minimal */
.pt-minimal{max-width:680px;margin:0 auto;display:grid;gap:28px;}
.pt-min-head{display:flex;align-items:center;gap:10px;margin-bottom:8px;border-bottom:1px solid #eceef4;padding-bottom:10px;}
.pt-min-head h3{font-size:16px;font-weight:700;margin:0;flex:1;}
.pt-min-row{display:flex;align-items:center;gap:10px;padding:9px 2px;font-size:14px;border-bottom:1px solid #f4f5f9;}

/* invoices */
.pt-invtable{border-collapse:collapse;width:100%;font-size:13.5px;}
.pt-invtable th{text-align:left;font-size:11.5px;text-transform:uppercase;letter-spacing:.4px;color:#8b90a4;padding:12px 16px;border-bottom:1px solid #eceef4;}
.pt-invtable td{padding:14px 16px;border-bottom:1px solid #f4f5f9;}
.pt-invtable tr:last-child td{border-bottom:none;}

/* activity */
.pt-activity{display:grid;grid-template-columns:1.3fr 1fr;gap:24px;}
.pt-sec-title{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:700;margin:0 0 12px;}

.pt-empty{background:#fff;border:1px dashed #dfe3ea;border-radius:16px;padding:44px;display:flex;flex-direction:column;align-items:center;gap:10px;color:#8b90a4;font-size:14px;}

.pt-btn{display:inline-flex;align-items:center;gap:7px;padding:10px 16px;border-radius:11px;font-size:14px;font-weight:700;cursor:pointer;border:1px solid transparent;transition:transform .15s,box-shadow .15s,background .15s;}
.pt-btn.primary{background:#fff;color:${accent};box-shadow:0 6px 18px -8px rgba(0,0,0,.4);}
.pt-btn.primary:hover{transform:translateY(-2px);}
.pt-btn.primary:disabled{opacity:.6;cursor:default;transform:none;}
.pt-btn.ghost{background:#f1f2f7;color:#3a3f52;}
.pt-btn.ghost:hover{background:#e8eaf2;}

.pt-footer{max-width:1080px;margin:40px auto 0;padding:20px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:12px;color:#9aa0b4;border-top:1px solid #eceef4;}

.pt-overlay{position:fixed;inset:0;background:rgba(16,18,30,.5);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:20px;z-index:100;animation:ov .18s ease;}
@keyframes ov{from{opacity:0;}to{opacity:1;}}
.pt-modal{position:relative;background:#fff;border-radius:20px;padding:26px;width:100%;max-width:460px;box-shadow:0 30px 70px -20px rgba(0,0,0,.5);animation:mo .25s cubic-bezier(.2,.8,.3,1);}
@keyframes mo{from{opacity:0;transform:translateY(16px) scale(.98);}to{opacity:1;transform:none;}}
.pt-modal-x{position:absolute;top:16px;right:16px;border:none;background:#f1f2f7;width:32px;height:32px;border-radius:9px;cursor:pointer;color:#6a6d78;display:inline-flex;align-items:center;justify-content:center;}
.pt-modal-x:hover{background:#e8eaf2;}
.pt-label{display:block;font-size:12.5px;font-weight:600;color:#3a3f52;margin:12px 0 6px;}
.pt-input{width:100%;border:1.5px solid #e2e5ee;border-radius:11px;padding:11px 13px;font-size:14px;font-family:inherit;color:#1c1f2a;outline:none;transition:border-color .15s;}
.pt-input:focus{border-color:${accent};}
.pt-prio{display:flex;gap:8px;}
.pt-prio-btn{flex:1;text-transform:capitalize;padding:9px;border-radius:10px;border:1.5px solid #e2e5ee;background:#fff;font-size:13px;font-weight:600;cursor:pointer;color:#6a6d78;}
.pt-prio-btn.on{border-color:${accent};color:${accent};background:${accent}0f;}
.pt-err{margin-top:12px;font-size:13px;color:#c0453c;background:#c0453c12;padding:9px 12px;border-radius:10px;}
.pt-check{width:60px;height:60px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;}

@media(max-width:760px){
  .pt-activity{grid-template-columns:1fr;}
  .pt-client{font-size:19px;}
}
`;
}
