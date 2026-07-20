"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Space, Form, App as AntdApp } from "antd";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/features/auth/use-auth";
import { useActiveTeam } from "@/features/teams/use-teams";
import { useCompleteSetup } from "@/features/onboarding/use-setup";
import { useInviteMember } from "@/features/invitations/use-invitations";
import { stageInviteEmail } from "./steps";
import { useSaveTeamDetails } from "@/features/teams/use-team-details";
import { seedSampleWorkspace } from "@/features/onboarding/sample-workspace";
import {
  ChooseModeStep,
  JoinStep,
  OrganizationStep,
  DetailsStep,
  StartStep,
  InviteStep,
  type SetupMode,
  type OrganizationValues,
  type DetailsValues,
  type StartChoice,
  type InviteEntry,
} from "./steps";

const STEP_ITEMS = [
  { title: "Workspace", desc: "Name your organization" },
  { title: "Company details", desc: "A few optional details" },
  { title: "Starting point", desc: "Sample data or blank" },
  { title: "Invite your team", desc: "Add teammates" },
];

export default function SetupPage() {
  const router = useRouter();
  const { message } = AntdApp.useApp();
  const supabase = useMemo(() => createClient(), []);

  const { profile } = useAuth();
  const { data: activeTeam } = useActiveTeam();

  const completeSetup = useCompleteSetup();
  const inviteMember = useInviteMember();
  const saveDetails = useSaveTeamDetails();

  const [mode, setMode] = useState<SetupMode | "choose">("choose");
  const [current, setCurrent] = useState(0);
  const [invites, setInvites] = useState<InviteEntry[]>([]);
  // The invite box's current text, held here so leaving the step (Next/Finish)
  // can still commit it — typing an address and clicking Finish used to drop it.
  const [pendingInvite, setPendingInvite] = useState("");
  const [startChoice, setStartChoice] = useState<StartChoice>("sample");
  const [submitting, setSubmitting] = useState(false);
  // Captured when advancing past a form step — steps (and their <Form>s)
  // unmount on later steps, so the form instances can't be re-read.
  const [orgValues, setOrgValues] = useState<OrganizationValues | null>(null);
  const [detailsValues, setDetailsValues] = useState<DetailsValues>({});

  const [orgForm] = Form.useForm<OrganizationValues>();
  const [detailsForm] = Form.useForm<DetailsValues>();

  // Pre-fill the workspace step from the user's profile / active team.
  const orgInitialValues = useMemo<OrganizationValues>(
    () => ({
      organizationName: activeTeam?.name ?? profile?.name ?? "",
      teamName: activeTeam?.name ?? "",
    }),
    [activeTeam?.name, profile?.name],
  );

  /** Commits a still-unstaged address; returns the list to actually invite. */
  const flushPendingInvite = (): InviteEntry[] => {
    const result = stageInviteEmail(pendingInvite, invites);
    if (!result.ok) {
      if (result.error && pendingInvite.trim())
        message.warning(`"${pendingInvite.trim()}" wasn't invited — ${result.error}`);
      return invites;
    }
    setInvites(result.next);
    setPendingInvite("");
    return result.next;
  };

  const goNext = async () => {
    if (current === 0) {
      // Validate and capture before the step unmounts.
      try {
        setOrgValues(await orgForm.validateFields());
      } catch {
        return;
      }
    }
    if (current === 1) {
      try {
        setDetailsValues(await detailsForm.validateFields());
      } catch {
        return;
      }
    }
    if (current === 2) flushPendingInvite();
    setCurrent((c) => Math.min(c + 1, STEP_ITEMS.length - 1));
  };

  const skipStep = () => {
    // Capture whatever was typed even when skipping the details step.
    if (current === 1) setDetailsValues(detailsForm.getFieldsValue());
    setCurrent((c) => Math.min(c + 1, STEP_ITEMS.length - 1));
  };

  const goBack = () => setCurrent((c) => Math.max(c - 1, 0));

  /**
   * Bounds a best-effort step: resolves null when it outlasts `ms` so a single
   * stalled network call can never wedge the Finish button. The underlying
   * work keeps running server-side; only the wait is abandoned.
   */
  const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T | null> =>
    Promise.race([
      promise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
    ]);

  const finish = async () => {
    // The org step is unmounted by now — use the captured values (falling back
    // to the pre-filled defaults).
    const org = orgValues ?? orgInitialValues;
    const organizationName = (org.organizationName ?? "").trim();
    const teamName = (org.teamName ?? "").trim() || organizationName;

    if (!organizationName) {
      message.warning("Please add an organization name.");
      setCurrent(0);
      return;
    }

    setSubmitting(true);
    try {
      // 1) Persist org/workspace names + flip setup_completed via the RPC.
      await completeSetup.mutateAsync({ teamName, organizationName });

      // 2) Save the company profile (best-effort — never blocks finishing).
      const hasDetails = Object.values(detailsValues).some(
        (v) => v !== undefined && v !== null && `${v}`.trim() !== "",
      );
      if (activeTeam?.id && (hasDetails || organizationName)) {
        try {
          await withTimeout(
            saveDetails.mutateAsync({
              teamId: activeTeam.id,
              details: { companyName: organizationName, ...detailsValues },
            }),
            10_000,
          );
        } catch (err) {
          console.error("Failed to save workspace details", err);
        }
      }

      // 3) Send any pending invitations (best-effort). Includes an address
      //    still sitting in the input — Finish must not silently drop it.
      const toInvite = flushPendingInvite();
      if (toInvite.length > 0) {
        const results = await withTimeout(
          Promise.allSettled(
            toInvite.map((invite) =>
              inviteMember.mutateAsync({ email: invite.email, name: invite.name }),
            ),
          ),
          15_000,
        );
        const failed =
          results?.filter((r) => r.status === "rejected").length ?? 0;
        if (failed > 0) {
          message.warning(
            `${failed} invitation${failed > 1 ? "s" : ""} could not be sent.`,
          );
        }
      }

      // 4) Seed the sample template when chosen (best-effort — a failure
      //    falls back to a blank workspace instead of blocking onboarding).
      if (startChoice === "sample" && activeTeam?.id) {
        message.open({
          key: "setup-seed",
          type: "loading",
          content: "Setting up your sample projects…",
          duration: 0,
        });
        try {
          const seeded = await withTimeout(
            seedSampleWorkspace(supabase, activeTeam.id, profile?.id).then(
              () => true,
            ),
            25_000,
          );
          if (seeded === null) {
            throw new Error("Sample seeding timed out");
          }
          message.open({
            key: "setup-seed",
            type: "success",
            content: "Sample projects are ready!",
            duration: 2,
          });
        } catch (err) {
          console.error("Failed to seed the sample workspace", err);
          message.open({
            key: "setup-seed",
            type: "warning",
            content: "Couldn't add sample data — starting blank instead.",
            duration: 3,
          });
        }
      } else {
        message.success("You're all set!");
      }

      router.replace("/home");
    } catch (err) {
      const text =
        err instanceof Error ? err.message : "Failed to complete setup.";
      message.error(text);
      setSubmitting(false);
    }
  };

  const isLastStep = current === STEP_ITEMS.length - 1;
  const firstName = profile?.name ? profile.name.split(" ")[0] : "";
  const darkBtn = { background: "#111319", borderColor: "#111319" } as const;

  return (
    <div className="ob">
      <style>{OB_CSS}</style>

      {/* LEFT — brand + vertical stepper */}
      <aside className="ob-rail">
        <div className="ob-rail-in">
          <div className="ob-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/cubes.im_logo_big.png" alt="" /> Cubes
          </div>

          <div className="ob-welcome">
            <h1>Welcome{firstName ? `, ${firstName}` : ""} 👋</h1>
            <p>Let&apos;s set up your workspace — it takes about a minute.</p>
          </div>

          {mode === "create" ? (
            <ol className="ob-steps">
              {STEP_ITEMS.map((s, i) => {
                const state = i === current ? "on" : i < current ? "done" : "";
                return (
                  <li key={s.title} className={`ob-step ${state}`}>
                    <span className="ob-step-ic">
                      {i < current ? (
                        <span className="material-symbols-rounded" aria-hidden style={{ fontSize: 16 }}>check</span>
                      ) : (
                        i + 1
                      )}
                    </span>
                    <span className="ob-step-tx">
                      <span className="ob-step-t">{s.title}</span>
                      <span className="ob-step-d">{s.desc}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : null}

          <div className="ob-rail-foot">🧊 One login. Zero glue work.</div>
        </div>
      </aside>

      {/* RIGHT — the active step */}
      <main className="ob-main">
        <div className="ob-main-in">
          {mode === "choose" ? (
            <ChooseModeStep
              onChoose={(m) => {
                setMode(m);
                if (m === "create") setCurrent(0);
              }}
            />
          ) : mode === "join" ? (
            <JoinStep
              onCreateInstead={() => {
                setMode("create");
                setCurrent(0);
              }}
            />
          ) : (
            <>
              <div className="ob-topline">
                <span className="ob-count">Step {current + 1} of {STEP_ITEMS.length}</span>
                <div className="ob-bar">
                  <span style={{ width: `${((current + 1) / STEP_ITEMS.length) * 100}%` }} />
                </div>
              </div>

              <div className="ob-form">
                {current === 0 ? (
                  <OrganizationStep form={orgForm} initialValues={orgInitialValues} />
                ) : null}
                {current === 1 ? <DetailsStep form={detailsForm} /> : null}
                {current === 2 ? (
                  <StartStep value={startChoice} onChange={setStartChoice} />
                ) : null}
                {current === 3 ? (
                  <InviteStep
                    invites={invites}
                    onChange={setInvites}
                    pending={pendingInvite}
                    onPendingChange={setPendingInvite}
                  />
                ) : null}
              </div>

              <div className="ob-nav">
                <Button
                  onClick={() => (current === 0 ? setMode("choose") : goBack())}
                  disabled={submitting}
                  size="large"
                >
                  Back
                </Button>
                <Space>
                  {current === 1 ? (
                    <Button type="text" onClick={skipStep} disabled={submitting} size="large">
                      Skip for now
                    </Button>
                  ) : null}
                  {isLastStep ? (
                    <Button type="primary" size="large" loading={submitting} onClick={finish} style={darkBtn}>
                      {startChoice === "sample" ? "Finish & add sample data" : "Finish"}
                    </Button>
                  ) : (
                    <Button type="primary" size="large" onClick={goNext} disabled={submitting} style={darkBtn}>
                      Next
                    </Button>
                  )}
                </Space>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

const OB_CSS = `
/* Without this, min-height:100vh + padding (content-box default) makes the
   rail/main render taller than the viewport → a bogus scrollbar + dead space. */
.ob,.ob *{box-sizing:border-box;}
.ob{height:100vh;display:grid;grid-template-columns:minmax(320px,400px) 1fr;background:#fff;font-family:var(--font-geist-sans),system-ui,sans-serif;overflow:hidden;}
.ob-rail{position:relative;overflow:hidden;background:radial-gradient(120% 80% at 0% 0%, #24262f 0%, #15171d 55%, #0c0d11 100%);color:#fff;}
.ob-rail-in{display:flex;flex-direction:column;min-height:100vh;padding:40px 40px 34px;}
.ob-brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:19px;letter-spacing:-.02em;color:#fff;}
.ob-brand img{width:40px;height:40px;object-fit:contain;}
.ob-welcome{margin-top:40px;}
.ob-welcome h1{font-size:26px;font-weight:800;letter-spacing:-.02em;margin:0;color:#fff;line-height:1.15;}
.ob-welcome p{font-size:14px;color:#a4a8b6;margin:12px 0 0;line-height:1.55;max-width:280px;}
.ob-steps{list-style:none;margin:44px 0 0;padding:0;display:flex;flex-direction:column;gap:4px;}
.ob-step{display:flex;gap:13px;align-items:center;padding:11px 12px;border-radius:12px;transition:background .16s;}
.ob-step.on{background:rgba(255,255,255,.06);}
.ob-step-ic{flex:none;width:28px;height:28px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;background:rgba(255,255,255,.09);color:#c1c5d0;}
.ob-step.on .ob-step-ic{background:#fff;color:#111319;}
.ob-step.done .ob-step-ic{background:#3a3d49;color:#fff;}
.ob-step-tx{display:flex;flex-direction:column;min-width:0;}
.ob-step-t{font-size:14.5px;font-weight:700;color:#8b8f9e;letter-spacing:-.01em;}
.ob-step.on .ob-step-t{color:#fff;}
.ob-step.done .ob-step-t{color:#d5d8e0;}
.ob-step-d{font-size:12.5px;color:#767b8a;margin-top:1px;}
.ob-step.on .ob-step-d{color:#a4a8b6;}
.ob-rail-foot{margin-top:auto;padding-top:32px;font-size:13px;font-weight:600;color:#7f8493;}

/* Top-aligned with real top padding (no vertical centering that clips tall
   forms), and full-width content like the rest of the platform. */
.ob-main{padding:64px 56px 56px;height:100vh;overflow-y:auto;}
.ob-main-in{width:100%;max-width:none;margin:0;}
.ob-topline{margin-bottom:28px;}
.ob-count{font-size:12px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:#9a9da8;}
.ob-bar{height:5px;border-radius:999px;background:#eef0f4;margin-top:10px;overflow:hidden;}
.ob-bar span{display:block;height:100%;background:#111319;border-radius:999px;transition:width .35s cubic-bezier(.2,.8,.3,1);}
.ob-form{min-height:300px;}
.ob-nav{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:28px;padding-top:22px;border-top:1px solid #eef0f4;}

@media(max-width:860px){
  .ob{grid-template-columns:1fr;}
  .ob-rail{display:none;}
  .ob-main{padding:32px 20px 40px;}
}
`;
