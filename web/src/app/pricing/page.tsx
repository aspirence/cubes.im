"use client";

import { useState } from "react";
import Link from "next/link";
import { PricingPlans, GITHUB_URL } from "@/components/marketing/pricing-plans";
import { MarketingCTA, MarketingFooter, CTA_CSS, FOOT_CSS } from "@/components/marketing/site-shell";

const ACCENT = "#4f5bd5";

function MIcon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1 }}>
      {name}
    </span>
  );
}

function GitHubMark({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.55v-2.17c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 2.9-.39c.98 0 1.97.13 2.9.39 2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.66.41.36.78 1.06.78 2.14v3.17c0 .31.21.66.8.55A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

const NAV = [
  { label: "Features", href: "/features" },
  { label: "Product", href: "/product" },
  { label: "Pricing", href: "/pricing" },
];

const COMPARE: { label: string; self: string; cloud: string }[] = [
  { label: "Price", self: "Free, forever", cloud: "Flat monthly + storage" },
  { label: "Team members", self: "Unlimited", cloud: "Unlimited" },
  { label: "Projects & modules", self: "Everything included", cloud: "Everything included" },
  { label: "Hosting", self: "Your own servers", cloud: "Managed by us" },
  { label: "Storage", self: "Whatever your disks hold", cloud: "Included base + pay per extra GB" },
  { label: "Updates", self: "You pull new releases", cloud: "Always on the latest version" },
  { label: "Backups & uptime", self: "You operate it", cloud: "Handled for you" },
  { label: "Data ownership", self: "100% on your infra", cloud: "Yours — export anytime" },
  { label: "Support", self: "Community", cloud: "Priority support" },
];

const FAQS: { q: string; a: string }[] = [
  { q: "Is Cubes really free to self-host?", a: "Yes. Cubes is open source — clone the repo, deploy it on your own infrastructure, and use every module with unlimited members and projects. No license keys, no feature gates." },
  { q: "How does Cloud pricing work?", a: "One flat monthly price covers your whole team — we never charge per seat. The base plan includes a storage allotment; if you need more, you pay a small per-GB rate on top. The slider above shows your exact price." },
  { q: "What counts toward storage?", a: "Files your team uploads — attachments, shared files, video review uploads, and social media assets. Tasks, docs and comments are effectively free." },
  { q: "Can I change storage later?", a: "Anytime. Team admins can raise or lower the storage from Billing, and the new price applies from the next cycle." },
  { q: "Can I move between Cloud and self-hosted?", a: "Yes — it's the same open-source product underneath, so you can start on Cloud and migrate to your own servers later (or the other way around)." },
  { q: "Do you offer trials?", a: "Cloud starts free — no credit card. Use it with your team, and add a payment method only when you're ready." },
];

export default function PricingPage() {
  const [faq, setFaq] = useState<number | null>(0);
  const [menu, setMenu] = useState(false);

  return (
    <div className="pp">
      <style>{CSS}</style>
      <div className="pp-bg" aria-hidden />

      {/* NAV */}
      <header className="nav">
        <div className="nav-in">
          <Link href="/" className="brand"><img src="/brand/cubes.im_logo_big.png" alt="" className="brand-img" /> Cubes</Link>
          <nav className="nav-links">
            {NAV.map((n) => (
              <Link key={n.label} href={n.href} className={n.href === "/pricing" ? "on" : ""}>{n.label}</Link>
            ))}
          </nav>
          <div className="nav-right">
            <a className="lang" href={GITHUB_URL} target="_blank" rel="noreferrer"><GitHubMark /> Star on GitHub</a>
            <Link href="/login" className="btn navy sm">Get started</Link>
            <button className="burger" aria-label="Menu" aria-expanded={menu} aria-controls="nav-drawer" onClick={() => setMenu((m) => !m)}><MIcon name={menu ? "close" : "menu"} size={22} /></button>
          </div>
        </div>
        {menu ? (
          <div className="drawer" id="nav-drawer">
            {NAV.map((n) => <Link key={n.label} href={n.href} onClick={() => setMenu(false)}>{n.label}</Link>)}
            <a className="lang" href={GITHUB_URL} target="_blank" rel="noreferrer" onClick={() => setMenu(false)}><GitHubMark /> Star on GitHub</a>
            <Link href="/login" className="btn navy" onClick={() => setMenu(false)}>Get started</Link>
          </div>
        ) : null}
      </header>

      {/* HEADER */}
      <section className="head">
        <h1 className="h1">Simple, honest pricing.</h1>
        <p className="lead">
          Cubes is <b>open source</b> — run it yourself for free, forever. Or choose Cloud:
          one flat price for unlimited team members that only grows with the storage you use.
          No per-seat charges on either.
        </p>
      </section>

      {/* PLANS */}
      <section className="wrap">
        <PricingPlans />
      </section>

      {/* COMPARISON */}
      <section className="wrap">
        <h2 className="h2">Compare the two</h2>
        <div className="cmp">
          <div className="cmp-row cmp-head">
            <div />
            <div><MIcon name="dns" size={16} /> Self-hosted</div>
            <div className="hl"><MIcon name="cloud" size={16} /> Cloud</div>
          </div>
          {COMPARE.map((r) => (
            <div key={r.label} className="cmp-row">
              <div className="cmp-label">{r.label}</div>
              <div>{r.self}</div>
              <div className="hl">{r.cloud}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="wrap faq-sec">
        <h2 className="h2">Pricing questions</h2>
        <div className="faq-grid">
          {FAQS.map((f, i) => {
            const open = faq === i;
            return (
              <div key={f.q} className={`faq-item${open ? " open" : ""}`}>
                <button className="faq-q" onClick={() => setFaq(open ? null : i)} aria-expanded={open}>
                  <span>{f.q}</span>
                  <span className="faq-ic"><MIcon name="add" size={18} /></span>
                </button>
                <div className="faq-a" style={{ maxHeight: open ? 260 : 0 }}><p>{f.a}</p></div>
              </div>
            );
          })}
        </div>
      </section>

      {/* CTA */}
      <section className="wrap">
        <MarketingCTA title="Try Cubes with your whole team." sub="Start free on Cloud, or spin it up on your own servers tonight.">
          <Link href="/signup" className="btn white">Start free <MIcon name="arrow_forward" size={17} /></Link>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="btn glass"><MIcon name="code" size={17} /> Self-host it</a>
        </MarketingCTA>
      </section>

      <MarketingFooter />
    </div>
  );
}

const CSS = `
.pp{position:relative;min-height:100vh;background:#fbfbfe;color:#0e0f17;font-family:var(--font-geist-sans),system-ui,sans-serif;overflow-x:hidden;}
.pp *{box-sizing:border-box;}
.pp a{color:inherit;text-decoration:none;}
.pp-bg{position:fixed;inset:0;z-index:0;pointer-events:none;background-image:linear-gradient(rgba(15,17,30,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(15,17,30,.035) 1px,transparent 1px);background-size:44px 44px;mask-image:radial-gradient(ellipse 80% 50% at 50% 0%, #000, transparent 75%);}

.nav{position:sticky;top:0;z-index:40;}
.nav-in{max-width:1080px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 22px;position:relative;}
.nav::before{content:"";position:absolute;inset:0;background:rgba(251,251,254,.72);backdrop-filter:blur(12px);border-bottom:1px solid rgba(15,17,30,.06);z-index:-1;}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:20px;letter-spacing:-.02em;}
.brand-img{width:48px;height:48px;object-fit:contain;}
.brand-img.sm{width:32px;height:32px;}
.brand-mark{width:28px;height:28px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;color:#fff;background:linear-gradient(150deg,#6d6df0,${ACCENT});box-shadow:0 6px 16px -6px ${ACCENT};flex:none;}
.nav-links{display:flex;gap:26px;font-size:14.5px;color:#4a4c5a;font-weight:500;}
.nav-links a:hover,.nav-links a.on{color:#0e0f17;font-weight:700;}
.nav-right{display:flex;align-items:center;gap:12px;}
.lang{display:inline-flex;align-items:center;gap:6px;padding:8px 13px;border-radius:999px;background:rgba(255,255,255,.75);border:1px solid rgba(20,26,46,.08);box-shadow:inset 0 1px 0 rgba(255,255,255,.9);font-size:13.5px;font-weight:600;color:#2a2c3a;cursor:pointer;}
.burger{display:none;border:1px solid #e6e7ee;background:#fff;border-radius:9px;width:38px;height:38px;align-items:center;justify-content:center;cursor:pointer;color:#0e0f17;}
.drawer{display:none;}

.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;font-size:14px;font-weight:600;padding:10px 17px;border-radius:11px;cursor:pointer;border:1px solid transparent;transition:transform .16s,box-shadow .16s;white-space:nowrap;}
.btn.sm{padding:8px 15px;font-size:13.5px;}
.btn.navy{background:linear-gradient(180deg,#39415e 0%,#161c33 52%,#0c1122 100%);color:#fff;border-radius:999px;border:1px solid rgba(255,255,255,.1);box-shadow:0 14px 30px -12px rgba(18,23,44,.75), inset 0 1.5px 0 rgba(255,255,255,.32), inset 0 -2px 6px rgba(0,0,0,.45);text-shadow:0 1px 2px rgba(0,0,0,.4);}
.btn.navy:hover{transform:translateY(-2px);}
.btn.white{background:linear-gradient(180deg,#fff,#eef0f4);color:#17181f;border:1px solid rgba(255,255,255,.7);border-radius:999px;box-shadow:0 12px 30px -12px rgba(0,0,0,.45), inset 0 1.5px 0 #fff;}
.btn.white:hover{transform:translateY(-2px);}
.btn.glass{background:rgba(255,255,255,.18);border-color:rgba(255,255,255,.45);color:#fff;border-radius:999px;box-shadow:inset 0 1px 0 rgba(255,255,255,.25);}
.btn.glass:hover{background:rgba(255,255,255,.28);}

.head{position:relative;z-index:1;max-width:1080px;margin:0 auto;padding:36px 22px 8px;text-align:center;}
.h1{font-size:clamp(28px,4.2vw,44px);font-weight:800;letter-spacing:-.035em;line-height:1.05;margin:0;}
.lead{font-size:15px;color:#5b5d6b;line-height:1.5;max-width:580px;margin:14px auto 0;}
.h2{font-size:clamp(24px,3vw,34px);font-weight:800;letter-spacing:-.03em;margin:0 0 22px;}

.wrap{position:relative;z-index:1;max-width:1080px;margin:0 auto;padding:44px 22px 0;}

.cmp{background:#fff;border:1px solid #ececf3;border-radius:20px;overflow:hidden;box-shadow:0 10px 30px -24px rgba(40,30,110,.4);}
.cmp-row{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:12px;padding:14px 20px;font-size:14px;color:#3a3c4a;border-top:1px solid #f2f2f7;}
.cmp-row:first-child{border-top:none;}
.cmp-head{background:#fbfbfe;font-weight:800;color:#0e0f17;font-size:13.5px;}
.cmp-head>div{display:flex;align-items:center;gap:7px;}
.cmp-label{font-weight:600;color:#0e0f17;}
.cmp .hl{color:#0e0f17;font-weight:700;}
.cmp-head .hl{color:#0e0f17;}

.faq-sec .h2{text-align:center;margin-bottom:28px;}
.faq-grid{display:flex;flex-direction:column;gap:12px;max-width:780px;margin:0 auto;}
.faq-item{background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px -26px rgba(16,24,40,.45), inset 0 0 0 1px #eef0f4;transition:box-shadow .2s;}
.faq-item.open{box-shadow:0 20px 46px -30px rgba(16,24,40,.4), inset 0 0 0 1px #e2e4ec;}
.faq-q{width:100%;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 20px;background:none;border:none;cursor:pointer;font-size:15px;font-weight:700;text-align:left;color:#0e0f17;font-family:inherit;letter-spacing:-.01em;}
.faq-ic{flex:none;width:30px;height:30px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;background:#f1f2f6;color:#4a4c5a;transition:background .2s,color .2s,transform .25s;}
.faq-item.open .faq-ic{background:#17181f;color:#fff;transform:rotate(45deg);}
.faq-a{overflow:hidden;transition:max-height .3s ease;}
.faq-a p{padding:2px 20px 20px;margin:0;font-size:14px;color:#6a6a74;line-height:1.65;}

${CTA_CSS}

${FOOT_CSS}

@media(max-width:860px){
  .nav-links{display:none;}
  .burger{display:inline-flex;}
  .nav-right .btn.navy.sm,.lang{display:none;}
  .drawer{display:flex;flex-direction:column;gap:4px;position:absolute;top:72px;left:22px;right:22px;background:#fff;border:1px solid #ececf3;border-radius:16px;padding:12px;box-shadow:0 24px 50px -20px rgba(40,30,110,.4);}
  .drawer a{padding:11px 12px;border-radius:10px;font-weight:600;font-size:15px;}
  .drawer a:hover{background:#f4f4fb;}
  .cmp-row{grid-template-columns:1fr;gap:4px;padding:14px 16px;}
  .cmp-row>div:not(.cmp-label){padding-left:10px;font-size:13.5px;}
  .cmp-head{display:none;}
  .cmp-row>div:nth-child(2)::before{content:"Self-hosted — ";font-weight:700;color:#54586a;}
  .cmp-row>div.hl::before{content:"Cloud — ";font-weight:700;}
}
`;
