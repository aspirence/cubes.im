// The Workflows sub-navigation (Workflows / Agents) is rendered by the app
// shell as a secondary sidebar (see src/app/(app)/_lib/section-nav.ts).
// Pass-through layout so pages render full-width in the shell content.
export default function WorkflowsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
