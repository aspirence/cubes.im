"use client";

import { SectionLabel } from "../_lib/ui";

/**
 * One labelled group of fields inside a create/edit drawer.
 * Shared so every form drawer breathes on the same 18px rhythm.
 */
export function FormSection({
  label,
  first = false,
  children,
}: {
  label: string;
  /** The first section sits flush against the top of the scroll area. */
  first?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: first ? 0 : 18 }}>
      <SectionLabel style={{ marginBottom: 12 }}>{label}</SectionLabel>
      {children}
    </div>
  );
}
