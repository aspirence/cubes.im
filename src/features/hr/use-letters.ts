"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Json } from "@/types/database";
import { useHrAccess } from "./use-hr";
import {
  renderLetterDocument,
  starterLetterTemplates,
  type LetterMergePayload,
} from "./letters";
import type {
  CreateLetterTemplateInput,
  HrEmployeeWithRelations,
  HrGeneratedDocumentRow,
  HrGeneratedDocumentWithEmployee,
  HrLetterDocumentType,
  HrLetterTemplateRow,
  UpdateLetterTemplateInput,
} from "./types";

export type {
  HrGeneratedDocumentRow,
  HrGeneratedDocumentWithEmployee,
  HrLetterTemplateRow,
  HrLetterDocumentType,
} from "./types";
export type { LetterMergePayload } from "./letters";

type GenerateDocumentInput = {
  template: HrLetterTemplateRow;
  employee: HrEmployeeWithRelations;
  organizationName: string;
};

const ROOT = "hr-letters" as const;
const templatesKey = (
  orgId: string | undefined,
  documentType: HrLetterDocumentType | undefined,
) => [ROOT, "templates", orgId, documentType ?? "all"] as const;
const generatedDocsKey = (
  orgId: string | undefined,
  employeeId: string | undefined,
  documentType: string | undefined,
) => [ROOT, "generated", orgId, employeeId ?? "all", documentType ?? "all"] as const;

export function useLetterTemplates(
  documentType?: HrLetterDocumentType,
  enabled = true,
) {
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useHrAccess();

  return useQuery({
    queryKey: templatesKey(orgId, documentType),
    enabled: Boolean(orgId) && enabled,
    queryFn: async (): Promise<HrLetterTemplateRow[]> => {
      let query = supabase
        .from("hr_letter_templates")
        .select("*")
        .eq("org_id", orgId as string)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (documentType) query = query.eq("document_type", documentType);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCreateLetterTemplate() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (
      input: CreateLetterTemplateInput,
    ): Promise<HrLetterTemplateRow> => {
      if (!orgId) throw new Error("No organization");
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;

      const { data, error } = await supabase
        .from("hr_letter_templates")
        .insert({
          ...input,
          org_id: orgId,
          created_by: user?.id ?? null,
          updated_by: user?.id ?? null,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ROOT, "templates", orgId] });
    },
  });
}

export function useUpdateLetterTemplate() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (
      input: UpdateLetterTemplateInput,
    ): Promise<HrLetterTemplateRow> => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;

      const { data, error } = await supabase
        .from("hr_letter_templates")
        .update({
          ...input.patch,
          updated_by: user?.id ?? null,
        })
        .eq("id", input.id)
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ROOT, "templates", orgId] });
    },
  });
}

export function useDeleteLetterTemplate() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from("hr_letter_templates")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ROOT, "templates", orgId] });
    },
  });
}

export function useInstallDefaultLetterTemplates() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (): Promise<HrLetterTemplateRow[]> => {
      if (!orgId) throw new Error("No organization");
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;

      const rows = starterLetterTemplates().map((template) => ({
        ...template,
        org_id: orgId,
        created_by: user?.id ?? null,
        updated_by: user?.id ?? null,
      }));

      const { data, error } = await supabase
        .from("hr_letter_templates")
        .upsert(rows, {
          onConflict: "org_id,name",
          ignoreDuplicates: false,
        })
        .select("*");
      if (error) throw error;
      return data ?? [];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ROOT, "templates", orgId] });
    },
  });
}

export function useGeneratedDocuments(options?: {
  employeeId?: string;
  documentType?: string;
  enabled?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useHrAccess();
  const employeeId = options?.employeeId;
  const documentType = options?.documentType;
  const enabled = options?.enabled ?? true;

  return useQuery({
    queryKey: generatedDocsKey(orgId, employeeId, documentType),
    enabled: Boolean(orgId) && enabled,
    queryFn: async (): Promise<HrGeneratedDocumentWithEmployee[]> => {
      let query = supabase
        .from("hr_generated_documents")
        .select("*, employee:hr_employees!employee_id(id, full_name)")
        .eq("org_id", orgId as string)
        .order("created_at", { ascending: false });
      if (employeeId) query = query.eq("employee_id", employeeId);
      if (documentType) query = query.eq("document_type", documentType);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as HrGeneratedDocumentWithEmployee[];
    },
  });
}

export function useGenerateDocument() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (
      input: GenerateDocumentInput,
    ): Promise<HrGeneratedDocumentRow> => {
      if (!orgId) throw new Error("No organization");
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;

      const rendered = renderLetterDocument(
        input.template,
        input.employee,
        input.organizationName,
      );

      const { data, error } = await supabase
        .from("hr_generated_documents")
        .insert({
          org_id: orgId,
          employee_id: input.employee.id,
          template_id: input.template.id,
          document_type: rendered.documentType,
          title: rendered.title,
          template_name: rendered.templateName,
          template_title_template: rendered.templateTitleTemplate,
          template_body_template: rendered.templateBodyTemplate,
          merge_payload: rendered.mergePayload as Json,
          merged_text: rendered.mergedText,
          merged_html: rendered.mergedHtml,
          generated_by: user?.id ?? null,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (document) => {
      queryClient.invalidateQueries({
        queryKey: [ROOT, "generated", orgId],
      });
      queryClient.invalidateQueries({
        queryKey: [ROOT, "generated", orgId, document.employee_id],
      });
    },
  });
}

export function useDeleteGeneratedDocument() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from("hr_generated_documents")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ROOT, "generated", orgId] });
    },
  });
}
