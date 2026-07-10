// The Admin sub-navigation is rendered by the app shell as a secondary sidebar
// (see src/app/(app)/_lib/section-nav.ts). Pass-through layout.
export default function AdminCenterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
