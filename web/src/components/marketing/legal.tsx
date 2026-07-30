"use client";

import { MarketingShell } from "@/components/marketing/site-shell";

const ACCENT = "#4f5bd5";

/**
 * Shared layout for the legal pages (/terms, /privacy, /refunds): the
 * marketing shell around a single readable prose column. Pages pass their
 * sections as children (h2 + p/ul markup, styled here).
 */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <MarketingShell>
      <style>{LEGAL_CSS}</style>
      <section className="head">
        <div className="eyebrow">Legal</div>
        <h1 className="h1">{title}</h1>
        <p className="lead">Last updated: {updated}</p>
      </section>
      <section className="wrap">
        <div className="legal-body">{children}</div>
      </section>
    </MarketingShell>
  );
}

const LEGAL_CSS = `
.legal-body{max-width:760px;padding-bottom:24px;}
.legal-body h2{font-size:19px;font-weight:800;letter-spacing:-.02em;margin:34px 0 10px;color:#0e0f17;}
.legal-body h2:first-child{margin-top:0;}
.legal-body p{font-size:14.5px;line-height:1.75;color:#4a4c5a;margin:0 0 12px;}
.legal-body ul{margin:0 0 12px;padding-left:22px;}
.legal-body li{font-size:14.5px;line-height:1.75;color:#4a4c5a;margin-bottom:6px;}
.legal-body b,.legal-body strong{color:#0e0f17;}
.legal-body a{color:${ACCENT};font-weight:600;}
.legal-body a:hover{text-decoration:underline;}
`;
