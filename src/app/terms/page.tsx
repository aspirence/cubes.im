"use client";

import Link from "next/link";
import { LegalPage } from "@/components/marketing/legal";
import { GITHUB_URL } from "@/components/marketing/pricing-plans";

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="July 9, 2026">
      <h2>1. Agreement</h2>
      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of
        Cubes — the hosted service at cubes.im (&ldquo;Cubes Cloud&rdquo;) and the
        websites, apps, and APIs we operate (together, the &ldquo;Service&rdquo;). By
        creating an account or using the Service you agree to these Terms. If you are
        using the Service on behalf of an organization, you agree on its behalf and
        confirm you have authority to do so.
      </p>

      <h2>2. The service</h2>
      <p>
        Cubes is an all-in-one workspace: project management, video review, client
        portals, social publishing, HR, and related tools. Cubes is also{" "}
        <a href={GITHUB_URL} target="_blank" rel="noreferrer">open source</a> — you may
        self-host the software on your own infrastructure, in which case these Terms
        apply only to your use of our hosted Service, not to your self-hosted copy
        (which is governed by the software&rsquo;s open-source license).
      </p>

      <h2>3. Your account</h2>
      <ul>
        <li>You must provide accurate information and keep your credentials secure.</li>
        <li>You are responsible for all activity under your account and workspace.</li>
        <li>
          Workspace owners and admins control member access, roles, and the data in
          their workspace — including data of members and invited clients.
        </li>
      </ul>

      <h2>4. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the Service for unlawful, harmful, or infringing activity;</li>
        <li>Probe, disrupt, or overload the Service or bypass its security or rate limits;</li>
        <li>Upload malware or content you don&rsquo;t have the right to share;</li>
        <li>Resell or white-label the hosted Service without our written permission;</li>
        <li>Send spam or abusive communications through client portals or notifications.</li>
      </ul>

      <h2>5. Your content</h2>
      <p>
        You own the content you and your team put into Cubes — tasks, files, videos,
        docs, and everything else. You grant us only the rights needed to operate the
        Service: to store, process, transmit, and display your content to the people
        you share it with (your team, and clients you invite via portals or share
        links). We do not sell your content or use it to train AI models.
      </p>

      <h2>6. Plans, billing &amp; storage</h2>
      <ul>
        <li>
          <b>Self-hosted</b> is free — unlimited seats, governed by the open-source
          license, with no obligations to us.
        </li>
        <li>
          <b>Cloud</b> is billed as a flat recurring subscription for unlimited team
          members, plus storage beyond the included base, as shown on the{" "}
          <Link href="/pricing">pricing page</Link> at the time of purchase.
        </li>
        <li>
          Prices may change; we will notify workspace owners in advance and changes
          apply from the next billing cycle. Taxes may apply based on your location.
        </li>
        <li>
          Cancellation and refunds are described in the{" "}
          <Link href="/refunds">Refund &amp; Cancellation Policy</Link>.
        </li>
      </ul>

      <h2>7. Open-source software</h2>
      <p>
        The Cubes source code is available on{" "}
        <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a> under its
        published license. These Terms do not limit any rights granted by that
        license for self-hosted use.
      </p>

      <h2>8. Third-party services</h2>
      <p>
        The Service integrates with third parties you may connect (e.g. social
        networks for publishing, or AI providers if you supply an API key). Your use
        of those services is governed by their own terms, and we are not responsible
        for them.
      </p>

      <h2>9. Suspension &amp; termination</h2>
      <p>
        You can stop using the Service and delete your account at any time from
        Settings. We may suspend or terminate access for material breach of these
        Terms, non-payment, or to protect the Service and its users. On termination
        we will make your data available for export for 30 days, after which it may
        be permanently deleted, as described in the{" "}
        <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>10. Disclaimers</h2>
      <p>
        The Service is provided <b>&ldquo;as is&rdquo;</b> and <b>&ldquo;as
        available&rdquo;</b> without warranties of any kind, express or implied,
        including fitness for a particular purpose, merchantability, and
        non-infringement. We do not warrant that the Service will be uninterrupted,
        secure, or error-free.
      </p>

      <h2>11. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, Cubes and its team will not be liable
        for indirect, incidental, special, consequential, or punitive damages, or any
        loss of profits, revenue, or data. Our total liability for any claim relating
        to the Service is limited to the amount you paid us in the 12 months before
        the claim arose (or USD 50 if you paid nothing).
      </p>

      <h2>12. Changes to these terms</h2>
      <p>
        We may update these Terms from time to time. For material changes we will
        notify workspace owners by email or in-product notice at least 14 days before
        they take effect. Continued use after the effective date constitutes
        acceptance.
      </p>

      <h2>13. Governing law</h2>
      <p>
        These Terms are governed by the laws of India, and disputes are subject to
        the exclusive jurisdiction of the courts of India, unless mandatory law in
        your country of residence provides otherwise.
      </p>

      <h2>14. Contact</h2>
      <p>
        Questions about these Terms: <a href="mailto:support@cubes.im">support@cubes.im</a>.
      </p>
    </LegalPage>
  );
}
