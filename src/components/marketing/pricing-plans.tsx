"use client";

import { useState } from "react";
import Link from "next/link";
import { usePlatformPricing, storageOverageCents, money } from "@/features/billing/use-pricing";

function MIcon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1 }}>
      {name}
    </span>
  );
}

export const GITHUB_URL = "https://github.com/aspirence/cubes.im";

/**
 * The Self-hosted vs Cloud plan cards (shared by the landing section and the
 * dedicated /pricing page). Cloud pricing is read live from platform_pricing,
 * so super-admin changes show up everywhere at once.
 */
export function PricingPlans() {
  const { data: pricing } = usePlatformPricing();
  const [gb, setGb] = useState<number | null>(null);
  const p = pricing;
  const base = p?.base_storage_gb ?? 100;
  const rate = p?.price_per_gb_cents ?? 0;
  const storage = gb ?? base;
  const extraGb = Math.max(0, storage - base);
  const perUser = p?.price_per_user_cents ?? 100;
  const addon = p ? storageOverageCents(p, storage) : 0;
  const cur = p?.currency ?? "USD";
  const maxGb = Math.max(1000, base * 10);

  return (
    <>
      <style>{PLANS_CSS}</style>
      <div className="plans-panel">
      <div className="plans">
        {/* Self-hosted — open source */}
        <div className="plan">
          <div className="plan-head">
            <span className="plan-ic"><MIcon name="dns" size={20} /></span>
            <div>
              <div className="plan-name">Self-hosted</div>
              <div className="plan-tag">Open source</div>
            </div>
          </div>
          <div className="plan-price">
            {money(0, cur)}<span>/forever</span>
          </div>
          <p className="plan-desc">
            Cubes is open source. Clone it, deploy it on your own servers, and run
            your whole team on it — no seat limits, no meters, no strings.
          </p>
          <a className="pbtn ghost" href={GITHUB_URL} target="_blank" rel="noreferrer">
            <MIcon name="code" size={18} /> View on GitHub
          </a>
        </div>

        {/* Cloud — hosted, storage-based */}
        <div className="plan featured">
          <span className="plan-pop"><MIcon name="star" size={13} /> Most popular</span>
          <div className="plan-head">
            <span className="plan-ic indigo"><MIcon name="cloud" size={20} /></span>
            <div>
              <div className="plan-name">Cloud</div>
              <div className="plan-tag">Hosted &amp; managed by us</div>
            </div>
          </div>
          <div className="plan-price">
            {p ? money(perUser, cur) : "—"}<span>/user/month</span>
          </div>
          <p className="plan-desc">
            Simple <b>per-seat pricing</b> — pay only for who&apos;s on your team.
            Every workspace includes <b>{base} GB</b> of storage; add more whenever
            you need it.
          </p>

          <div className="plan-slider">
            <div className="plan-slider-h">
              <span>Storage</span>
              <span>{storage} GB</span>
            </div>
            <input
              type="range"
              min={base}
              max={maxGb}
              step={10}
              value={storage}
              onChange={(e) => setGb(Number(e.target.value))}
            />
            <div className="plan-math">
              <div><span>Per user / month</span><b>{money(perUser, cur)}</b></div>
              <div><span>{base} GB storage — included</span><b>{money(0, cur)}</b></div>
              <div><span>Extra storage — {extraGb} GB × {money(rate, cur)}</span><b>{money(addon, cur)}</b></div>
              <div className="plan-math-total"><span>Per user</span><b>{money(perUser, cur)}/mo{addon > 0 ? " + storage" : ""}</b></div>
            </div>
          </div>

          <Link href="/signup" className="pbtn solid">Start free <MIcon name="arrow_forward" size={18} /></Link>
        </div>
      </div>
      </div>
      <p className="plans-note">
        Cloud is {money(perUser, cur)} per user / month with {base} GB storage included —
        buy extra storage anytime from Billing. Self-hosted stays free forever.
      </p>
    </>
  );
}

const PLANS_CSS = `
.plans-panel{background:#f3f3f5;border:1px solid #ececee;border-radius:30px;padding:10px;}
.plans{display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:stretch;}
.plan{position:relative;background:transparent;border-radius:24px;padding:28px;display:flex;flex-direction:column;text-align:left;}
.plan.featured{background:#fff;border-radius:24px;box-shadow:0 20px 48px -30px rgba(16,24,40,.32), inset 0 1.5px 0 rgba(255,255,255,.9);}
.plan-pop{position:absolute;top:20px;right:20px;display:inline-flex;align-items:center;gap:5px;background:#fff;color:#1b1d26;font-size:11.5px;font-weight:700;letter-spacing:.01em;padding:6px 12px;border-radius:999px;box-shadow:0 6px 16px -9px rgba(16,24,40,.4);border:1px solid #ececef;}
.plan-head{display:flex;align-items:center;gap:12px;margin-bottom:18px;}
.plan-ic{width:46px;height:46px;border-radius:14px;background:#17181f;color:#fff;display:inline-flex;align-items:center;justify-content:center;flex:none;}
.plan-ic.indigo{background:#eceef3;color:#17181f;}
.plan-name{font-size:19px;font-weight:800;letter-spacing:-.01em;color:#0e0f17;}
.plan-tag{font-size:12.5px;color:#8b90a0;font-weight:500;}
.plan-price{font-size:clamp(34px,4vw,44px);font-weight:800;letter-spacing:-.03em;margin:2px 0 6px;color:#0e0f17;}
.plan-price span{font-size:15px;font-weight:600;color:#9a9eab;}
.plan-desc{font-size:14px;color:#5b5d6b;line-height:1.6;margin:0 0 16px;}
.plan-slider{background:#fafafb;border:1px solid #eeeef2;border-radius:16px;padding:14px;}
.plan-slider-h{display:flex;justify-content:space-between;font-size:13px;font-weight:700;margin-bottom:8px;color:#0e0f17;}
.plan-slider input[type=range]{width:100%;accent-color:#17181f;cursor:pointer;}
.plan-math{margin-top:12px;display:grid;gap:6px;font-size:12.5px;color:#5b5d6b;}
.plan-math>div{display:flex;justify-content:space-between;gap:10px;}
.plan-math b{color:#1c1e2b;font-weight:700;}
.plan-math-total{border-top:1px solid #ececf3;padding-top:8px;font-size:13.5px;}
.plan-math-total b{color:#0e0f17;font-size:15px;}
.plans-note{font-size:12.5px;color:#8b90a0;margin:16px 4px 0;text-align:center;}
.pbtn{display:inline-flex;align-items:center;justify-content:center;gap:7px;width:100%;margin-top:auto;font-size:14.5px;font-weight:600;padding:14px 24px;border-radius:999px;cursor:pointer;border:1px solid transparent;transition:transform .16s,box-shadow .16s;text-decoration:none;}
.pbtn.solid{background:#111319;color:#fff;border:1px solid rgba(255,255,255,.06);box-shadow:0 14px 30px -14px rgba(16,24,40,.6);}
.pbtn.solid:hover{transform:translateY(-2px);}
.pbtn.ghost{background:#17181f;border-color:transparent;color:#fff;box-shadow:0 14px 30px -14px rgba(16,24,40,.5);}
.pbtn.ghost:hover{transform:translateY(-2px);}
@media(max-width:900px){.plans{grid-template-columns:1fr;}.plan.featured{box-shadow:0 16px 40px -28px rgba(16,24,40,.32);}}
@media(max-width:560px){.plan{padding:22px;}}
`;
