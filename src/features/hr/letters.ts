"use client";

import dayjs from "dayjs";
import type {
  CreateLetterTemplateInput,
  HrEmployeeWithRelations,
  HrGeneratedDocumentRow,
  HrLetterDocumentType,
  HrLetterTemplateRow,
} from "./types";

export const HR_DOCUMENT_TYPE_OPTIONS: {
  label: string;
  value: HrLetterDocumentType;
}[] = [
  { label: "Offer letter", value: "offer_letter" },
  { label: "Appointment letter", value: "appointment_letter" },
  { label: "Experience letter", value: "experience_letter" },
  { label: "Relieving letter", value: "relieving_letter" },
  { label: "Salary certificate", value: "salary_certificate" },
  { label: "NDA", value: "nda" },
  { label: "Internship letter", value: "internship_letter" },
  { label: "Warning letter", value: "warning_letter" },
  { label: "Custom", value: "custom" },
];

export type LetterMergePayload = {
  org: {
    name: string;
  };
  employee: {
    full_name: string;
    employee_code: string;
    work_email: string;
    personal_email: string;
    phone: string;
    work_location: string;
    address: string;
    emergency_contact: string;
    employment_type: string;
    status: string;
    date_of_joining: string;
    date_of_birth: string;
    probation_end: string;
  };
  department: {
    name: string;
  };
  designation: {
    title: string;
  };
  manager: {
    full_name: string;
  };
  generated: {
    date_iso: string;
    date_long: string;
  };
};

export type RenderedLetterDocument = {
  documentType: string;
  title: string;
  mergePayload: LetterMergePayload;
  mergedText: string;
  mergedHtml: string;
  templateName: string;
  templateTitleTemplate: string;
  templateBodyTemplate: string;
};

const DEFAULT_TEMPLATES: CreateLetterTemplateInput[] = [
  {
    name: "Default offer letter",
    document_type: "offer_letter",
    title_template: "Offer letter - {{employee.full_name}}",
    body_template: `Date: {{generated.date_long}}

Dear {{employee.full_name}},

We are pleased to offer you the position of {{designation.title}} at {{org.name}}.
Your joining date will be {{employee.date_of_joining}}, and your primary work location will be {{employee.work_location}}.

Please complete the onboarding steps in Cubes and acknowledge this offer with HR.

Regards,
{{org.name}} HR Team`,
    is_active: true,
    is_default: true,
    sort_order: 10,
  },
  {
    name: "Default appointment letter",
    document_type: "appointment_letter",
    title_template: "Appointment letter - {{employee.full_name}}",
    body_template: `Date: {{generated.date_long}}

This is to confirm that {{employee.full_name}} is appointed as {{designation.title}} in the {{department.name}} department at {{org.name}}.
Employee code: {{employee.employee_code}}
Reporting manager: {{manager.full_name}}

Please keep this letter for your records.`,
    is_active: true,
    is_default: true,
    sort_order: 20,
  },
  {
    name: "Default relieving letter",
    document_type: "relieving_letter",
    title_template: "Relieving letter - {{employee.full_name}}",
    body_template: `Date: {{generated.date_long}}

This is to certify that {{employee.full_name}} has been relieved from their duties at {{org.name}}.
Role: {{designation.title}}
Department: {{department.name}}

We thank them for their contribution and wish them success ahead.`,
    is_active: true,
    is_default: true,
    sort_order: 30,
  },
  {
    name: "Default salary certificate",
    document_type: "salary_certificate",
    title_template: "Salary certificate - {{employee.full_name}}",
    body_template: `Date: {{generated.date_long}}

This is to certify that {{employee.full_name}} is employed with {{org.name}} as {{designation.title}} in the {{department.name}} department.
This certificate is issued on request for official use.

For any clarification, please contact HR at {{employee.work_email}}.`,
    is_active: true,
    is_default: true,
    sort_order: 40,
  },
];

function fallback(value: string | null | undefined, empty = "—"): string {
  const normalized = value?.trim();
  return normalized ? normalized : empty;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getPathValue(payload: unknown, path: string): string {
  const value = path.split(".").reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== "object") return "";
    return (acc as Record<string, unknown>)[key];
  }, payload);
  if (value === null || value === undefined) return "";
  return String(value);
}

export function formatHrDocumentType(value: string): string {
  return (
    HR_DOCUMENT_TYPE_OPTIONS.find((option) => option.value === value)?.label ??
    value
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

export function buildLetterMergePayload(
  employee: HrEmployeeWithRelations,
  organizationName: string,
): LetterMergePayload {
  const dateOfJoining = employee.date_of_joining
    ? dayjs(employee.date_of_joining).format("MMMM D, YYYY")
    : "TBD";
  const dateOfBirth = employee.date_of_birth
    ? dayjs(employee.date_of_birth).format("MMMM D, YYYY")
    : "—";
  const probationEnd = employee.probation_end
    ? dayjs(employee.probation_end).format("MMMM D, YYYY")
    : "—";

  return {
    org: {
      name: fallback(organizationName, "Your organization"),
    },
    employee: {
      full_name: fallback(employee.full_name, "Employee"),
      employee_code: fallback(employee.employee_code, "Pending"),
      work_email: fallback(employee.work_email, "Not provided"),
      personal_email: fallback(employee.personal_email, "Not provided"),
      phone: fallback(employee.phone, "Not provided"),
      work_location: fallback(employee.work_location, "Not assigned"),
      address: fallback(employee.address, "Not provided"),
      emergency_contact: fallback(employee.emergency_contact, "Not provided"),
      employment_type: fallback(employee.employment_type, "Not assigned"),
      status: fallback(employee.status, "Not assigned"),
      date_of_joining: dateOfJoining,
      date_of_birth: dateOfBirth,
      probation_end: probationEnd,
    },
    department: {
      name: fallback(employee.department?.name, "General"),
    },
    designation: {
      title: fallback(employee.designation?.title, "Team member"),
    },
    manager: {
      full_name: fallback(employee.manager?.full_name, "Reporting manager"),
    },
    generated: {
      date_iso: dayjs().format("YYYY-MM-DD"),
      date_long: dayjs().format("MMMM D, YYYY"),
    },
  };
}

export function renderTemplateString(
  template: string,
  payload: LetterMergePayload,
): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, rawPath) => {
    const resolved = getPathValue(payload, rawPath.trim());
    return resolved || "";
  });
}

export function richTextFromPlainText(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

export function renderLetterDocument(
  template: Pick<
    HrLetterTemplateRow,
    "document_type" | "name" | "title_template" | "body_template"
  >,
  employee: HrEmployeeWithRelations,
  organizationName: string,
): RenderedLetterDocument {
  const mergePayload = buildLetterMergePayload(employee, organizationName);
  const title = renderTemplateString(template.title_template, mergePayload);
  const mergedText = renderTemplateString(template.body_template, mergePayload);

  return {
    documentType: template.document_type,
    title,
    mergePayload,
    mergedText,
    mergedHtml: richTextFromPlainText(mergedText),
    templateName: template.name,
    templateTitleTemplate: template.title_template,
    templateBodyTemplate: template.body_template,
  };
}

export function starterLetterTemplates(): CreateLetterTemplateInput[] {
  return DEFAULT_TEMPLATES.map((template) => ({ ...template }));
}

export function buildGeneratedDocumentFileName(
  document: Pick<HrGeneratedDocumentRow, "title" | "document_type" | "created_at">,
): string {
  const base = document.title?.trim() || formatHrDocumentType(document.document_type);
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const stamp = dayjs(document.created_at).format("YYYYMMDD");
  return `${slug || "document"}-${stamp}.pdf`;
}

