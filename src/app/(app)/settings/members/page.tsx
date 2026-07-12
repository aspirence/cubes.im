"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "antd";

/** Members management now lives in Teams (/people). Redirect legacy links. */
export default function MembersRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/people");
  }, [router]);
  return <Skeleton active paragraph={{ rows: 4 }} />;
}
