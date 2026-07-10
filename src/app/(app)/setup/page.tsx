"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Steps, Button, Space, Form, App as AntdApp, Typography, theme } from "antd";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/features/auth/use-auth";
import { useActiveTeam } from "@/features/teams/use-teams";
import { useCompleteSetup } from "@/features/onboarding/use-setup";
import { useInviteMember } from "@/features/invitations/use-invitations";
import { useSaveTeamDetails } from "@/features/teams/use-team-details";
import { seedSampleWorkspace } from "@/features/onboarding/sample-workspace";
import {
  OrganizationStep,
  DetailsStep,
  StartStep,
  InviteStep,
  type OrganizationValues,
  type DetailsValues,
  type StartChoice,
  type InviteEntry,
} from "./steps";

const STEP_ITEMS = [
  { title: "Workspace" },
  { title: "Company details" },
  { title: "Starting point" },
  { title: "Invite your team" },
];

export default function SetupPage() {
  const router = useRouter();
  const { message } = AntdApp.useApp();
  const { token } = theme.useToken();
  const supabase = useMemo(() => createClient(), []);

  const { profile } = useAuth();
  const { data: activeTeam } = useActiveTeam();

  const completeSetup = useCompleteSetup();
  const inviteMember = useInviteMember();
  const saveDetails = useSaveTeamDetails();

  const [current, setCurrent] = useState(0);
  const [invites, setInvites] = useState<InviteEntry[]>([]);
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
    setCurrent((c) => Math.min(c + 1, STEP_ITEMS.length - 1));
  };

  const skipStep = () => {
    // Capture whatever was typed even when skipping the details step.
    if (current === 1) setDetailsValues(detailsForm.getFieldsValue());
    setCurrent((c) => Math.min(c + 1, STEP_ITEMS.length - 1));
  };

  const goBack = () => setCurrent((c) => Math.max(c - 1, 0));

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
          await saveDetails.mutateAsync({
            teamId: activeTeam.id,
            details: { companyName: organizationName, ...detailsValues },
          });
        } catch (err) {
          console.error("Failed to save workspace details", err);
        }
      }

      // 3) Send any pending invitations (best-effort).
      if (invites.length > 0) {
        const results = await Promise.allSettled(
          invites.map((invite) =>
            inviteMember.mutateAsync({ email: invite.email, name: invite.name }),
          ),
        );
        const failed = results.filter((r) => r.status === "rejected").length;
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
          await seedSampleWorkspace(supabase, activeTeam.id, profile?.id);
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

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: 8,
      }}
    >
      {/* Welcome header */}
      <div style={{ textAlign: "center", marginBottom: 22 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/cubes.im_logo_big.png"
          alt=""
          style={{ width: 54, height: 54, objectFit: "contain" }}
        />
        <h1
          style={{
            margin: "10px 0 0",
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: "-.4px",
            color: token.colorText,
          }}
        >
          Welcome to Cubes{profile?.name ? `, ${profile.name.split(" ")[0]}` : ""} 👋
        </h1>
        <Typography.Text type="secondary" style={{ fontSize: 13.5 }}>
          Let&apos;s set up your workspace — it takes about a minute.
        </Typography.Text>
      </div>

      <Card
        style={{
          width: "100%",
          maxWidth: 720,
          borderRadius: 16,
          boxShadow: "0 16px 40px -20px rgba(16,24,40,.18)",
        }}
      >
        <Steps
          current={current}
          items={STEP_ITEMS}
          size="small"
          style={{ marginBottom: 28 }}
        />

        <div style={{ minHeight: 280 }}>
          {current === 0 ? (
            <OrganizationStep form={orgForm} initialValues={orgInitialValues} />
          ) : null}
          {current === 1 ? <DetailsStep form={detailsForm} /> : null}
          {current === 2 ? (
            <StartStep value={startChoice} onChange={setStartChoice} />
          ) : null}
          {current === 3 ? (
            <InviteStep invites={invites} onChange={setInvites} />
          ) : null}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 24,
          }}
        >
          <Button onClick={goBack} disabled={current === 0 || submitting}>
            Back
          </Button>

          <Space>
            {/* The company-details step is skippable. */}
            {current === 1 ? (
              <Button type="text" onClick={skipStep} disabled={submitting}>
                Skip for now
              </Button>
            ) : null}

            {isLastStep ? (
              <Button type="primary" loading={submitting} onClick={finish}>
                {startChoice === "sample" ? "Finish & add sample data" : "Finish"}
              </Button>
            ) : (
              <Button type="primary" onClick={goNext} disabled={submitting}>
                Next
              </Button>
            )}
          </Space>
        </div>
      </Card>
    </div>
  );
}
