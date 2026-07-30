import { redirect } from "next/navigation";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function HrDocumentsAliasPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const entry of value) query.append(key, entry);
      continue;
    }
    if (typeof value === "string") query.set(key, value);
  }

  const suffix = query.toString();
  redirect(suffix ? `/hr/onboarding?${suffix}` : "/hr/onboarding");
}

