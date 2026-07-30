import Link from "next/link";
import { MarketingShell, MIcon } from "@/components/marketing/site-shell";

const BELIEFS = [
  "Software should remove glue work — not add more of it.",
  "One workspace beats ten disconnected tools.",
  "The best software reaches into the real world. Hardware included.",
  "Open source, so the work always stays yours.",
];

const PHASES: { n: string; status: string; now?: boolean; title: string; desc: string }[] = [
  {
    n: "01",
    status: "Shipping now",
    now: true,
    title: "The workspace management system",
    desc: "The all-in-one workspace — projects, docs, video review, client portals, social and people ops — behind one login. This is what we launch first, and it works on its own.",
  },
  {
    n: "02",
    status: "Next",
    title: "AT-Cubes v1.0 & the mobile app",
    desc: "Our first hardware — a device that brings fingerprint attendance and a perfectly-synced workforce into the workspace — plus a mobile app so your team can run everything on the go. Optional by design; early access is open now.",
  },
  {
    n: "03",
    status: "The road ahead",
    title: "More, built in the open",
    desc: "Deeper automation and AI, new modules, and hardware that keeps closing the gap between the work and the world — shaped by the people who actually use it.",
  },
];

export default function ManifestoPage() {
  return (
    <MarketingShell active="/manifesto">
      <style>{CSS}</style>

      {/* HERO */}
      <section className="mf-head">
        <span className="mf-eyebrow"><MIcon name="bolt" size={13} /> Manifesto</span>
        <h1 className="mf-h1">
          <span className="ink">The work, and everything around it —</span>{" "}
          <span className="silver">one system.</span>
        </h1>
        <p className="mf-lead">
          We&apos;re building one place where a team plans, creates, reviews and runs the
          business — and the hardware that ties the real world back to it. Software and
          hardware, one login, open source.
        </p>
      </section>

      {/* BELIEFS */}
      <section className="mf-wrap">
        <div className="mf-beliefs">
          {BELIEFS.map((b) => (
            <div key={b} className="mf-belief">
              <span className="mf-belief-dot" aria-hidden />
              {b}
            </div>
          ))}
        </div>
      </section>

      {/* ROADMAP */}
      <section className="mf-wrap">
        <h2 className="mf-h2">Where we are — and where we&apos;re going</h2>
        <div className="mf-phases">
          {PHASES.map((p) => (
            <div key={p.n} className={`mf-phase${p.now ? " now" : ""}`}>
              <div className="mf-phase-n">{p.n}</div>
              <div>
                <span className={`mf-phase-status${p.now ? " on" : ""}`}>{p.status}</span>
                <div className="mf-phase-title">{p.title}</div>
                <p className="mf-phase-desc">{p.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mf-wrap mf-cta-wrap">
        <div className="mf-cta">
          <h2 className="mf-cta-h">Phase one is here.</h2>
          <p className="mf-cta-s">Start with the workspace today, or reserve AT-Cubes v0.1.</p>
          <div className="mf-cta-btns">
            <Link href="/signup" className="mf-btn dark">Start free <MIcon name="arrow_forward" size={17} /></Link>
            <Link href="/early-access" className="mf-btn light">Get early access</Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}

const CSS = `
.mf-head{position:relative;z-index:1;max-width:920px;margin:0 auto;padding:56px 22px 8px;text-align:center;}
.mf-eyebrow{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#17181f;background:#f1f2f6;padding:6px 12px;border-radius:999px;}
.mf-h1{font-size:clamp(32px,5vw,56px);line-height:1.05;font-weight:800;letter-spacing:-.04em;margin:18px 0 0;text-wrap:balance;}
.mf-h1 .ink{color:#141a2e;}
.mf-h1 .silver{background:linear-gradient(180deg,#c7cfe2,#a4b0ca);-webkit-background-clip:text;background-clip:text;color:transparent;}
.mf-lead{font-size:16px;color:#5b5d6b;line-height:1.65;max-width:620px;margin:18px auto 0;}

.mf-wrap{position:relative;z-index:1;max-width:920px;margin:0 auto;padding:34px 22px 0;}
.mf-beliefs{display:grid;grid-template-columns:1fr 1fr;gap:14px 28px;}
.mf-belief{display:flex;align-items:flex-start;gap:12px;font-size:15px;font-weight:600;color:#2a2c3a;line-height:1.45;}
.mf-belief-dot{flex:none;width:8px;height:8px;border-radius:999px;background:#17181f;margin-top:7px;}

.mf-h2{font-size:clamp(22px,3vw,30px);font-weight:800;letter-spacing:-.03em;margin:0 0 22px;color:#0e0f17;}
.mf-phases{display:flex;flex-direction:column;gap:14px;}
.mf-phase{display:grid;grid-template-columns:auto 1fr;gap:26px;align-items:start;background:#fff;border-radius:24px;padding:28px 30px;box-shadow:0 18px 44px -34px rgba(16,24,40,.3);}
.mf-phase.now{background:radial-gradient(120% 100% at 0% 0%, #23252f 0%, #14161c 60%, #0c0d11 100%);color:#fff;box-shadow:0 24px 54px -34px rgba(12,13,17,.55);}
.mf-phase-n{font-size:clamp(38px,4vw,52px);font-weight:800;letter-spacing:-.04em;line-height:1;color:#e4e6ec;}
.mf-phase.now .mf-phase-n{color:rgba(255,255,255,.28);}
.mf-phase-status{display:inline-block;font-size:11px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:#8a8f9e;background:#f1f2f6;padding:4px 10px;border-radius:999px;}
.mf-phase-status.on{color:#111319;background:#fff;}
.mf-phase-title{font-size:19px;font-weight:800;letter-spacing:-.01em;margin:12px 0 0;color:#0e0f17;}
.mf-phase.now .mf-phase-title{color:#fff;}
.mf-phase-desc{font-size:14.5px;line-height:1.6;color:#5b5d6b;margin:8px 0 0;max-width:560px;}
.mf-phase.now .mf-phase-desc{color:#b8bcc8;}

.mf-cta-wrap{padding-bottom:8px;}
.mf-cta{text-align:center;background:#f4f4f6;border-radius:28px;padding:44px 30px;}
.mf-cta-h{font-size:clamp(24px,3.2vw,34px);font-weight:800;letter-spacing:-.03em;margin:0;color:#0e0f17;}
.mf-cta-s{font-size:15px;color:#5b5d6b;margin:12px auto 0;line-height:1.6;}
.mf-cta-btns{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:22px;}
.mf-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-size:14.5px;font-weight:700;padding:13px 22px;border-radius:999px;}
.mf-cta .mf-btn.dark{background:#111319;color:#fff;}
.mf-cta .mf-btn.light{background:#fff;color:#0e0f17;border:1px solid #e6e7ee;}

@media(max-width:640px){
  .mf-beliefs{grid-template-columns:1fr;}
  .mf-phase{grid-template-columns:1fr;gap:8px;padding:24px 22px;}
  .mf-cta{padding:34px 20px;}
}
`;
