"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LegalPage } from "@/components/marketing/legal";

/**
 * Where Facebook sends someone after a data deletion request, and the page an
 * app reviewer opens from the App Dashboard. The deletion itself happens in
 * /api/integrations/meta/data-deletion the moment Facebook calls it; this page
 * confirms it and says what was held in the first place.
 */
function Status() {
  const code = useSearchParams().get("code");
  return (
    <LegalPage title="Facebook data deletion" updated="October 22, 2026">
      {code ? (
        <>
          <h2>Your request is complete</h2>
          <p>
            Confirmation code: <code>{code}</code>
          </p>
          <p>
            The Facebook connection this code refers to has been deleted from Cubes, along with its
            access token and the list of ad accounts it could read. Nothing further is held.
          </p>
        </>
      ) : (
        <>
          <h2>Deleting your Facebook data</h2>
          <p>
            Remove <b>Cubes</b> from{" "}
            <a href="https://www.facebook.com/settings?tab=applications" target="_blank" rel="noreferrer">
              Facebook Settings → Apps and Websites
            </a>
            . Facebook then tells us, and we delete the connection straight away.
          </p>
        </>
      )}

      <h2>What Cubes stores when you connect Facebook Ads</h2>
      <ul>
        <li>Your Facebook user or system-user id and name, so the workspace can see who connected.</li>
        <li>The access token, readable only by our servers and never shown in the app.</li>
        <li>
          The ad accounts the login can read — id, name, currency, timezone, status — so a workflow can
          be pointed at one.
        </li>
      </ul>
      <p>
        Cubes reads advertising statistics from Facebook when a workflow runs and hands them to wherever
        that workflow sends them, for example a spreadsheet the workspace owns. Deleting the connection
        stops all of that; anything a workflow already wrote into the workspace&rsquo;s own tools belongs to
        the workspace, and can be removed there.
      </p>

      <h2>Other ways to delete it</h2>
      <ul>
        <li>
          In Cubes: <b>Workflows → Integrations → Disconnect</b>. This also tells Facebook to revoke the
          permission.
        </li>
        <li>
          By email: <a href="mailto:support@cubes.im">support@cubes.im</a>.
        </li>
      </ul>
      <p>
        See the <Link href="/privacy">Privacy Policy</Link> for everything else Cubes stores.
      </p>
    </LegalPage>
  );
}

export default function MetaDataDeletionPage() {
  return (
    <Suspense fallback={null}>
      <Status />
    </Suspense>
  );
}
