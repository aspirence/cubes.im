"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { GITHUB_URL } from "@/components/marketing/pricing-plans";
import { JsonLd } from "@/components/marketing/json-ld";
import { organizationLd, websiteLd, softwareApplicationLd } from "@/lib/seo";

/* ------------------------------------------------------------------ helpers */

function GitHubMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.55v-2.17c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 2.9-.39c.98 0 1.97.13 2.9.39 2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.66.41.36.78 1.06.78 2.14v3.17c0 .31.21.66.8.55A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}


function MIcon({ name, size = 20, style }: { name: string; size?: number; style?: React.CSSProperties }) {
  return (
    <span className="material-symbols-rounded" aria-hidden style={{ fontSize: size, lineHeight: 1, ...style }}>
      {name}
    </span>
  );
}

function Reveal({ children, delay = 0, style }: { children: React.ReactNode; delay?: number; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setSeen(true)), { threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className={`rv${seen ? " in" : ""}`} style={{ transitionDelay: `${delay}ms`, ...style }}>{children}</div>;
}

/* ------------------------------------------------- interactive cube field */

/**
 * A grid of glassy gradient "cubes" behind the hero. Each cube springs back to
 * its home cell but is pushed away from the cursor — move (or drag) the mouse
 * and the field ripples like it has physics. Rendered imperatively for perf.
 */
function CubeField() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    // Colour ramp across X: blue -> pale -> near-white -> lavender -> violet -> magenta -> pink.
    const STOPS: [number, number, number][] = [
      [70, 124, 255], [150, 182, 252], [222, 228, 248], [196, 168, 250],
      [168, 100, 240], [210, 88, 224], [255, 110, 200],
    ];
    const ramp = (f: number) => {
      const seg = Math.min(0.999, Math.max(0, f)) * (STOPS.length - 1);
      const i = Math.floor(seg), t = seg - i;
      const a = STOPS[i], b = STOPS[Math.min(i + 1, STOPS.length - 1)];
      return `${Math.round(lerp(a[0], b[0], t))},${Math.round(lerp(a[1], b[1], t))},${Math.round(lerp(a[2], b[2], t))}`;
    };

    // Skyline: tall stacks at the edges, low through the middle (like the ref).
    const ANCHORS = [1.0, 0.8, 0.55, 0.4, 0.45, 0.25, 0.35, 0.2, 0.3, 0.24, 0.36, 0.3, 0.48, 0.62, 0.8, 0.95, 1.08, 1.2];
    const anchorAt = (f: number) => {
      const seg = Math.min(0.999, Math.max(0, f)) * (ANCHORS.length - 1);
      const i = Math.floor(seg), t = seg - i;
      return lerp(ANCHORS[i], ANCHORS[Math.min(i + 1, ANCHORS.length - 1)], t);
    };
    // Deterministic per-cell jitter so rebuilds don't reshuffle the skyline.
    const rand = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

    const build = () => {
      host.innerHTML = "";
      const w = host.clientWidth, h = host.clientHeight;
      const size = Math.max(44, Math.min(100, w / 14.5));
      const gap = Math.max(4, size * 0.055);
      const pitch = size + gap;
      const cols = Math.ceil(w / pitch) + 1;
      const maxRows = Math.max(3, Math.round(h / pitch));
      const filled = new Set<string>();
      const cells: { r: number; c: number; fx: number; rf: number; float?: boolean }[] = [];

      for (let c = 0; c < cols; c++) {
        const fx = cols > 1 ? c / (cols - 1) : 0;
        let stack = Math.round(anchorAt(fx) * maxRows + (rand(c) - 0.5) * 0.8);
        stack = Math.max(1, Math.min(maxRows, stack));
        for (let r = 0; r < stack; r++) {
          if (r === stack - 1 && rand(c * 7 + r) < 0.1) continue; // occasional notch
          filled.add(r + "," + c);
          cells.push({ r, c, fx, rf: stack > 1 ? r / (stack - 1) : 0 });
        }
        // Detached floaters only near the coloured edges — never mid-hero under the headline.
        if (rand(c * 13 + 5) < 0.22 && (fx < 0.25 || fx > 0.7)) {
          const fr = stack + 1 + Math.round(rand(c * 3) * 1.4);
          filled.add(fr + "," + c);
          cells.push({ r: fr, c, fx, rf: 1, float: true });
        }
      }

      for (const cell of cells) {
        const { r, c, fx, rf } = cell;
        const hx = c * pitch;
        const hy = h - (r + 1) * pitch + gap;
        const alpha = cell.float ? 0.5 : 1 - rf * 0.4;
        const col = ramp(fx);
        const el = document.createElement("div");
        el.className = "cube";
        el.style.left = `${hx}px`;
        el.style.top = `${hy}px`;
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
        el.style.borderRadius = `${size * 0.21}px`;
        // Frosted-glass look: a broad white reflection sweeping the top, with the
        // colour glowing up from the base of the tile (like lit acrylic).
        el.style.background =
          `linear-gradient(168deg, rgba(255,255,255,.92) 0%, rgba(255,255,255,.4) 34%, rgba(255,255,255,.06) 58%), ` +
          `radial-gradient(circle at 50% 118%, rgba(${col}, ${alpha}) 0%, rgba(${col}, ${alpha * 0.8}) 52%, rgba(${col}, ${Math.max(0.14, alpha * 0.3)}) 100%)`;
        el.style.boxShadow =
          `0 ${size * 0.16}px ${size * 0.4}px -${size * 0.18}px rgba(${col}, .55), ` +
          `inset 0 ${-size * 0.07}px ${size * 0.2}px rgba(${col}, ${alpha * 0.45}), ` +
          `inset 0 2px 5px rgba(255,255,255,.95)`;
        // Sparkle star where four cubes meet (bottom-left corner of this cube),
        // mostly in the saturated colour zones.
        if (
          r > 0 && c > 0 &&
          filled.has(r + "," + (c - 1)) && filled.has((r - 1) + "," + c) && filled.has((r - 1) + "," + (c - 1)) &&
          rand(r * 31 + c * 17) < 0.55 && (fx < 0.3 || fx > 0.52)
        ) {
          const sp = document.createElement("span");
          sp.className = "spark";
          const ss = Math.max(14, size * 0.26);
          sp.style.width = `${ss}px`;
          sp.style.height = `${ss}px`;
          sp.style.left = `${-(gap / 2 + ss / 2)}px`;
          sp.style.bottom = `${-(gap / 2 + ss / 2)}px`;
          el.appendChild(sp);
        }
        host.appendChild(el);
      }
    };

    build();
    const onResize = () => build();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      host.innerHTML = "";
    };
  }, []);
  return <div ref={ref} className="cubes" aria-hidden />;
}

/* --------------------------------------------------------- pricing card */

/* ------------------------------------------------------------- data */

const NAV = [
  { label: "Features", href: "/features" },
  { label: "Product", href: "/product" },
  { label: "Pricing", href: "/pricing" },
];



/* --------------------------------------------------------------------- page */

export default function Landing() {
  const [menu, setMenu] = useState(false);

  return (
    <div className="lp" id="top">
      <JsonLd data={[organizationLd, websiteLd, softwareApplicationLd]} />
      <style>{CSS}</style>
      <div className="lp-bg" aria-hidden><span className="grid" /></div>

      {/* NAV */}
      <header className="nav">
        <div className="nav-in">
          <div className="brand"><img src="/brand/cubes.im_logo_big.png" alt="" className="brand-img" /> Cubes</div>
          <nav className="nav-links">{NAV.map((n) => <a key={n.label} href={n.href}>{n.label}</a>)}</nav>
          <div className="nav-right">
            <a className="lang" href={GITHUB_URL} target="_blank" rel="noreferrer"><GitHubMark /> Star on GitHub</a>
            <Link href="/login" className="btn navy sm">Get started</Link>
            <button className="burger" aria-label="Menu" aria-expanded={menu} aria-controls="nav-drawer" onClick={() => setMenu((m) => !m)}><MIcon name={menu ? "close" : "menu"} size={22} /></button>
          </div>
        </div>
        {menu ? (
          <div className="drawer" id="nav-drawer">
            {NAV.map((n) => <a key={n.label} href={n.href} onClick={() => setMenu(false)}>{n.label}</a>)}
            <a className="lang" href={GITHUB_URL} target="_blank" rel="noreferrer" onClick={() => setMenu(false)}><GitHubMark /> Star on GitHub</a>
            <Link href="/login" className="btn navy" onClick={() => setMenu(false)}>Get started</Link>
          </div>
        ) : null}
      </header>

      {/* HERO */}
      <section className="hero">
        <div className="hero-lines" aria-hidden />
        <CubeField />
        <div className="hero-in">
          <Reveal>
            <h1 className="h1">
              <span className="ink">One</span>{" "}
              <span className="silver">workspace</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/cubes.im_logo_big.png" alt="" className="hero-cube" aria-hidden />
              <br />
              <span className="ink">for everything</span>{" "}
              <span className="silver">you run.</span>
            </h1>
          </Reveal>
          <Reveal delay={90}>
            <p className="hero-sub">The open-source, all-in-one workspace — projects, docs, review, clients, social and people ops, behind a single login.</p>
          </Reveal>
          <Reveal delay={170}>
            <div className="hero-cta">
              <Link href="/signup" className="btn navy xl">Start free</Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* TRUST STRIP */}
      <section className="trust">
        <span>Trusted by fast-moving teams</span>
        <div className="trust-logos">
          {["Waple", "Growout", "fps.video", "Aspirence", "The Cyber Dispatch"].map((n) => <span key={n}>{n}</span>)}
        </div>
      </section>

      {/* MEGA FOOTER */}
      <footer className="mfoot" id="cta">
        <Reveal>
          <h2 className="mfoot-h">
            <span className="mf-l1">One workspace for the work</span><br />
            <span className="mf-l2">and everything around it.</span><br />
            <span className="mf-l3">One login. </span><span className="mf-ink">Zero glue work.</span>
          </h2>
        </Reveal>
        <Reveal delay={110}>
          <Link href="/login" className="mfoot-pill">
            <span className="mfoot-av">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/cubes.im_logo_big.png" alt="" />
            </span>
            <span className="mfoot-pill-t">
              <span className="l1">Get started <MIcon name="arrow_forward" size={16} /></span>
              <span className="l2">Start free with your whole team</span>
            </span>
          </Link>
        </Reveal>
        <div className="mfoot-word" aria-hidden>Cubes</div>
        <div className="mfoot-bar">
          <span>© 2026 Cubes. All rights reserved.</span>
          <nav className="mfoot-legal">
            <a href="/manifesto">Manifesto</a>
            <a href="/terms">Terms of Service</a>
            <a href="/privacy">Privacy Policy</a>
            <a href="/refunds">Refund Policy</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/* --------------------------------------------------------------------- CSS */

const ACCENT = "#4f5bd5";
const CSS = `
.lp{position:relative;min-height:100vh;background:#fbfbfe;color:#0e0f17;font-family:var(--font-geist-sans),system-ui,sans-serif;overflow-x:hidden;}
.lp *{box-sizing:border-box;}
.lp a{color:inherit;text-decoration:none;}
.lp a:focus-visible,.lp button:focus-visible{outline:2px solid #0e0f17;outline-offset:3px;border-radius:8px;}
.lp-bg{position:fixed;inset:0;z-index:0;pointer-events:none;}
.lp-bg .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(15,17,30,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(15,17,30,.035) 1px,transparent 1px);background-size:44px 44px;mask-image:radial-gradient(ellipse 80% 55% at 50% 0%, #000, transparent 75%);}

/* nav */
.nav{position:sticky;top:0;z-index:40;}
.nav-in{max-width:1120px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 22px;position:relative;}
.nav::before{content:"";position:absolute;inset:0;background:rgba(251,251,254,.72);backdrop-filter:blur(12px);border-bottom:1px solid rgba(15,17,30,.06);z-index:-1;}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:20px;letter-spacing:-.02em;}
.brand-img{width:48px;height:48px;object-fit:contain;}
.brand-mark{width:28px;height:28px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:14px;background:linear-gradient(150deg,#6d6df0,${ACCENT});box-shadow:0 6px 16px -6px ${ACCENT};flex:none;}
.nav-links{display:flex;gap:26px;font-size:14.5px;color:#4a4c5a;font-weight:500;}
.nav-links a:hover{color:#0e0f17;}
.nav-right{display:flex;align-items:center;gap:12px;}
.nav-signin{font-size:14px;font-weight:600;color:#3a3c4a;}
.nav-signin:hover{color:${ACCENT};}
.burger{display:none;border:1px solid #e6e7ee;background:#fff;border-radius:9px;width:38px;height:38px;align-items:center;justify-content:center;cursor:pointer;color:#0e0f17;}
.drawer{display:none;}

.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;font-size:14px;font-weight:600;padding:10px 17px;border-radius:11px;cursor:pointer;border:1px solid transparent;transition:transform .16s,box-shadow .16s,background .16s;white-space:nowrap;}
.btn.sm{padding:8px 15px;font-size:13.5px;}
.btn.lg{padding:14px 24px;font-size:15px;border-radius:13px;}
.btn.ghost{background:#fff;border-color:#e6e7ee;color:#0e0f17;}
.btn.ghost:hover{border-color:#0e0f17;color:#0e0f17;}
.btn.white{background:linear-gradient(180deg,#fff,#eceefc);color:${ACCENT};border:1px solid rgba(255,255,255,.7);box-shadow:0 12px 30px -12px rgba(0,0,0,.45), inset 0 1.5px 0 #fff;}
.btn.white:hover{transform:translateY(-2px);}
.btn.glass{background:rgba(255,255,255,.14);border-color:rgba(255,255,255,.35);color:#fff;}
.btn.glass:hover{background:rgba(255,255,255,.24);}

/* hero */
.hero{position:relative;z-index:1;min-height:calc(100vh - 68px);overflow:hidden;}
.hero-lines{position:absolute;inset:0;z-index:0;background:repeating-linear-gradient(90deg, rgba(20,26,46,.05) 0 1px, transparent 1px 122px);-webkit-mask:linear-gradient(180deg,#000 55%,transparent 96%);mask:linear-gradient(180deg,#000 55%,transparent 96%);}
.hero-in{position:relative;z-index:2;max-width:1160px;margin:0 auto;padding:96px 28px 0;text-align:left;}
.h1{font-size:clamp(38px,5.4vw,72px);line-height:1.0;font-weight:800;letter-spacing:-.045em;margin:0;overflow-wrap:break-word;}
.ink{color:#141a2e;}
.silver{background:linear-gradient(180deg,#c7cfe2,#a4b0ca);-webkit-background-clip:text;background-clip:text;color:transparent;}
.hero-cube{display:inline-block;vertical-align:middle;margin-left:.14em;margin-top:-.14em;width:1.15em;height:1.15em;object-fit:contain;transform:scaleX(-1);}
.hero-sub{font-size:clamp(15px,1.5vw,18px);color:#3b4257;line-height:1.6;margin:26px 0 0;max-width:430px;}
.hero-cta{display:flex;gap:12px;margin-top:34px;flex-wrap:wrap;justify-content:flex-start;}
.btn.navy{background:linear-gradient(180deg,#39415e 0%,#161c33 52%,#0c1122 100%);color:#fff;border-radius:999px;border:1px solid rgba(255,255,255,.1);box-shadow:0 14px 30px -12px rgba(18,23,44,.75), inset 0 1.5px 0 rgba(255,255,255,.32), inset 0 -2px 6px rgba(0,0,0,.45);text-shadow:0 1px 2px rgba(0,0,0,.4);}
.btn.navy:hover{transform:translateY(-2px);box-shadow:0 22px 42px -14px rgba(18,23,44,.8), inset 0 1.5px 0 rgba(255,255,255,.4), inset 0 -2px 6px rgba(0,0,0,.45);}
.btn.xl{padding:13px 26px;font-size:15px;font-weight:700;border-radius:999px;}
.lang{display:inline-flex;align-items:center;gap:6px;padding:8px 13px;border-radius:999px;background:rgba(255,255,255,.75);border:1px solid rgba(20,26,46,.08);box-shadow:inset 0 1px 0 rgba(255,255,255,.9);font-size:13.5px;font-weight:600;color:#2a2c3a;cursor:pointer;}

/* cube staircase */
.cubes{position:absolute;left:0;right:0;bottom:0;height:63%;z-index:1;pointer-events:none;}
.cube{position:absolute;border:1px solid rgba(255,255,255,.9);will-change:transform;}
.spark{position:absolute;background:#fff;clip-path:polygon(50% 0,61% 39%,100% 50%,61% 61%,50% 100%,39% 61%,0 50%,39% 39%);filter:drop-shadow(0 0 6px rgba(255,255,255,1)) drop-shadow(0 0 12px rgba(190,140,255,.6));z-index:3;}

.tl{width:11px;height:11px;border-radius:999px;}

.m-board{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}
.m-board.compact .m-card-t{font-size:11px;}
.m-col-h{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:800;letter-spacing:.3px;text-transform:uppercase;color:#8b90a0;margin-bottom:8px;}
.m-count{margin-left:auto;color:#b6bac6;}
.m-dot{width:7px;height:7px;border-radius:999px;}
.m-card{background:#fff;border:1px solid #eef0f6;border-radius:10px;padding:9px;margin-bottom:8px;box-shadow:0 3px 10px -8px rgba(40,30,110,.3);}
.m-card-t{font-size:12px;font-weight:700;color:#1c1e2b;margin-bottom:8px;}
.m-card-b{display:flex;align-items:center;justify-content:space-between;}
.m-tag{font-size:9.5px;font-weight:800;padding:2px 7px;border-radius:999px;}
.m-av{width:18px;height:18px;border-radius:999px;color:#fff;font-size:8.5px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;}

/* trust */
.trust{position:relative;z-index:1;max-width:1000px;margin:56px auto 0;padding:0 22px;text-align:center;}
.trust>span{font-size:12.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#7a7c8a;}
.trust-logos{display:flex;flex-wrap:wrap;gap:34px;justify-content:center;margin-top:16px;}
.trust-logos span{font-size:18px;font-weight:800;letter-spacing:-.02em;color:#9aa0ae;}

/* sections */
.sec{position:relative;z-index:1;max-width:1080px;margin:0 auto;padding:74px 22px;}
.eyebrow{text-transform:uppercase;letter-spacing:.13em;font-size:12.5px;font-weight:800;color:${ACCENT};}
.h2{font-size:clamp(27px,3.8vw,42px);font-weight:800;letter-spacing:-.03em;margin:10px 0 30px;}

/* bento */
.bento{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;}
.feat{position:relative;background:linear-gradient(180deg,#ffffff,#fbfbff);border:1px solid #ececf3;border-radius:20px;padding:22px;overflow:hidden;transition:transform .2s,border-color .2s,box-shadow .2s;display:flex;flex-direction:column;min-height:250px;box-shadow:0 14px 34px -30px rgba(90,70,190,.5), inset 0 1.5px 0 rgba(255,255,255,.95);}
.feat:hover{transform:translateY(-4px);border-color:#d7d9ef;box-shadow:0 26px 50px -30px rgba(40,30,110,.4);}
.feat.span-2{flex-direction:row;align-items:center;gap:24px;}
.feat.span-2 .feat-copy{flex:1;}
.feat.span-2 .feat-preview{flex:1.1;}
.feat-ic{width:42px;height:42px;border-radius:12px;background:#eef0fd;color:${ACCENT};display:inline-flex;align-items:center;justify-content:center;}
.feat-t{font-weight:800;font-size:18px;margin:14px 0 6px;letter-spacing:-.01em;}
.feat-d{font-size:13.5px;color:#61637180;color:#616371;line-height:1.55;}
.feat-preview{margin-top:16px;border:1px solid #f0f1f7;border-radius:14px;padding:12px;background:#fbfbfe;overflow:hidden;}
.feat.span-2 .feat-preview{margin-top:0;}

.mini-surface{display:grid;gap:9px;}
.mini-doc-t{font-size:14px;font-weight:800;color:#1c1e2b;}
.mini-lines{display:flex;gap:6px;}
.mini-lines span{height:6px;border-radius:9px;background:#eef1f8;}
.mini-row{display:flex;align-items:center;gap:8px;font-size:12.5px;color:#54586a;}
.mini-check{width:17px;height:17px;border-radius:5px;display:inline-flex;align-items:center;justify-content:center;font-size:9px;}
.mini-vid{position:relative;height:120px;border-radius:12px;background:linear-gradient(135deg,#7c5cff,${ACCENT});display:flex;align-items:center;justify-content:center;overflow:hidden;}
.mini-pin{position:absolute;left:36%;top:40%;width:22px;height:22px;border-radius:999px 999px 999px 3px;background:#fff;color:${ACCENT};font-size:11px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;}
.mini-bar{position:absolute;left:12px;right:12px;bottom:10px;height:4px;border-radius:999px;background:rgba(255,255,255,.35);}
.mini-bar i{display:block;width:36%;height:100%;border-radius:999px;background:#fff;}
.mini-social{display:flex;gap:8px;flex-wrap:wrap;}
.mini-social span{width:38px;height:38px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;font-weight:900;font-size:13px;}
.mini-chart{display:flex;align-items:flex-end;gap:8px;height:120px;padding-top:6px;}
.mini-chart span{flex:1;border-radius:6px 6px 3px 3px;}

/* tabs showcase */
.tabs{display:flex;gap:9px;flex-wrap:wrap;margin-bottom:18px;}
.tab{display:inline-flex;align-items:center;gap:7px;padding:10px 16px;border-radius:12px;font-size:14px;font-weight:700;color:#54586a;background:#fff;border:1px solid #ececf3;cursor:pointer;transition:all .16s;}
.tab:hover{transform:translateY(-1px);}
.tab.on{color:#fff;background:linear-gradient(180deg,#39415e 0%,#161c33 52%,#0c1122 100%);border-color:rgba(255,255,255,.1);box-shadow:0 12px 26px -12px rgba(18,23,44,.75), inset 0 1.5px 0 rgba(255,255,255,.3), inset 0 -2px 5px rgba(0,0,0,.45);text-shadow:0 1px 2px rgba(0,0,0,.4);}
.stage{background:#fff;border:1px solid #e9e9f2;border-radius:18px;overflow:hidden;box-shadow:0 30px 60px -34px rgba(40,30,110,.4);}
.stage-bar{display:flex;align-items:center;gap:7px;padding:12px 15px;border-bottom:1px solid #f0f0f6;}
.stage-url{margin-left:10px;font-size:12px;color:#9aa0ae;font-family:var(--font-geist-mono),monospace;}
.stage-body{padding:26px;min-height:200px;}
.swap{animation:sw .45s cubic-bezier(.2,.8,.3,1);}
@keyframes sw{from{opacity:0;transform:translateY(10px) scale(.99);}to{opacity:1;transform:none;}}

/* metrics */
.metrics{position:relative;z-index:1;max-width:1000px;margin:0 auto;padding:20px 22px 30px;display:grid;grid-template-columns:repeat(4,1fr);gap:14px;}
.metric{text-align:center;background:#fff;border:1px solid #ececf3;border-radius:18px;padding:26px 16px;box-shadow:0 16px 38px -30px rgba(90,70,190,.5), inset 0 1.5px 0 rgba(255,255,255,.95);position:relative;overflow:hidden;}
.metrics>div:nth-child(1) .metric{background:radial-gradient(circle at 50% 140%, rgba(70,124,255,.18), transparent 62%),#fff;}
.metrics>div:nth-child(2) .metric{background:radial-gradient(circle at 50% 140%, rgba(168,100,240,.18), transparent 62%),#fff;}
.metrics>div:nth-child(3) .metric{background:radial-gradient(circle at 50% 140%, rgba(210,88,224,.18), transparent 62%),#fff;}
.metrics>div:nth-child(4) .metric{background:radial-gradient(circle at 50% 140%, rgba(255,110,200,.18), transparent 62%),#fff;}
.metric-n{font-size:clamp(30px,4vw,46px);font-weight:900;letter-spacing:-.02em;background:linear-gradient(150deg,#1c1e2b,${ACCENT});-webkit-background-clip:text;background-clip:text;color:transparent;}
.metric-l{font-size:13px;color:#7a7c8a;margin-top:4px;}

/* reviews */
.rev-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px;}
.rev{background:#fff;border:1px solid #ececf3;border-radius:18px;padding:22px;box-shadow:0 10px 30px -24px rgba(40,30,110,.4);}
.rev-t{font-size:15px;color:#2a2c3a;line-height:1.6;margin:0 0 16px;font-weight:500;}
.rev-f{display:flex;align-items:center;gap:11px;}
.rev-av{width:38px;height:38px;border-radius:999px;background:linear-gradient(135deg,#7c5cff,#ec4899);color:#fff;font-size:13px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;}
.rev-n{font-weight:700;font-size:14px;}
.rev-r{font-size:12.5px;color:#8b90a0;}
.rev-stars{margin-left:auto;color:#f5a524;letter-spacing:1px;font-size:14px;}

/* pricing */
.plans-lead{font-size:15.5px;color:#5b5d6b;line-height:1.65;max-width:640px;margin:-12px 0 28px;}


/* cta */
/* mega footer */
.mfoot{position:relative;z-index:1;padding:110px 22px 26px;text-align:center;overflow:hidden;}
.mfoot-h{font-size:clamp(26px,3.9vw,46px);font-weight:800;letter-spacing:-.03em;line-height:1.22;margin:0 0 34px;}
.mf-l1{color:#c9cfdd;}
.mf-l2{color:#adb5c7;}
.mf-l3{color:#9aa2b6;}
.mf-ink{color:#161c2e;}
.mfoot-pill{display:inline-flex;align-items:center;gap:11px;text-align:left;background:linear-gradient(180deg,#3a4054 0%,#171b26 55%,#0b0d15 100%);border:1px solid rgba(255,255,255,.1);border-radius:999px;padding:10px 26px 10px 14px;color:#fff;box-shadow:0 18px 40px -16px rgba(12,15,26,.7), inset 0 1.5px 0 rgba(255,255,255,.28), inset 0 -2px 6px rgba(0,0,0,.5);transition:transform .18s,box-shadow .18s;}
.mfoot-pill:hover{transform:translateY(-2px);box-shadow:0 26px 52px -18px rgba(12,15,26,.8), inset 0 1.5px 0 rgba(255,255,255,.34), inset 0 -2px 6px rgba(0,0,0,.5);}
.mfoot-av{width:46px;height:46px;display:inline-flex;align-items:center;justify-content:center;flex:none;}
.mfoot-av img{width:44px;height:44px;object-fit:contain;}
.mfoot-pill-t{display:flex;flex-direction:column;gap:1px;}
.mfoot-pill-t .l1{display:inline-flex;align-items:center;gap:6px;font-weight:700;font-size:15px;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.4);}
.mfoot-pill-t .l2{font-size:12.5px;color:#aab1c2;font-weight:500;}
.mfoot-word{font-size:clamp(110px,22vw,330px);font-weight:800;letter-spacing:-.055em;line-height:.82;margin:64px -20px -8px;background:linear-gradient(180deg,#bfc7d8 0%,#dfe4ee 55%,#f4f6fa 100%);-webkit-background-clip:text;background-clip:text;color:transparent;user-select:none;pointer-events:none;white-space:nowrap;}
.mfoot-bar{max-width:1280px;margin:8px auto 0;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:13px;color:#8b90a0;text-align:left;}
.mfoot-legal{display:flex;gap:22px;font-weight:500;color:#54586a;}
.mfoot-legal a:hover{color:#0e0f17;}

.rv{opacity:0;transform:translateY(22px);transition:opacity .7s cubic-bezier(.2,.8,.3,1),transform .7s cubic-bezier(.2,.8,.3,1);}
.rv.in{opacity:1;transform:none;}

/* responsive */
@media(max-width:900px){
  .nav-links{display:none;}
  .burger{display:inline-flex;}
  .nav-right .btn.navy.sm,.nav-signin,.lang{display:none;}
  .drawer{display:flex;flex-direction:column;gap:4px;position:absolute;top:64px;left:14px;right:14px;background:#fff;border:1px solid #ececf3;border-radius:16px;padding:12px;box-shadow:0 24px 50px -20px rgba(40,30,110,.4);}
  .drawer a{padding:11px 12px;border-radius:10px;font-weight:600;font-size:15px;}
  .drawer a:hover{background:#f4f4fb;}
  .drawer .btn{margin-top:6px;}
  .bento{grid-template-columns:1fr 1fr;}
  .feat,.feat.span-2{grid-column:span 1 !important;flex-direction:column;align-items:stretch;min-height:0;}
  .feat.span-2 .feat-preview{margin-top:16px;}
  .rev-grid{grid-template-columns:1fr;}
  .metrics{grid-template-columns:repeat(2,1fr);row-gap:14px;}
  .mfoot{padding-top:70px;}
  .mfoot-word{margin-top:44px;}
  .plans{grid-template-columns:1fr;}
}
@media(max-width:600px){
  .bento{grid-template-columns:1fr;}
  .hero{min-height:78vh;}
  .hero-in{padding:44px 22px 0;}
  .h1{font-size:clamp(31px,8.4vw,46px);line-height:1.04;}
  /* Smaller, tighter cube so the wrapped headline reads clean on phones. */
  .hero-cube{width:.9em;height:.9em;margin-left:.06em;margin-top:-.1em;}
  .hero-sub{margin-top:18px;font-size:15px;}
  .hero-cta{margin-top:24px;}
  /* Fuller cube field, closer to the CTA — kills the mid-hero dead space. */
  .cubes{height:50%;}
  .m-board{min-width:420px;}
  .mfoot-legal{flex-wrap:wrap;justify-content:center;gap:10px 16px;}
  .mfoot-bar{justify-content:center;text-align:center;}
  .mfoot-word{font-size:clamp(70px,23vw,110px);}
}
`;
