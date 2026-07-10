"use client";

import { useState } from "react";
import Link from "next/link";
import { GITHUB_URL } from "@/components/marketing/pricing-plans";

export function MIcon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1 }}>
      {name}
    </span>
  );
}

function GitHubMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.55v-2.17c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 2.9-.39c.98 0 1.97.13 2.9.39 2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.66.41.36.78 1.06.78 2.14v3.17c0 .31.21.66.8.55A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

/**
 * Shared closing CTA panel for the marketing pages — dark glossy navy (same
 * treatment as the navy buttons / footer pill) with the mascot cube on top.
 * Pages pass their own buttons as children.
 */
export function MarketingCTA({ title, sub, children }: { title: string; sub: string; children?: React.ReactNode }) {
  return (
    <div className="cta">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/cubes.im_logo_big.png" alt="" className="cta-cube" />
      <h2 className="cta-h">{title}</h2>
      <p className="cta-s">{sub}</p>
      <div className="cta-btns">{children}</div>
    </div>
  );
}

export const MARKETING_NAV = [
  { label: "Features", href: "/features" },
  { label: "Product", href: "/product" },
  { label: "Pricing", href: "/pricing" },
];

/**
 * Shared shell for the public marketing pages (/features, /product, /pricing):
 * the glossy nav, footer, and the base typography/button styles, so
 * every page reads as one site. Pages provide only their own sections.
 */
export function MarketingShell({ active, children }: { active?: string; children: React.ReactNode }) {
  const [menu, setMenu] = useState(false);
  return (
    <div className="mk">
      <style>{SHELL_CSS}</style>
      <div className="mk-bg" aria-hidden />

      <header className="nav">
        <div className="nav-in">
          <Link href="/" className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/cubes.im_logo_big.png" alt="" className="brand-img" /> Cubes
          </Link>
          <nav className="nav-links">
            {MARKETING_NAV.map((n) => (
              <Link key={n.label} href={n.href} className={active === n.href ? "on" : ""}>{n.label}</Link>
            ))}
          </nav>
          <div className="nav-right">
            <a className="lang" href={GITHUB_URL} target="_blank" rel="noreferrer"><GitHubMark /> Star on GitHub</a>
            <Link href="/login" className="btn navy sm">Get started</Link>
            <button className="burger" aria-label="Menu" onClick={() => setMenu((m) => !m)}>
              <MIcon name={menu ? "close" : "menu"} size={22} />
            </button>
          </div>
        </div>
        {menu ? (
          <div className="drawer">
            {MARKETING_NAV.map((n) => <Link key={n.label} href={n.href} onClick={() => setMenu(false)}>{n.label}</Link>)}
            <Link href="/login" className="btn navy" onClick={() => setMenu(false)}>Get started</Link>
          </div>
        ) : null}
      </header>

      {children}

      <MarketingFooter />
    </div>
  );
}

/**
 * Shared marketing footer — brand + tagline on the left, link columns on the
 * right, and a hairline bottom bar. Standalone pages (e.g. /pricing) that
 * don't use MarketingShell render this directly and include FOOT_CSS.
 */
export function MarketingFooter() {
  return (
    <footer className="foot">
      <div className="foot-in">
      <div className="foot-grid">
        <div className="foot-brand">
          <Link href="/" className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/cubes.im_logo_big.png" alt="" className="brand-img sm" /> Cubes
          </Link>
          <p className="foot-tag">
            The open-source all-in-one workspace for agencies — projects, video
            review, client portals and social publishing behind one login.
          </p>
          <a className="foot-gh" href={GITHUB_URL} target="_blank" rel="noreferrer">
            <GitHubMark size={15} /> Star on GitHub
          </a>
        </div>

        <div className="foot-col">
          <div className="foot-head">Product</div>
          {MARKETING_NAV.map((n) => (
            <Link key={n.label} href={n.href}>{n.label}</Link>
          ))}
        </div>

        <div className="foot-col">
          <div className="foot-head">Get started</div>
          <Link href="/early-access">Early access</Link>
          <Link href="/signup">Create account</Link>
          <Link href="/login">Sign in</Link>
          <Link href="/pricing">Cloud pricing</Link>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">Self-host</a>
        </div>

        <div className="foot-col">
          <div className="foot-head">Open source</div>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub repo</a>
          <a href={`${GITHUB_URL}/issues`} target="_blank" rel="noreferrer">Report an issue</a>
          <a href={`${GITHUB_URL}#readme`} target="_blank" rel="noreferrer">Docs</a>
        </div>
      </div>

      <div className="foot-bottom">
        <span>© 2026 Cubes · Open source, built in the open</span>
        <nav className="foot-legal">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/refunds">Refunds</Link>
        </nav>
        <span className="foot-tagline">🧊 One login. Zero glue work.</span>
      </div>
      </div>
    </footer>
  );
}

/** CTA panel styles — exported so the standalone /pricing page can reuse them. */
export const CTA_CSS = `
.cta{position:relative;border-radius:28px;padding:54px 30px 50px;text-align:center;overflow:hidden;color:#fff;background:radial-gradient(ellipse 75% 100% at 50% -30%, rgba(101,116,255,.38), transparent 62%),radial-gradient(ellipse 42% 58% at 90% 114%, rgba(224,85,155,.2), transparent 70%),radial-gradient(ellipse 42% 58% at 6% 114%, rgba(124,58,237,.18), transparent 70%),linear-gradient(180deg,#272e4b 0%,#131834 52%,#0a0e20 100%);border:1px solid rgba(255,255,255,.09);box-shadow:inset 0 1.5px 0 rgba(255,255,255,.18);}
.cta::before{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px);background-size:42px 42px;mask-image:radial-gradient(ellipse 85% 100% at 50% 0%,#000,transparent 78%);pointer-events:none;}
.cta-cube{position:relative;width:62px;height:62px;object-fit:contain;display:block;margin:0 auto 14px;}
.cta-h{position:relative;font-size:clamp(26px,3.4vw,40px);font-weight:800;letter-spacing:-.03em;margin:0;line-height:1.15;text-wrap:balance;background:linear-gradient(180deg,#fff 40%,#ccd3e4);-webkit-background-clip:text;background-clip:text;color:transparent;}
.cta-s{position:relative;font-size:15px;color:#aab1c2;margin:12px auto 26px;max-width:520px;line-height:1.6;}
.cta-btns{position:relative;display:flex;gap:12px;justify-content:center;flex-wrap:wrap;}
@media(max-width:560px){.cta{padding:42px 20px 38px;border-radius:22px;}}
`;

/** Footer styles — exported so standalone pages (/pricing) can reuse them. */
export const FOOT_CSS = `
.foot{position:relative;z-index:1;margin-top:72px;padding:0;color:#8b90a0;border-top:1px solid #ececf3;background:linear-gradient(180deg,#fbfcff,#f5f6fb);}
.foot-in{max-width:1080px;margin:0 auto;padding:0 22px 26px;}
.foot-grid{display:grid;grid-template-columns:1.7fr 1fr 1fr 1fr;gap:28px;padding:52px 0 36px;}
.foot-brand{display:flex;flex-direction:column;align-items:flex-start;}
.foot-tag{margin:12px 0 16px;font-size:13.5px;line-height:1.65;color:#7b8093;max-width:300px;}
.foot-gh{display:inline-flex;align-items:center;gap:7px;padding:8px 13px;border-radius:999px;background:#fff;border:1px solid #e6e7ee;box-shadow:0 6px 16px -12px rgba(16,24,40,.3);font-size:13px;font-weight:600;color:#2a2c3a;transition:transform .16s,border-color .16s;}
.foot-gh:hover{transform:translateY(-1px);border-color:#c9cbd4;}
.foot-col{display:flex;flex-direction:column;gap:11px;font-size:13.5px;color:#54586a;font-weight:500;}
.foot-col a{transition:color .15s;}
.foot-col a:hover{color:#0e0f17;}
.foot-head{font-size:11.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:#9ba0b0;margin-bottom:4px;}
.foot-bottom{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding-top:22px;border-top:1px solid #ececf3;font-size:12.5px;}
.foot-legal{display:flex;gap:16px;font-weight:500;color:#54586a;}
.foot-legal a{transition:color .15s;}
.foot-legal a:hover{color:#0e0f17;}
.foot-tagline{color:#9ba0b0;font-weight:600;}
@media(max-width:860px){.foot-grid{grid-template-columns:1fr 1fr;}.foot .foot-brand{grid-column:1 / -1;}}
@media(max-width:480px){.foot-grid{grid-template-columns:1fr;gap:22px;}.foot-bottom{flex-direction:column;align-items:flex-start;gap:6px;}}
`;

const SHELL_CSS = `
.mk{position:relative;min-height:100vh;background:#fbfbfe;color:#0e0f17;font-family:var(--font-geist-sans),system-ui,sans-serif;overflow-x:hidden;}
.mk *{box-sizing:border-box;}
.mk a{color:inherit;text-decoration:none;}
.mk-bg{position:fixed;inset:0;z-index:0;pointer-events:none;background-image:linear-gradient(rgba(15,17,30,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(15,17,30,.035) 1px,transparent 1px);background-size:44px 44px;mask-image:radial-gradient(ellipse 80% 50% at 50% 0%, #000, transparent 75%);}

.nav{position:sticky;top:0;z-index:40;}
.nav-in{max-width:1080px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 22px;position:relative;}
.nav::before{content:"";position:absolute;inset:0;background:rgba(251,251,254,.72);backdrop-filter:blur(12px);border-bottom:1px solid rgba(15,17,30,.06);z-index:-1;}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:20px;letter-spacing:-.02em;}
.brand-img{width:48px;height:48px;object-fit:contain;}
.brand-img.sm{width:32px;height:32px;}
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

.head{position:relative;z-index:1;max-width:1080px;margin:0 auto;padding:64px 22px 8px;}
.eyebrow{text-transform:uppercase;letter-spacing:.13em;font-size:12.5px;font-weight:800;color:#9ba0b0;}
.h1{font-size:clamp(34px,5vw,56px);font-weight:800;letter-spacing:-.035em;margin:10px 0 0;line-height:1.05;}
.lead{font-size:16px;color:#5b5d6b;line-height:1.65;max-width:640px;margin:18px 0 0;}
.h2{font-size:clamp(24px,3vw,34px);font-weight:800;letter-spacing:-.03em;margin:0 0 22px;}
.wrap{position:relative;z-index:1;max-width:1080px;margin:0 auto;padding:44px 22px 0;}

.faq-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 20px;}
.faq-item{background:#fff;border:1px solid #ececf3;border-radius:14px;overflow:hidden;height:fit-content;}
.faq-q{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:15px 16px;background:none;border:none;cursor:pointer;font-size:14px;font-weight:600;text-align:left;color:#0e0f17;font-family:inherit;}
.faq-a{overflow:hidden;transition:max-height .28s ease;}
.faq-a p{padding:0 16px 15px;margin:0;font-size:13.5px;color:#6a6a74;line-height:1.6;}

${CTA_CSS}

${FOOT_CSS}

@media(max-width:860px){
  .nav-links{display:none;}
  .burger{display:inline-flex;}
  .nav-right .btn.navy.sm,.lang{display:none;}
  .drawer{display:flex;flex-direction:column;gap:4px;position:absolute;top:64px;left:14px;right:14px;background:#fff;border:1px solid #ececf3;border-radius:16px;padding:12px;box-shadow:0 24px 50px -20px rgba(40,30,110,.4);}
  .drawer a{padding:11px 12px;border-radius:10px;font-weight:600;font-size:15px;}
  .drawer a:hover{background:#f4f4fb;}
  .faq-grid{grid-template-columns:1fr;}
}
`;
