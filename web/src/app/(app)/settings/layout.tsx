// The Settings sub-navigation is rendered by the app shell as a secondary
// sidebar (see src/app/(app)/_lib/section-nav.ts). Pass-through layout.
export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
