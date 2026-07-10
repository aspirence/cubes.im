"use client";

import Link from "next/link";
import { MarketingShell, MIcon } from "@/components/marketing/site-shell";

const EARLY_ACCESS = [
  "Instant access to the Cloud beta",
  "Founding-member badge & locked-in pricing",
  "Vote on the roadmap — a direct line to the team",
  "Unlimited team members, every module included",
  "Priority support throughout early access",
];

export default function ProductPage() {
  return (
    <MarketingShell active="/product">
      <style>{CSS}</style>

      {/* HERO HEADLINE (real text — two-tone) */}
      <section className="pd-head">
        <div className="pd-notice">
          <span className="pd-notice-tag">New</span>
          <span>
            The first <b>hardware-enabled</b> workforce management system for businesses —
            introducing <b>AT-Cubes v0.1</b>
          </span>
        </div>
        <h1 className="pd-h1">
          <span className="ink">smart</span>{" "}
          <span className="silver">fingerprint attendance</span>{" "}
          <span className="ink">&amp; perfectly synced workforce,</span>
        </h1>
        <p className="pd-sub">
          The hardware is optional — Cubes is a complete project management system on
          its own. Add <b>AT-Cubes</b> only when you want fingerprint attendance built in.
        </p>
      </section>

      {/* HERO VISUAL — swap in a text-free image */}
      <section className="pd-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/product_page_hero.png" alt="Cubes attendance & workforce" />
      </section>

      {/* PROCESS — how AT-Cubes works, in 3 steps */}
      <section className="pd-proc" aria-label="How AT-Cubes works">
        <div className="pd-proc-grid">
          {[1, 2, 3].map((n) => (
            <div key={n} className="pd-proc-card">
              <span className="pd-proc-n">{`0${n}`}</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/brand/atcubes-process-${n}.png`} alt={`How AT-Cubes works — step ${n} of 3`} />
            </div>
          ))}
        </div>
      </section>

      {/* EARLY ACCESS */}
      <section className="pd-ea-wrap">
        <div className="pd-ea">
          <div className="pd-ea-main">
            <span className="pd-ea-chip"><MIcon name="bolt" size={14} /> Early access</span>
            <h2 className="pd-ea-h">Become a founding member</h2>
            <p className="pd-ea-sub">
              Get into Cubes before public launch — lock in founding pricing and help
              shape what ships next.
            </p>
            <div className="pd-ea-list">
              {EARLY_ACCESS.map((f) => (
                <div key={f} className="pd-ea-li">
                  <span className="pd-ea-check"><MIcon name="check" size={14} /></span>{f}
                </div>
              ))}
            </div>
          </div>

          <div className="pd-ea-buy">
            <span className="pd-ea-buy-label">Founding price</span>
            <div className="pd-ea-price">$100 <span>one-time</span></div>
            <Link href="/early-access" className="pd-ea-btn">
              Get early access <MIcon name="arrow_forward" size={18} />
            </Link>
            <div className="pd-ea-note">Limited founding-member spots · Lifetime early access</div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}

const CSS = `
.pd-head{position:relative;z-index:1;max-width:1160px;margin:0 auto;padding:52px 22px 0;text-align:center;}
.pd-notice{display:inline-flex;align-items:center;gap:9px;max-width:560px;font-size:13px;font-weight:500;color:#4a4c5a;background:#fff;border:1px solid #ececf3;padding:6px 15px 6px 6px;border-radius:999px;box-shadow:0 10px 26px -16px rgba(16,24,40,.3);margin-bottom:24px;line-height:1.35;text-align:left;}
.pd-notice-tag{flex:none;font-size:9.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#fff;background:#17181f;padding:3px 8px;border-radius:999px;}
.pd-notice b{color:#0e0f17;font-weight:700;}
@media(max-width:560px){.pd-notice{font-size:12px;}}
.pd-h1{font-size:clamp(34px,4.6vw,60px);line-height:1.05;font-weight:800;letter-spacing:-.045em;margin:0;text-wrap:balance;}
.pd-h1 .ink{color:#141a2e;}
.pd-h1 .silver{background:linear-gradient(180deg,#c7cfe2,#a4b0ca);-webkit-background-clip:text;background-clip:text;color:transparent;}
.pd-sub{font-size:15.5px;color:#5b5d6b;line-height:1.6;margin:20px auto 0;max-width:600px;}
.pd-sub b{color:#0e0f17;font-weight:700;}

.pd-hero{position:relative;z-index:1;max-width:680px;margin:0 auto;padding:24px 22px 4px;}
.pd-hero img{display:block;width:100%;height:auto;border-radius:20px;}

.pd-proc{position:relative;z-index:1;max-width:1080px;margin:0 auto;padding:28px 22px 8px;}
.pd-proc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;}
.pd-proc-card{position:relative;overflow:hidden;background:#ecedf1;border-radius:20px;box-shadow:0 14px 34px -30px rgba(16,24,40,.3);}
.pd-proc-card img{display:block;width:100%;height:auto;}
.pd-proc-n{position:absolute;top:14px;left:14px;z-index:1;font-size:12px;font-weight:800;letter-spacing:.06em;color:#fff;background:#17181f;padding:3px 9px;border-radius:999px;}
@media(max-width:820px){.pd-proc-grid{grid-template-columns:1fr;max-width:420px;margin:0 auto;}}

.pd-ea-wrap{position:relative;z-index:1;max-width:1080px;margin:0 auto;padding:34px 22px 24px;}
.pd-ea{position:relative;display:grid;grid-template-columns:1.12fr .88fr;gap:28px;align-items:stretch;background:#fff;border-radius:32px;padding:30px 34px;}
.pd-ea-chip{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#17181f;background:#f1f2f6;padding:5px 11px;border-radius:999px;}
.pd-ea-h{font-size:clamp(23px,2.8vw,32px);font-weight:800;letter-spacing:-.03em;margin:13px 0 0;color:#0e0f17;line-height:1.08;}
.pd-ea-sub{font-size:14px;color:#5b5d6b;line-height:1.55;margin:9px 0 0;max-width:440px;}
.pd-ea-list{display:grid;gap:10px;margin:18px 0 0;}
.pd-ea-li{display:flex;align-items:center;gap:10px;font-size:14px;color:#2a2c3a;}
.pd-ea-check{flex:none;width:20px;height:20px;border-radius:999px;background:#17181f;color:#fff;display:inline-flex;align-items:center;justify-content:center;}
.pd-ea-buy{position:relative;overflow:hidden;display:flex;flex-direction:column;justify-content:center;text-align:center;background:#f4f4f6;border-radius:24px;padding:28px 24px;color:#0e0f17;}
.pd-ea-buy-label{font-size:10.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#6a6e7d;margin-bottom:9px;}
.pd-ea-price{font-size:clamp(40px,4.4vw,50px);font-weight:800;letter-spacing:-.03em;color:#0e0f17;margin:0;line-height:1;}
.pd-ea-price span{font-size:14px;font-weight:600;color:#6a6e7d;letter-spacing:0;}
.pd-ea-buy .pd-ea-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;background:#17181f;color:#fff;font-size:14.5px;font-weight:700;padding:13px 22px;border-radius:999px;margin-top:18px;box-shadow:0 10px 22px -14px rgba(16,24,40,.5);}
.pd-ea-note{font-size:12px;color:#5b5d6b;margin-top:12px;line-height:1.5;}

@media(max-width:820px){
  .pd-ea{grid-template-columns:1fr;gap:28px;padding:36px 28px;}
  .pd-ea-sub{max-width:none;}
}
@media(max-width:480px){
  .pd-ea{padding:26px 20px;}
  .pd-ea-buy{padding:26px 20px;}
}
`;
