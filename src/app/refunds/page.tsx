"use client";

import Link from "next/link";
import { LegalPage } from "@/components/marketing/legal";

export default function RefundsPage() {
  return (
    <LegalPage title="Refund & Cancellation Policy" updated="July 9, 2026">
      <h2>1. The short version</h2>
      <ul>
        <li>Cancel anytime — your plan stays active until the end of the paid period.</li>
        <li>First-time Cloud subscriptions: full refund within 14 days, no questions asked.</li>
        <li>Self-hosted Cubes is free and open source — nothing to refund.</li>
      </ul>

      <h2>2. Cancelling</h2>
      <p>
        Workspace owners can cancel from <b>Admin center → Billing</b> at any time.
        Cancellation stops future charges; your workspace keeps full access until the
        end of the period you already paid for, then downgrades. Your data remains
        exportable for 30 days after that, as described in the{" "}
        <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>3. Refunds</h2>
      <ul>
        <li>
          <b>14-day guarantee:</b> if Cubes Cloud isn&rsquo;t right for you, email us
          within 14 days of your first payment for a full refund.
        </li>
        <li>
          <b>Renewals:</b> renewal charges are generally non-refundable, but if you
          cancel within 7 days of an annual renewal and haven&rsquo;t materially used
          the Service since, we&rsquo;ll refund it.
        </li>
        <li>
          <b>Storage add-ons:</b> billed for the current period and non-refundable
          once the period starts; reducing storage takes effect next cycle.
        </li>
        <li>
          <b>Our fault:</b> if a billing error or extended outage on our side caused
          the charge, we&rsquo;ll refund or credit it in full — always.
        </li>
      </ul>

      <h2>4. How to request one</h2>
      <p>
        Email <a href="mailto:billing@cubes.im">billing@cubes.im</a> from the email
        on the workspace owner&rsquo;s account with your workspace name. Refunds are
        issued to the original payment method within 5–10 business days of approval.
      </p>

      <h2>5. Questions</h2>
      <p>
        Anything unclear? <a href="mailto:support@cubes.im">support@cubes.im</a> — a
        human reads it. See also the <Link href="/terms">Terms of Service</Link>.
      </p>
    </LegalPage>
  );
}
