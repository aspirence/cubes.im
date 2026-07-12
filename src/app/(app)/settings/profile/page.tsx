"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  App,
  Avatar,
  Button,
  Card,
  Form,
  Input,
  Typography,
  Upload,
  theme,
} from "antd";
import type { UploadProps } from "antd";
import {
  LoadingOutlined,
  LockOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useAuth } from "@/features/auth/use-auth";
import { useUpdateProfile } from "@/features/profile/use-profile";
import { useUploadAvatar } from "@/features/storage/use-storage";

const { Text } = Typography;

interface ProfileValues {
  name: string;
  avatar_url: string;
}

function MIcon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <span
      className="material-symbols-rounded"
      aria-hidden
      style={{ fontSize: size, lineHeight: 1 }}
    >
      {name}
    </span>
  );
}

function memberSince(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * One settings row: label + hint in the left column, the control on the
 * right. Collapses to a single stacked column on narrow screens (see the
 * `.wl-set-*` styles at the bottom of the page).
 */
function SettingRow({
  title,
  hint,
  children,
  last,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={`wl-set-row${last ? " wl-set-row-last" : ""}`}>
      <div>
        <div className="wl-set-label">{title}</div>
        {hint ? <div className="wl-set-hint">{hint}</div> : null}
      </div>
      <div className="wl-set-ctl">{children}</div>
    </div>
  );
}

export default function ProfileSettingsPage() {
  const { token } = theme.useToken();
  const { message, modal } = App.useApp();
  const router = useRouter();
  const { profile, user, signOut } = useAuth();
  const updateProfile = useUpdateProfile();
  const uploadAvatar = useUploadAvatar();
  const [form] = Form.useForm<ProfileValues>();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = () => {
    modal.confirm({
      title: "Log out of Cubes?",
      content: "You'll need to sign in again to get back into your workspace.",
      okText: "Log out",
      okButtonProps: { danger: true },
      onOk: async () => {
        setLoggingOut(true);
        try {
          await signOut();
        } catch {
          message.error("Failed to log out.");
        } finally {
          router.push("/login");
        }
      },
    });
  };

  const [avatarPreview, setAvatarPreview] = useState<string>(
    profile?.avatar_url ?? "",
  );
  // Seed the avatar preview from the profile row when it first loads (or the
  // signed-in identity changes). Done during render — React's "adjust state on
  // prop change" pattern — so there's no post-paint flash and no setState in an
  // effect. Later edits (upload / typing a URL) diverge freely until the id
  // changes again.
  const [seedId, setSeedId] = useState<string | null>(profile?.id ?? null);
  if (profile && seedId !== profile.id) {
    setSeedId(profile.id);
    setAvatarPreview(profile.avatar_url ?? "");
  }

  // Form fields are backed by antd's form store (not React state), so seeding
  // them from an effect is fine — no setState involved.
  useEffect(() => {
    if (profile) {
      form.setFieldsValue({
        name: profile.name ?? "",
        avatar_url: profile.avatar_url ?? "",
      });
    }
  }, [profile, form]);

  // Track dirtiness so Save/Cancel only light up when something changed.
  const watchedName = Form.useWatch("name", form);
  const watchedAvatar = Form.useWatch("avatar_url", form);
  const dirty =
    (watchedName ?? "").trim() !== (profile?.name ?? "").trim() ||
    (watchedAvatar ?? "").trim() !== (profile?.avatar_url ?? "").trim();

  const displayName = profile?.name?.trim() || user?.email || "Your account";
  const email = profile?.email ?? user?.email ?? "";
  const since = memberSince(profile?.created_at);

  const resetForm = () => {
    form.setFieldsValue({
      name: profile?.name ?? "",
      avatar_url: profile?.avatar_url ?? "",
    });
    setAvatarPreview(profile?.avatar_url ?? "");
  };

  // Upload the chosen file to the 'avatars' bucket. The storage hook also
  // persists the resulting public URL onto the user's row, so the new avatar
  // sticks even if the user never presses "Save changes". We return false from
  // beforeUpload to prevent antd's default XHR upload — the hook owns the
  // transfer — and mirror the URL into the form/preview for instant feedback.
  const beforeAvatarUpload: UploadProps["beforeUpload"] = (file) => {
    if (!file.type.startsWith("image/")) {
      message.error("Please choose an image file.");
      return Upload.LIST_IGNORE;
    }
    void (async () => {
      try {
        const url = await uploadAvatar.mutateAsync(file as File);
        setAvatarPreview(url);
        form.setFieldValue("avatar_url", url);
        message.success("Photo updated.");
      } catch (err) {
        message.error(
          err instanceof Error ? err.message : "Failed to upload photo.",
        );
      }
    })();
    return false;
  };

  const onFinish = async (values: ProfileValues) => {
    try {
      await updateProfile.mutateAsync({
        name: values.name.trim(),
        avatar_url: values.avatar_url.trim() || null,
      });
      message.success("Profile updated.");
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "Failed to update profile.",
      );
    }
  };

  const saveButtons = (
    <div style={{ display: "flex", gap: 8, flex: "none" }}>
      <Button onClick={resetForm} disabled={!dirty || updateProfile.isPending}>
        Cancel
      </Button>
      <Button
        type="primary"
        onClick={() => form.submit()}
        loading={updateProfile.isPending}
        disabled={!dirty}
      >
        Save changes
      </Button>
    </div>
  );

  return (
    <Card styles={{ body: { padding: "8px 28px 20px" } }} style={{ width: "100%" }}>
      {/* Hero: avatar + identity, actions right */}
      <div className="wl-set-hero">
        <div style={{ position: "relative", flex: "none" }}>
          <Avatar
            size={88}
            src={avatarPreview || undefined}
            icon={<UserOutlined />}
            style={{
              border: `4px solid ${token.colorBgContainer}`,
              boxShadow: token.boxShadowSecondary,
              background: token.colorPrimary,
              fontSize: 28,
              verticalAlign: "middle",
            }}
          >
            {!avatarPreview && displayName ? initials(displayName) : null}
          </Avatar>
          <span
            aria-hidden
            style={{
              position: "absolute",
              right: 0,
              bottom: 2,
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: token.colorText,
              color: token.colorBgContainer,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: `2.5px solid ${token.colorBgContainer}`,
            }}
          >
            <MIcon name="check" size={12} />
          </span>
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: "-.3px",
              color: token.colorText,
              lineHeight: 1.2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {displayName}
          </div>
          <div
            style={{
              fontSize: 13.5,
              color: token.colorTextSecondary,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {email}
            {since ? ` · Member since ${since}` : ""}
          </div>
        </div>
        <Button
          icon={<MIcon name="logout" size={16} />}
          loading={loggingOut}
          onClick={handleLogout}
        >
          Log out
        </Button>
      </div>

      {/* Section header — the Save/Cancel actions live once, in the footer. */}
      <div className="wl-set-head">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16.5, fontWeight: 700, color: token.colorText }}>
            Personal profile
          </div>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Update your photo and personal details here.
          </Text>
        </div>
      </div>

      <Form<ProfileValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={onFinish}
      >
        <SettingRow title="Your name" hint="This will be displayed on your profile.">
          <Form.Item
            name="name"
            rules={[{ required: true, message: "Please enter your name." }]}
            style={{ marginBottom: 0 }}
          >
            <Input
              size="large"
              placeholder="Your name"
              autoComplete="name"
              prefix={<UserOutlined style={{ color: token.colorTextTertiary }} />}
            />
          </Form.Item>
        </SettingRow>

        <SettingRow
          title="Email address"
          hint="You sign in with this. Contact support to change it."
        >
          <Input
            size="large"
            value={email}
            disabled
            prefix={<LockOutlined style={{ color: token.colorTextTertiary }} />}
          />
        </SettingRow>

        {/* The avatar_url field stays in the form store (the upload flow and
            dirty-tracking write it), but has no visible input. */}
        <Form.Item name="avatar_url" hidden>
          <Input />
        </Form.Item>

        <SettingRow
          title="Your photo"
          hint="This will be displayed across your workspace."
          last
        >
          <div className="wl-set-photo">
            <Avatar
              size={64}
              src={avatarPreview || undefined}
              icon={<UserOutlined />}
              style={{
                flex: "none",
                background: token.colorPrimary,
                fontSize: 22,
              }}
            >
              {!avatarPreview && displayName ? initials(displayName) : null}
            </Avatar>
            <Upload.Dragger
              accept="image/*"
              showUploadList={false}
              multiple={false}
              beforeUpload={beforeAvatarUpload}
              style={{ flex: 1 }}
            >
              <div style={{ padding: "2px 8px" }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    margin: "0 auto 8px",
                    borderRadius: 10,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: token.colorTextTertiary,
                    background: token.colorBgContainer,
                  }}
                >
                  {uploadAvatar.isPending ? (
                    <LoadingOutlined style={{ fontSize: 16 }} />
                  ) : (
                    <MIcon name="cloud_upload" size={19} />
                  )}
                </div>
                <div style={{ fontSize: 13.5 }}>
                  <span style={{ fontWeight: 600, color: token.colorPrimary }}>
                    Click to upload
                  </span>{" "}
                  <Text type="secondary">or drag and drop</Text>
                </div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  PNG, JPG or GIF (max. 2MB)
                </Text>
              </div>
            </Upload.Dragger>
          </div>
        </SettingRow>

      </Form>

      {/* Footer actions */}
      <div className="wl-set-foot">{saveButtons}</div>

      <style>{`
        .wl-set-hero{display:flex;align-items:center;gap:18px;padding:18px 0 22px;border-bottom:1px solid ${token.colorBorderSecondary};flex-wrap:wrap;}
        .wl-set-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:20px 0 18px;border-bottom:1px solid ${token.colorBorderSecondary};flex-wrap:wrap;}
        .wl-set-row{display:grid;grid-template-columns:280px minmax(0,1fr);gap:16px 40px;padding:22px 0;border-bottom:1px solid ${token.colorBorderSecondary};}
        .wl-set-row-last{border-bottom:none;}
        .wl-set-label{font-size:14px;font-weight:600;color:${token.colorText};}
        .wl-set-hint{font-size:13px;color:${token.colorTextSecondary};margin-top:2px;line-height:1.5;}
        .wl-set-ctl{max-width:560px;min-width:0;}
        .wl-set-photo{display:flex;align-items:flex-start;gap:18px;}
        .wl-set-foot{display:flex;justify-content:flex-end;padding-top:18px;border-top:1px solid ${token.colorBorderSecondary};}
        @media(max-width:820px){
          .wl-set-row{grid-template-columns:1fr;gap:10px;padding:18px 0;}
          .wl-set-ctl{max-width:none;}
          .wl-set-photo{flex-direction:column;}
        }
      `}</style>
    </Card>
  );
}
