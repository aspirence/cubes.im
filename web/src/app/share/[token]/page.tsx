import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";

/**
 * Public, read-only project view reached via an unguessable share token
 * (`projects.share_token`). Data comes from the `get_shared_project` RPC,
 * which returns null unless the project's visibility is 'public' — so this
 * page needs no session and leaks nothing for private/team projects.
 */

interface SharedTask {
  name: string;
  done: boolean;
  end_date: string | null;
  status: string | null;
}

interface SharedProject {
  project: {
    name: string;
    color_code: string;
    notes: string | null;
    start_date: string | null;
    end_date: string | null;
  };
  tasks: SharedTask[];
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata: Metadata = {
  title: "Shared project",
};

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function Unavailable() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        background: "#fbfbfc",
        color: "#6a6d78",
        fontFamily: "inherit",
        padding: 24,
        textAlign: "center",
      }}
    >
      <span style={{ fontSize: 40 }} aria-hidden>
        🔒
      </span>
      <h1 style={{ fontSize: 18, fontWeight: 600, color: "#17171c" }}>
        This project isn&apos;t available
      </h1>
      <p style={{ fontSize: 14, maxWidth: 380 }}>
        The link may be wrong, or sharing may have been turned off by the
        project&apos;s owner.
      </p>
    </main>
  );
}

export default async function SharedProjectPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Reject malformed tokens before they hit the uuid-typed RPC argument.
  if (!UUID_RE.test(token)) {
    return <Unavailable />;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_shared_project", {
    p_token: token,
  });

  if (error || !data) {
    return <Unavailable />;
  }

  const shared = data as unknown as SharedProject;
  const { project, tasks } = shared;
  const doneCount = tasks.filter((t) => t.done).length;
  const start = formatDate(project.start_date);
  const end = formatDate(project.end_date);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#fbfbfc",
        color: "#17171c",
        padding: "48px 16px",
      }}
    >
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            aria-hidden
            style={{
              width: 14,
              height: 14,
              borderRadius: 4,
              background: project.color_code,
              flex: "none",
            }}
          />
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>{project.name}</h1>
        </div>
        <p style={{ marginTop: 6, fontSize: 13, color: "#9a9da8" }}>
          Shared read-only view
          {start || end ? (
            <>
              {" · "}
              {start ?? "…"} → {end ?? "…"}
            </>
          ) : null}
          {" · "}
          {doneCount}/{tasks.length} tasks done
        </p>

        {project.notes ? (
          <p
            style={{
              marginTop: 16,
              fontSize: 14,
              lineHeight: 1.6,
              color: "#494b54",
              whiteSpace: "pre-wrap",
            }}
          >
            {project.notes}
          </p>
        ) : null}

        {/* Tasks */}
        <div
          style={{
            marginTop: 28,
            background: "#ffffff",
            border: "1px solid #ececf0",
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          {tasks.length === 0 ? (
            <p style={{ padding: 20, fontSize: 14, color: "#9a9da8" }}>
              No tasks yet.
            </p>
          ) : (
            tasks.map((t, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 16px",
                  borderTop: i === 0 ? "none" : "1px solid #f0f0f3",
                  fontSize: 14,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 16,
                    height: 16,
                    flex: "none",
                    borderRadius: 999,
                    border: t.done ? "none" : "1.5px solid #d5d7de",
                    background: t.done ? "#22a06b" : "transparent",
                    color: "#fff",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    lineHeight: 1,
                  }}
                >
                  {t.done ? "✓" : ""}
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: t.done ? "#9a9da8" : "#17171c",
                    textDecoration: t.done ? "line-through" : "none",
                  }}
                >
                  {t.name}
                </span>
                {t.status ? (
                  <span
                    style={{
                      flex: "none",
                      fontSize: 12,
                      color: "#6a6d78",
                      background: "#f0f0f3",
                      borderRadius: 999,
                      padding: "2px 10px",
                    }}
                  >
                    {t.status}
                  </span>
                ) : null}
                {formatDate(t.end_date) ? (
                  <span
                    style={{ flex: "none", fontSize: 12, color: "#9a9da8" }}
                  >
                    {formatDate(t.end_date)}
                  </span>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
