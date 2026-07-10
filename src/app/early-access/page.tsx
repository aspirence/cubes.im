"use client";

import { useState } from "react";
import { MarketingShell, MIcon } from "@/components/marketing/site-shell";

const TEAM_SIZES = ["Just me", "2–10", "11–50", "51–200", "200+"];

type Status = "idle" | "submitting" | "error";

export default function EarlyAccessPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [teamSize, setTeamSize] = useState("");
  const [note, setNote] = useState("");
  const [website, setWebsite] = useState(""); // honeypot — bots fill this
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canSubmit = name.trim().length > 0 && emailOk && status !== "submitting";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (website) return; // honeypot tripped — silently ignore
    if (!canSubmit) return;
    setStatus("submitting");
    setErrorMsg("");

    try {
      const res = await fetch("/api/early-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          company: company.trim(),
          team_size: teamSize,
          note: note.trim(),
          website,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.payUrl) {
        setStatus("error");
        setErrorMsg(data.error || "Something went wrong — please try again.");
        return;
      }
      window.location.href = data.payUrl; // → payment
    } catch {
      setStatus("error");
      setErrorMsg("Something went wrong — please try again.");
    }
  }

  return (
    <MarketingShell active="/product">
      <style>{CSS}</style>
      <section className="ea">
        <>
            <div className="ea-head">
              <span className="ea-chip"><MIcon name="bolt" size={14} /> AT-Cubes v0.1 · Early access</span>
              <h1 className="ea-h">Reserve the AT-Cubes v0.1 device</h1>
              <p className="ea-sub">
                Be first to get <b>AT-Cubes v0.1</b> — the device that brings fingerprint
                attendance into your workspace. It&apos;s a one-time <b>$100</b>; founding-member
                spots are limited and no account is needed.
              </p>
            </div>

            <form className="ea-form" onSubmit={onSubmit} noValidate>
              <label className="ea-field">
                <span>Full name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Cooper" autoComplete="name" required />
              </label>
              <label className="ea-field">
                <span>Work email</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@company.com" autoComplete="email" required />
              </label>
              <label className="ea-field">
                <span>Company <i>(optional)</i></span>
                <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme Inc." autoComplete="organization" />
              </label>
              <label className="ea-field">
                <span>Team size <i>(optional)</i></span>
                <select value={teamSize} onChange={(e) => setTeamSize(e.target.value)}>
                  <option value="">Select…</option>
                  {TEAM_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="ea-field ea-full">
                <span>Anything else? <i>(optional)</i></span>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="What are you hoping to use Cubes for?" />
              </label>

              {/* honeypot — hidden from humans, catches bots */}
              <input className="ea-hp" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} aria-hidden />

              {status === "error" ? (
                <div className="ea-err">{errorMsg}</div>
              ) : null}

              <button type="submit" className="ea-btn" disabled={!canSubmit}>
                {status === "submitting" ? "Starting…" : <>Continue to payment · $100 <MIcon name="arrow_forward" size={18} /></>}
              </button>
              <p className="ea-fine">Next: a one-time <b>$100</b> payment for your AT-Cubes v0.1 device. No account needed.</p>
            </form>
        </>
      </section>
    </MarketingShell>
  );
}

const CSS = `
.ea{position:relative;z-index:1;max-width:640px;margin:0 auto;padding:52px 22px 44px;}
.ea-head{text-align:center;margin-bottom:24px;}
.ea-chip{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#17181f;background:#f1f2f6;padding:6px 12px;border-radius:999px;}
.ea-h{font-size:clamp(28px,4vw,40px);font-weight:800;letter-spacing:-.03em;margin:16px 0 0;color:#0e0f17;}
.ea-sub{font-size:15px;color:#5b5d6b;line-height:1.6;margin:12px auto 0;max-width:460px;text-align:center;}
.ea-sub b{color:#0e0f17;font-weight:700;}

.ea-form{display:grid;grid-template-columns:1fr 1fr;gap:16px;background:#fff;border-radius:26px;padding:30px;box-shadow:0 24px 60px -40px rgba(16,24,40,.35);}
.ea-field{display:flex;flex-direction:column;gap:7px;}
.ea-field.ea-full{grid-column:1 / -1;}
.ea-field>span{font-size:13px;font-weight:600;color:#3a3c4a;}
.ea-field>span i{color:#9a9eab;font-weight:500;font-style:normal;}
.ea-field input,.ea-field select,.ea-field textarea{font:inherit;font-size:14.5px;color:#0e0f17;background:#fafafb;border:1px solid #e6e7ee;border-radius:12px;padding:11px 13px;outline:none;transition:border-color .15s;width:100%;}
.ea-field input:focus,.ea-field select:focus,.ea-field textarea:focus{border-color:#0e0f17;box-shadow:0 0 0 3px rgba(15,17,30,.10);}
.ea-field textarea{resize:vertical;min-height:82px;}
.ea-hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0;}
.ea-err{grid-column:1 / -1;font-size:13.5px;color:#b4342a;background:#fdecec;border-radius:11px;padding:11px 13px;}
.ea-btn{grid-column:1 / -1;display:inline-flex;align-items:center;justify-content:center;gap:8px;background:#111319;color:#fff;font-size:15px;font-weight:600;padding:15px 24px;border-radius:999px;border:none;cursor:pointer;margin-top:4px;}
.ea-btn:disabled{opacity:.5;cursor:not-allowed;}
.ea-btn.ghost{background:#fff;color:#0e0f17;border:1px solid #e6e7ee;}
.ea-fine{grid-column:1 / -1;font-size:12px;color:#9a9eab;text-align:center;margin:6px 0 0;line-height:1.5;}

.ea-done{text-align:center;background:#fff;border-radius:26px;padding:48px 30px;box-shadow:0 24px 60px -40px rgba(16,24,40,.35);max-width:520px;margin:0 auto;}
.ea-done-ic{display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:999px;background:#17181f;color:#fff;}
.ea-done .ea-h{margin-top:18px;}
.ea-done .ea-btn{display:inline-flex;width:auto;margin-top:22px;padding:13px 22px;}

@media(max-width:560px){.ea-form{grid-template-columns:1fr;padding:24px 20px;}}
`;
