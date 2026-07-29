import { redirect } from "next/navigation";

export default function ReportingIndexPage() {
  // Time analytics is the one reporting page every member can use; the
  // team-wide pages are admin-only (see section-nav requiresAdmin flags).
  redirect("/reporting/time");
}
