"use client";

import Link from "next/link";
import { LegalPage } from "@/components/marketing/legal";
import { GITHUB_URL } from "@/components/marketing/pricing-plans";

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="July 9, 2026">
      <h2>1. What this covers</h2>
      <p>
        This policy explains what we collect and how we use it when you use Cubes
        Cloud (the hosted service at cubes.im) and our websites. Cubes Cloud is
        operated by{" "}
        <a href="https://www.aspirence.com/" target="_blank" rel="noreferrer">
          Aspirence Worldwide Private Limited
        </a>{" "}
        (CIN: U62010UP2024PTC208995), the data controller for the hosted service. If you{" "}
        <a href={GITHUB_URL} target="_blank" rel="noreferrer">self-host Cubes</a>,
        your data lives on your own infrastructure and this policy does not apply to
        that deployment — your organization is the data controller there.
      </p>

      <h2>2. What we collect</h2>
      <ul>
        <li>
          <b>Account data</b> — name, email, password (stored hashed), avatar, and
          workspace/team membership.
        </li>
        <li>
          <b>Workspace content</b> — the projects, tasks, comments, files, videos,
          docs, HR records, and other content you and your team create.
        </li>
        <li>
          <b>Billing data</b> — plan, invoices, and payment status. Card details are
          handled by our payment processor and never touch our servers.
        </li>
        <li>
          <b>Usage &amp; device data</b> — logs (IP address, browser, timestamps) and
          basic product analytics used to keep the Service secure and improve it.
        </li>
        <li>
          <b>Client portal visitors</b> — portal access is token-gated; we log
          access events but do not require your clients to create accounts.
        </li>
      </ul>

      <h2>3. How we use it</h2>
      <ul>
        <li>To provide, secure, and improve the Service;</li>
        <li>To send transactional email (invites, notifications, receipts, security alerts);</li>
        <li>To respond to support requests;</li>
        <li>To comply with legal obligations.</li>
      </ul>
      <p>
        We do <b>not</b> sell your personal data or your content, and we do not use
        your content to train AI models. Optional AI features run only when your
        workspace configures them, using the provider you choose.
      </p>

      <h2>4. Where your data lives</h2>
      <p>
        Cubes Cloud runs on managed cloud infrastructure (application hosting,
        Postgres database, and file storage provided by our infrastructure
        subprocessors). All data is encrypted in transit (TLS) and at rest.
        Authorization is enforced in the database itself via row-level security, so
        your workspace&rsquo;s data is isolated from other tenants.
      </p>

      <h2>5. Cookies</h2>
      <p>
        We use essential cookies only: session authentication and your UI
        preferences (like theme). We do not run third-party advertising or tracking
        cookies on the product.
      </p>

      <h2>6. Sharing</h2>
      <p>We share data only with:</p>
      <ul>
        <li>
          <b>Subprocessors</b> that host and operate the Service (cloud
          infrastructure, email delivery, payment processing) under data-processing
          agreements;
        </li>
        <li>
          <b>People you choose</b> — teammates in your workspace, and clients you
          invite via portals or share links;
        </li>
        <li>
          <b>Authorities</b> when required by law, after verifying the request.
        </li>
      </ul>

      <h2>7. Retention &amp; deletion</h2>
      <p>
        Your data is retained while your account is active. When you delete content,
        your account, or your workspace, it is removed from production systems
        promptly and from backups within 30 days. After subscription termination we
        keep workspace data available for export for 30 days, then delete it.
      </p>

      <h2>8. Security</h2>
      <p>
        We follow industry practice: encrypted transport and storage, row-level
        security on every table, scoped API keys, and least-privilege access for our
        team. No system is perfectly secure — report vulnerabilities to{" "}
        <a href="mailto:hello.cubesim@gmail.com">hello.cubesim@gmail.com</a> and we will respond
        quickly.
      </p>

      <h2>9. Your rights</h2>
      <p>
        Depending on your location (e.g. GDPR in the EU), you may have rights to
        access, correct, export, restrict, or delete your personal data. You can
        exercise most of these directly in Settings (profile editing, data export,
        account deletion) or by emailing{" "}
        <a href="mailto:hello.cubesim@gmail.com">hello.cubesim@gmail.com</a>. If you are a member
        of someone else&rsquo;s workspace, your workspace owner controls that
        workspace&rsquo;s data — direct requests to them first.
      </p>

      <h2>10. Children</h2>
      <p>
        The Service is not directed to children under 16, and we do not knowingly
        collect their data.
      </p>

      <h2>11. Changes</h2>
      <p>
        We may update this policy; material changes are announced by email or
        in-product notice at least 14 days in advance. The &ldquo;Last updated&rdquo;
        date above always reflects the current version.
      </p>

      <h2>12. Contact</h2>
      <p>
        Privacy questions: <a href="mailto:hello.cubesim@gmail.com">hello.cubesim@gmail.com</a>.
        General support: <a href="mailto:hello.cubesim@gmail.com">hello.cubesim@gmail.com</a>.
        Data controller: Aspirence Worldwide Private Limited (CIN:
        U62010UP2024PTC208995). See also our{" "}
        <Link href="/terms">Terms of Service</Link>.
      </p>
    </LegalPage>
  );
}
