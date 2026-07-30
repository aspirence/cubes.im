"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MarketingShell, MIcon } from "@/components/marketing/site-shell";

type Summary = { firstName: string; email: string; paymentStatus: string; amountCents: number };
type State = "loading" | "ready" | "paying" | "paid" | "error";

export default function PayPage() {
  return (
    <MarketingShell active="/product">
      <style>{CSS}</style>
      <Suspense fallback={<section className="pay" />}>
        <PayInner />
      </Suspense>
    </MarketingShell>
  );
}

function PayInner() {
  const reqId = useSearchParams().get("req");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [state, setState] = useState<State>("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!reqId) return;
    let cancelled = false;
    fetch(`/api/early-access?req=${encodeURIComponent(reqId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((s: Summary) => {
        if (cancelled) return;
        setSummary(s);
        setState(s.paymentStatus === "paid" ? "paid" : "ready");
      })
      .catch(() => {
        if (cancelled) return;
        setState("error");
        setErrorMsg("We couldn't find that order.");
      });
    return () => {
      cancelled = true;
    };
  }, [reqId]);

  async function pay() {
    if (!reqId) return;
    setState("paying");
    setErrorMsg("");
    try {
      // Try the real Dodo checkout first; redirect there when it's configured.
      const res = await fetch("/api/early-access/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: reqId }),
      });
      const data = await res.json();
      if (res.ok && data.checkout_url) {
        window.location.href = data.checkout_url;
        return;
      }
      if (res.ok && data.alreadyPaid) {
        setState("paid");
        return;
      }
      if (data.error && data.error !== "not_configured") {
        setState("ready");
        setErrorMsg(data.error);
        return;
      }
      // Payments not configured yet → built-in test checkout (no real charge).
      const testRes = await fetch("/api/early-access/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: reqId }),
      });
      const testData = await testRes.json();
      if (!testRes.ok) {
        setState("ready");
        setErrorMsg(testData.error || "Payment failed — please try again.");
        return;
      }
      setState("paid");
    } catch {
      setState("ready");
      setErrorMsg("Payment failed — please try again.");
    }
  }

  if (!reqId || state === "error") {
    return (
      <section className="pay">
        <div className="pay-done">
          <h1 className="pay-h">Order not found</h1>
          <p className="pay-sub">{errorMsg || "Missing order reference."}</p>
          <Link href="/early-access" className="pay-btn ghost">Start over</Link>
        </div>
      </section>
    );
  }

  const cents = summary?.amountCents ?? 10000;
  const dollars = (cents / 100).toFixed(cents % 100 ? 2 : 0);

  if (state === "paid") {
    return (
      <section className="pay">
        <div className="pay-done">
          <span className="pay-done-ic"><MIcon name="check" size={30} /></span>
          <h1 className="pay-h">You&apos;re on the list</h1>
          <p className="pay-sub">
            Thanks{summary?.firstName ? `, ${summary.firstName}` : ""} — your payment is
            confirmed. We&apos;ll email {summary?.email ? <b>{summary.email}</b> : "you"} your{" "}
            <b>AT-Cubes v0.1</b> founding-member details before public launch.
          </p>
          <Link href="/product" className="pay-btn ghost">Back to product</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="pay">
      <div className="pay-card">
        <span className="pay-chip"><MIcon name="lock" size={13} /> Secure checkout</span>
        <h1 className="pay-h">Complete your order</h1>
        <div className="pay-line">
          <div>
            <div className="pay-item">AT-Cubes v0.1 device</div>
            <div className="pay-meta">Early access · founding member</div>
          </div>
          <div className="pay-amt">${dollars}</div>
        </div>
        <div className="pay-total"><span>Total due</span><b>${dollars} <i>one-time</i></b></div>
        {errorMsg ? <div className="pay-err">{errorMsg}</div> : null}
        <button className="pay-btn" onClick={pay} disabled={state !== "ready"}>
          {state === "paying" ? "Processing…" : <>Pay ${dollars}</>}
        </button>
        <p className="pay-note">Test checkout — no real charge yet. The live Dodo payment activates once keys are added.</p>
      </div>
    </section>
  );
}

const CSS = `
.pay{position:relative;z-index:1;max-width:520px;margin:0 auto;padding:56px 22px 44px;}
.pay-card,.pay-done{background:#fff;border-radius:26px;padding:34px 30px;box-shadow:0 24px 60px -40px rgba(16,24,40,.35);}
.pay-done{text-align:center;padding:48px 30px;}
.pay-done-ic{display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:999px;background:#17181f;color:#fff;margin-bottom:18px;}
.pay-chip{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#5b5d6b;background:#f1f2f6;padding:5px 11px;border-radius:999px;}
.pay-h{font-size:clamp(24px,3.4vw,30px);font-weight:800;letter-spacing:-.03em;margin:14px 0 0;color:#0e0f17;}
.pay-sub{font-size:14.5px;color:#5b5d6b;line-height:1.6;margin:12px 0 0;}
.pay-sub b{color:#0e0f17;font-weight:700;}
.pay-line{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:22px 0 0;padding:16px 0;border-top:1px solid #eef0f4;border-bottom:1px solid #eef0f4;}
.pay-item{font-size:15px;font-weight:700;color:#0e0f17;}
.pay-meta{font-size:12.5px;color:#8b90a0;margin-top:2px;}
.pay-amt{font-size:16px;font-weight:700;color:#0e0f17;}
.pay-total{display:flex;align-items:center;justify-content:space-between;margin:16px 0 0;font-size:14px;color:#5b5d6b;}
.pay-total b{font-size:22px;font-weight:800;color:#0e0f17;letter-spacing:-.02em;}
.pay-total b i{font-size:13px;font-weight:600;color:#9a9eab;font-style:normal;}
.pay-err{font-size:13.5px;color:#b4342a;background:#fdecec;border-radius:11px;padding:11px 13px;margin-top:16px;}
.pay-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;background:#111319;color:#fff;font-size:15px;font-weight:700;padding:15px 24px;border-radius:999px;border:none;cursor:pointer;margin-top:20px;}
.pay-btn:disabled{opacity:.55;cursor:not-allowed;}
.pay-btn.ghost{display:inline-flex;width:auto;background:#fff;color:#0e0f17;border:1px solid #e6e7ee;margin-top:22px;padding:13px 22px;}
.pay-note{font-size:12px;color:#9a9eab;text-align:center;margin:14px 0 0;line-height:1.5;}
`;
