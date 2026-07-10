"use client";

import Link from "next/link";
import { MarketingShell, MarketingCTA, MIcon } from "@/components/marketing/site-shell";
import { GITHUB_URL } from "@/components/marketing/pricing-plans";

/* The flagship bento — asymmetric highlight tiles above the detailed groups. */
const VIEWS = [
  { icon: "view_kanban", label: "Board" },
  { icon: "format_list_bulleted", label: "List" },
  { icon: "table_chart", label: "Table" },
  { icon: "timeline", label: "Timeline" },
  { icon: "calendar_month", label: "Calendar" },
  { icon: "stacked_bar_chart", label: "Workload" },
];

const GROUPS: {
  n: string;
  title: string;
  desc: string;
  items: { icon: string; t: string; d: string }[];
}[] = [
  {
    n: "01",
    title: "Plan & track",
    desc: "Every way your team likes to see work — one dataset underneath.",
    items: [
      { icon: "format_list_bulleted", t: "List, Board & Table", d: "Grouped rows, kanban columns, or a dense spreadsheet — switch views without losing anything." },
      { icon: "timeline", t: "Timeline & Calendar", d: "Roadmaps across time and tasks on a month grid, driven by the same dates." },
      { icon: "monitoring", t: "Workload", d: "See who's over- or under-loaded — estimated hours per person, per day." },
      { icon: "bar_chart", t: "Reporting", d: "Projects, members and time-sheets rolled up into clear reports." },
      { icon: "account_tree", t: "Automations & Workflows", d: "Trigger status changes, assignments and notifications — no busywork." },
      { icon: "tag", t: "Custom task IDs", d: "Prefix, separator and padding rules set once, applied everywhere." },
    ],
  },
  {
    n: "02",
    title: "Create & review",
    desc: "Where the work itself lives — docs, files and feedback in the same place as the tasks.",
    items: [
      { icon: "menu_book", t: "Docs & wikis", d: "A page tree with rich blocks, slash commands and per-page privacy." },
      { icon: "movie", t: "Video review", d: "Timestamped comments pinned to the frame, versions, and an approval flow." },
      { icon: "folder_shared", t: "Files & local folders", d: "Team files with permissions — plus browse local folders and push to cloud in one click." },
      { icon: "forum", t: "Updates & activity", d: "A project-wide feed of every change, and @mentions that notify instantly." },
    ],
  },
  {
    n: "03",
    title: "Grow & run",
    desc: "The tools around the work — clients, content, people and AI.",
    items: [
      { icon: "campaign", t: "Social studio", d: "Plan, compose and schedule across 14 platforms with real brand previews." },
      { icon: "handshake", t: "Client portals", d: "A private link where clients see progress, request work and check billing." },
      { icon: "smart_toy", t: "AI agents & MCP", d: "Break down tasks, draft standups, and connect Claude directly to your workspace." },
      { icon: "badge", t: "HR suite", d: "People, attendance, leave and payroll — built in, not bolted on." },
    ],
  },
];

export default function FeaturesPage() {
  return (
    <MarketingShell active="/features">
      <style>{CSS}</style>

      {/* HERO */}
      <section className="head fx-head">
        <h1 className="h1">
          Every tool your team needs.<br />
          <span className="fx-grad">One workspace.</span>
        </h1>
        <p className="lead">
          Cubes folds planning, docs, review, social, clients and people ops into
          a single fast workspace — so the work and everything around it live
          together.
        </p>
        <div className="fx-cta">
          <Link href="/signup" className="btn navy">
            Start free <MIcon name="arrow_forward" size={17} />
          </Link>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="btn ghost">
            <GitHubMark /> Star on GitHub
          </a>
        </div>
        <div className="fx-banner">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/features_banner.png" alt="Cubes in action" />
        </div>
      </section>

      {/* FLAGSHIP BENTO */}
      <section className="wrap">
        <div className="bento">
          {/* Big: multiple views */}
          <div className="b-tile b-wide">
            <div className="b-glow" aria-hidden />
            <div className="b-head">
              <span className="b-ic">
                <MIcon name="dashboard_customize" size={20} />
              </span>
              <div>
                <div className="b-t">Six views, one source of truth</div>
                <div className="b-d">Switch how you see work without ever duplicating it.</div>
              </div>
            </div>
            <div className="views">
              {VIEWS.map((v, i) => (
                <div key={v.label} className={`view-pill${i === 0 ? " on" : ""}`}>
                  <MIcon name={v.icon} size={16} /> {v.label}
                </div>
              ))}
            </div>
          </div>

          {/* Tall: unlimited members */}
          <div className="b-tile b-accent">
            <div className="b-glow" aria-hidden />
            <span className="b-ic" style={{ background: "rgba(255,255,255,.14)", color: "#fff" }}>
              <MIcon name="group" size={20} />
            </span>
            <div className="b-big">∞</div>
            <div className="b-t light">Unlimited members</div>
            <div className="b-d light">Flat pricing — invite the whole team and every client. No per-seat math, ever.</div>
          </div>

          {/* Realtime */}
          <div className="b-tile">
            <span className="b-ic">
              <MIcon name="bolt" size={20} />
            </span>
            <div className="b-t">Realtime everywhere</div>
            <div className="b-d">Boards, lists and comments update live across everyone&apos;s screen.</div>
          </div>

          {/* Open source */}
          <div className="b-tile">
            <span className="b-ic">
              <MIcon name="code" size={20} />
            </span>
            <div className="b-t">Open source, no lock-in</div>
            <div className="b-d">Export everything, or self-host it on your own servers tonight.</div>
          </div>

        </div>
      </section>

      {/* DETAILED GROUPS */}
      {GROUPS.map((g) => (
        <section key={g.title} className="wrap">
          <div className="grp-head">
            <span className="grp-n">{g.n}</span>
            <div>
              <h2 className="h2" style={{ margin: 0 }}>{g.title}</h2>
              <p className="fg-desc">{g.desc}</p>
            </div>
          </div>
          <div className="fgrid">
            {g.items.map((f) => (
              <div key={f.t} className="fcard">
                <div className="fcard-hd">
                  <div className="ft">{f.t}</div>
                  <span className="fcard-dots" aria-hidden>
                    <MIcon name="more_horiz" size={18} />
                  </span>
                </div>
                <div className="fd">{f.d}</div>
                <div className="fcard-foot">
                  <span className="fcard-go">
                    <MIcon name={f.icon} size={20} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {/* CTA */}
      <section className="wrap" style={{ paddingBottom: 10 }}>
        <MarketingCTA
          title="All of it, from day one."
          sub="No add-ons, no per-feature tiers — every module ships with every plan."
        >
          <Link href="/signup" className="btn white">
            Start free <MIcon name="arrow_forward" size={17} />
          </Link>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="btn glass">
            <MIcon name="code" size={17} /> Self-host it
          </a>
        </MarketingCTA>
      </section>
    </MarketingShell>
  );
}

function GitHubMark({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.55v-2.17c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 2.9-.39c.98 0 1.97.13 2.9.39 2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.66.41.36.78 1.06.78 2.14v3.17c0 .31.21.66.8.55A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

const CSS = `
.fx-head{text-align:center;padding-top:32px;padding-bottom:12px;}
.fx-head .h1{margin:10px auto 0;}
.fx-head .lead{margin:20px auto 0;text-align:center;}
.fx-grad{background:linear-gradient(180deg,#c7cfe2,#a4b0ca);-webkit-background-clip:text;background-clip:text;color:transparent;}
.fx-cta{display:flex;gap:12px;justify-content:center;margin-top:30px;flex-wrap:wrap;}
.fx-banner{margin:42px auto 0;max-width:1040px;}
.fx-banner img{display:block;width:100%;height:auto;border-radius:26px;}
.btn.navy{background:linear-gradient(180deg,#39415e 0%,#161c33 52%,#0c1122 100%);color:#fff;border-radius:999px;border:1px solid rgba(255,255,255,.1);box-shadow:0 14px 30px -12px rgba(18,23,44,.75), inset 0 1.5px 0 rgba(255,255,255,.32);}
.btn.navy:hover{transform:translateY(-2px);}
.btn.ghost{background:#fff;border:1px solid #e6e7ee;color:#0e0f17;border-radius:999px;}
.btn.ghost:hover{border-color:#0e0f17;color:#0e0f17;}

/* bento */
.bento{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;}
.b-tile{position:relative;overflow:hidden;min-width:0;background:linear-gradient(180deg,#ffffff,#fbfbff);border-radius:26px;padding:22px;display:flex;flex-direction:column;box-shadow:0 18px 38px -28px rgba(16,24,40,.28), inset 0 1.5px 0 rgba(255,255,255,.9);}
.b-wide{grid-column:span 2;grid-row:span 2;}
.b-accent{grid-row:span 2;background:linear-gradient(180deg,#2c2f39 0%,#191c26 60%,#111319 100%);color:#fff;box-shadow:0 20px 44px -28px rgba(16,24,40,.5), inset 0 1.5px 0 rgba(255,255,255,.14);}
.b-glow{position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at 85% -10%, rgba(255,255,255,.05), transparent 55%);}
.b-head{display:flex;gap:13px;align-items:flex-start;position:relative;}
.b-ic{width:42px;height:42px;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;flex:none;background:#f1f2f6;color:#5b6070;}
.b-big{font-size:52px;font-weight:800;letter-spacing:-.04em;line-height:1;margin:16px 0 8px;background:linear-gradient(180deg,#fff,#c9ccd4);-webkit-background-clip:text;background-clip:text;color:transparent;}
.b-t{font-weight:800;font-size:16.5px;margin-top:12px;letter-spacing:-.01em;color:#101019;}
.b-head .b-t{margin-top:0;}
.b-t.light{color:#fff;}
.b-d{font-size:13.5px;color:#616371;line-height:1.55;margin-top:6px;}
.b-d.light{color:#b8bcd8;}
.b-accent .b-ic,.b-accent .b-big{position:relative;}

/* view switcher mock */
.views{display:flex;flex-wrap:wrap;gap:8px;margin-top:auto;padding-top:22px;}
.view-pill{display:inline-flex;align-items:center;gap:6px;padding:8px 13px;border-radius:10px;font-size:13px;font-weight:600;color:#54586a;background:#f4f5f9;border:1px solid #ececf3;}
.view-pill.on{background:#1b1d26;color:#fff;border-color:transparent;}

/* group heads */
.grp-head{display:flex;align-items:flex-start;gap:16px;margin-bottom:20px;}
.grp-n{font-size:13px;font-weight:800;color:#c3c6d6;letter-spacing:.1em;padding-top:6px;font-variant-numeric:tabular-nums;}
.fg-desc{font-size:14.5px;color:#6a6a74;margin:6px 0 0;max-width:560px;}

/* feature cards */
.fgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;}
.fcard{position:relative;overflow:hidden;min-width:0;min-height:210px;display:flex;flex-direction:column;background:linear-gradient(180deg,#ffffff,#fbfbff);border-radius:26px;padding:20px;box-shadow:0 18px 38px -28px rgba(16,24,40,.28), inset 0 1.5px 0 rgba(255,255,255,.9);}
.fcard-hd{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;}
.ft{font-weight:800;font-size:16.5px;letter-spacing:-.01em;color:#101019;line-height:1.25;}
.fcard-dots{flex:none;width:34px;height:34px;border-radius:11px;background:#f4f5f9;color:#9195a4;display:inline-flex;align-items:center;justify-content:center;}
.fd{font-size:13.5px;color:#616371;line-height:1.55;margin-top:auto;padding-top:20px;}
.fcard-foot{display:flex;align-items:center;justify-content:flex-end;margin-top:16px;}
.fcard-go{width:40px;height:40px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;color:#fff;background:#1b1d26;box-shadow:0 8px 18px -10px rgba(16,24,40,.45), inset 0 1px 0 rgba(255,255,255,.14);}

@media(max-width:900px){
  .bento{grid-template-columns:repeat(2,1fr);gap:14px;}
  .b-wide,.b-accent{grid-column:span 2;grid-row:auto;}
  .fgrid{grid-template-columns:1fr 1fr;gap:14px;}
  .fx-banner{margin-top:34px;}
}
@media(max-width:600px){
  .bento{grid-template-columns:1fr;}
  .b-wide,.b-accent{grid-column:span 1;}
  .fgrid{grid-template-columns:1fr;}
  .b-tile,.fcard{padding:18px;}
  .grp-head{gap:12px;margin-bottom:16px;}
  .grp-n{display:none;}
}
`;
