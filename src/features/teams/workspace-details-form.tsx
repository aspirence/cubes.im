"use client";

import { Form, Input, Select } from "antd";

/**
 * The company-profile fields for a workspace — shared between the onboarding
 * wizard, the "New workspace" modal, and the Settings editor. Renders only
 * Form.Items, so callers embed it inside their own <Form> (field names match
 * `TeamDetailsInput`).
 */

export const INDUSTRY_OPTIONS = [
  "Agency / Marketing",
  "Software / IT",
  "Design / Creative",
  "E-commerce",
  "Consulting",
  "Education",
  "Finance",
  "Healthcare",
  "Manufacturing",
  "Media / Production",
  "Non-profit",
  "Real estate",
  "Other",
].map((v) => ({ value: v, label: v }));

export const COMPANY_SIZE_OPTIONS = [
  { value: "1", label: "Just me" },
  { value: "2-5", label: "2–5 people" },
  { value: "6-20", label: "6–20 people" },
  { value: "21-50", label: "21–50 people" },
  { value: "51-200", label: "51–200 people" },
  { value: "200+", label: "More than 200" },
];

/** Two Form.Items side by side on wide screens. */
function Pair({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        columnGap: 14,
      }}
    >
      {children}
    </div>
  );
}

export function WorkspaceDetailsFields() {
  return (
    <>
      <Pair>
        <Form.Item label="Industry" name="industry">
          <Select
            placeholder="Select industry"
            options={INDUSTRY_OPTIONS}
            allowClear
            showSearch
          />
        </Form.Item>
        <Form.Item label="Company size" name="companySize">
          <Select
            placeholder="Select size"
            options={COMPANY_SIZE_OPTIONS}
            allowClear
          />
        </Form.Item>
      </Pair>

      <Pair>
        <Form.Item
          label="Website"
          name="website"
          rules={[{ max: 255, message: "Website is too long." }]}
        >
          <Input placeholder="https://acme.com" inputMode="url" />
        </Form.Item>
        <Form.Item
          label="Contact email"
          name="contactEmail"
          rules={[{ type: "email", message: "Please enter a valid email." }]}
        >
          <Input placeholder="hello@acme.com" inputMode="email" />
        </Form.Item>
      </Pair>

      <Pair>
        <Form.Item label="Phone" name="contactNumber">
          <Input placeholder="+91 98765 43210" inputMode="tel" />
        </Form.Item>
        <Form.Item label="Tax / GST ID" name="taxId">
          <Input placeholder="Optional" />
        </Form.Item>
      </Pair>

      <Form.Item label="Address line 1" name="addressLine1">
        <Input placeholder="Street address" autoComplete="address-line1" />
      </Form.Item>
      <Form.Item label="Address line 2" name="addressLine2">
        <Input placeholder="Suite, floor (optional)" autoComplete="address-line2" />
      </Form.Item>

      <Pair>
        <Form.Item label="City" name="city">
          <Input autoComplete="address-level2" />
        </Form.Item>
        <Form.Item label="State / Region" name="state">
          <Input autoComplete="address-level1" />
        </Form.Item>
      </Pair>

      <Pair>
        <Form.Item label="Country" name="country">
          <Input autoComplete="country-name" />
        </Form.Item>
        <Form.Item label="Postal code" name="postalCode">
          <Input autoComplete="postal-code" />
        </Form.Item>
      </Pair>
    </>
  );
}
