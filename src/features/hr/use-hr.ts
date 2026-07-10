"use client";

import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useUserOrg } from "@/features/admin/use-admin";
import type {
  AddHrAdminInput,
  CreateDepartmentInput,
  CreateDesignationInput,
  CreateEmployeeInput,
  HrAdminWithUser,
  HrDepartmentRow,
  HrDesignationRow,
  HrDocumentRow,
  HrEmployeeWithRelations,
  UpdateDepartmentInput,
  UpdateEmployeeInput,
  UploadEmployeeDocumentInput,
} from "./types";

export type {
  AddHrAdminInput,
  CreateDepartmentInput,
  CreateDesignationInput,
  CreateEmployeeInput,
  EmployeeStatus,
  EmploymentType,
  HrAdminUser,
  HrAdminWithUser,
  HrDepartmentRow,
  HrDesignationRow,
  HrDocumentRow,
  HrEmployeeRow,
  HrEmployeeWithRelations,
  UpdateDepartmentInput,
  UpdateEmployeeInput,
  UploadEmployeeDocumentInput,
} from "./types";

/** Private Storage bucket holding HR documents. */
const HR_DOCS_BUCKET = "hr-docs" as const;

const HR_ROOT = "hr" as const;
const accessKey = (orgId: string | undefined) =>
  [HR_ROOT, "access", orgId] as const;
const employeesKey = (orgId: string | undefined) =>
  [HR_ROOT, "employees", orgId] as const;
const employeeKey = (id: string | undefined) =>
  [HR_ROOT, "employee", id] as const;
const departmentsKey = (orgId: string | undefined) =>
  [HR_ROOT, "departments", orgId] as const;
const designationsKey = (orgId: string | undefined) =>
  [HR_ROOT, "designations", orgId] as const;
const adminsKey = (orgId: string | undefined) =>
  [HR_ROOT, "admins", orgId] as const;
const documentsKey = (employeeId: string | undefined) =>
  [HR_ROOT, "documents", employeeId] as const;

/** PostgREST select string embedding the department/designation/manager. */
const EMPLOYEE_SELECT =
  "*, department:hr_departments!department_id(id, name), " +
  "designation:hr_designations!designation_id(id, title), " +
  "manager:hr_employees!manager_id(id, full_name)";

/** Derives a lowercase file extension from a filename. */
function fileExtension(fileName: string, fallback = ""): string {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0 || dot === fileName.length - 1) return fallback;
  return fileName.slice(dot + 1).toLowerCase();
}

/* -------------------------------------------------------------------------- */
/* Access                                                                     */
/* -------------------------------------------------------------------------- */

export interface HrAccess {
  orgId: string | undefined;
  isHrAdmin: boolean;
  isLoading: boolean;
}

/**
 * Resolves the caller's HR access for the active organization.
 *
 * `orgId` comes from `useUserOrg()`. `isHrAdmin` is true when the caller owns
 * the org (`useUserOrg().isOwner`) OR has a row in `hr_admins` for that org —
 * mirroring the server-side `is_hr_admin` predicate. The `hr_admins` lookup is
 * disabled until the org is known and the user is not already the owner.
 */
export function useHrAccess(): HrAccess {
  const supabase = useMemo(() => createClient(), []);
  const { data: userOrg, isLoading: orgLoading } = useUserOrg();
  const orgId = userOrg?.org.id;
  const isOwner = userOrg?.isOwner ?? false;

  const adminQuery = useQuery({
    queryKey: accessKey(orgId),
    enabled: Boolean(orgId) && !isOwner,
    queryFn: async (): Promise<boolean> => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) return false;

      const { data, error } = await supabase
        .from("hr_admins")
        .select("id")
        .eq("org_id", orgId as string)
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
  });

  const isHrAdmin = isOwner || (adminQuery.data ?? false);
  const isLoading =
    orgLoading || (Boolean(orgId) && !isOwner && adminQuery.isLoading);

  return { orgId, isHrAdmin, isLoading };
}

/* -------------------------------------------------------------------------- */
/* Employees                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Lists the org's employees with department, designation and manager embedded.
 * Disabled until the org is resolved; RLS scopes reads to the org's directory.
 */
export function useHrEmployees() {
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useHrAccess();

  return useQuery({
    queryKey: employeesKey(orgId),
    enabled: Boolean(orgId),
    queryFn: async (): Promise<HrEmployeeWithRelations[]> => {
      const { data, error } = await supabase
        .from("hr_employees")
        .select(EMPLOYEE_SELECT)
        .eq("org_id", orgId as string)
        .order("full_name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as HrEmployeeWithRelations[];
    },
  });
}

/** Loads a single employee with its department/designation/manager embedded. */
export function useHrEmployee(id: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: employeeKey(id),
    enabled: Boolean(id),
    queryFn: async (): Promise<HrEmployeeWithRelations | null> => {
      const { data, error } = await supabase
        .from("hr_employees")
        .select(EMPLOYEE_SELECT)
        .eq("id", id as string)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as HrEmployeeWithRelations | null;
    },
  });
}

/**
 * Creates an employee in the active org (HR admins only — RLS enforces this).
 * `org_id` is injected; `user_id` stays optional/null for record-only people.
 */
export function useCreateEmployee() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (
      input: CreateEmployeeInput,
    ): Promise<HrEmployeeWithRelations> => {
      if (!orgId) throw new Error("No organization");
      const { data, error } = await supabase
        .from("hr_employees")
        .insert({ ...input, org_id: orgId })
        .select(EMPLOYEE_SELECT)
        .single();
      if (error) throw error;
      return data as unknown as HrEmployeeWithRelations;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: employeesKey(orgId) });
    },
  });
}

/** Updates an employee by id (HR admins only via RLS). */
export function useUpdateEmployee() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (
      input: UpdateEmployeeInput,
    ): Promise<HrEmployeeWithRelations> => {
      const { data, error } = await supabase
        .from("hr_employees")
        .update(input.patch)
        .eq("id", input.id)
        .select(EMPLOYEE_SELECT)
        .single();
      if (error) throw error;
      return data as unknown as HrEmployeeWithRelations;
    },
    onSuccess: (employee) => {
      queryClient.invalidateQueries({ queryKey: employeesKey(orgId) });
      queryClient.invalidateQueries({ queryKey: employeeKey(employee.id) });
    },
  });
}

/** Deletes an employee by id (HR admins only via RLS). */
export function useDeleteEmployee() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from("hr_employees")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: employeesKey(orgId) });
      queryClient.invalidateQueries({ queryKey: employeeKey(id) });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Departments                                                                */
/* -------------------------------------------------------------------------- */

/** Lists the org's departments (alphabetical). Disabled until org resolved. */
export function useDepartments() {
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useHrAccess();

  return useQuery({
    queryKey: departmentsKey(orgId),
    enabled: Boolean(orgId),
    queryFn: async (): Promise<HrDepartmentRow[]> => {
      const { data, error } = await supabase
        .from("hr_departments")
        .select("*")
        .eq("org_id", orgId as string)
        .order("name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Creates a department in the active org (HR admins only via RLS). */
export function useCreateDepartment() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (
      input: CreateDepartmentInput,
    ): Promise<HrDepartmentRow> => {
      if (!orgId) throw new Error("No organization");
      const { data, error } = await supabase
        .from("hr_departments")
        .insert({ ...input, org_id: orgId })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: departmentsKey(orgId) });
    },
  });
}

/** Updates a department by id (HR admins only via RLS). */
export function useUpdateDepartment() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (
      input: UpdateDepartmentInput,
    ): Promise<HrDepartmentRow> => {
      const { data, error } = await supabase
        .from("hr_departments")
        .update(input.patch)
        .eq("id", input.id)
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: departmentsKey(orgId) });
    },
  });
}

/** Deletes a department by id (HR admins only via RLS). */
export function useDeleteDepartment() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from("hr_departments")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: departmentsKey(orgId) });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Designations                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Lists the org's designations ordered by level then title. Disabled until the
 * org is resolved.
 */
export function useDesignations() {
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useHrAccess();

  return useQuery({
    queryKey: designationsKey(orgId),
    enabled: Boolean(orgId),
    queryFn: async (): Promise<HrDesignationRow[]> => {
      const { data, error } = await supabase
        .from("hr_designations")
        .select("*")
        .eq("org_id", orgId as string)
        .order("level", { ascending: true })
        .order("title", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Creates a designation in the active org (HR admins only via RLS). */
export function useCreateDesignation() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (
      input: CreateDesignationInput,
    ): Promise<HrDesignationRow> => {
      if (!orgId) throw new Error("No organization");
      const { data, error } = await supabase
        .from("hr_designations")
        .insert({ ...input, org_id: orgId })
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: designationsKey(orgId) });
    },
  });
}

/** Deletes a designation by id (HR admins only via RLS). */
export function useDeleteDesignation() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from("hr_designations")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: designationsKey(orgId) });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* HR admins                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Lists the org's designated HR admins joined to the underlying user
 * (name/email). Disabled until the org is resolved.
 */
export function useHrAdmins() {
  const supabase = useMemo(() => createClient(), []);
  const { orgId } = useHrAccess();

  return useQuery({
    queryKey: adminsKey(orgId),
    enabled: Boolean(orgId),
    queryFn: async (): Promise<HrAdminWithUser[]> => {
      const { data, error } = await supabase
        .from("hr_admins")
        .select(
          "*, user:users!hr_admins_user_id_fk(id, name, email)",
        )
        .eq("org_id", orgId as string)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as HrAdminWithUser[];
    },
  });
}

/** Adds an HR admin to the active org (org owner only via RLS). */
export function useAddHrAdmin() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (input: AddHrAdminInput): Promise<HrAdminWithUser> => {
      if (!orgId) throw new Error("No organization");
      const { data, error } = await supabase
        .from("hr_admins")
        .insert({ org_id: orgId, user_id: input.userId })
        .select("*, user:users!hr_admins_user_id_fk(id, name, email)")
        .single();
      if (error) throw error;
      return data as unknown as HrAdminWithUser;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminsKey(orgId) });
      queryClient.invalidateQueries({ queryKey: accessKey(orgId) });
    },
  });
}

/** Removes an HR admin row by id (org owner only via RLS). */
export function useRemoveHrAdmin() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.from("hr_admins").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminsKey(orgId) });
      queryClient.invalidateQueries({ queryKey: accessKey(orgId) });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Employee documents                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Lists an employee's document metadata rows (newest first). RLS scopes reads
 * to documents in the caller's org. Disabled until an employee id is known.
 */
export function useEmployeeDocuments(employeeId: string | undefined) {
  const supabase = useMemo(() => createClient(), []);

  return useQuery({
    queryKey: documentsKey(employeeId),
    enabled: Boolean(employeeId),
    queryFn: async (): Promise<HrDocumentRow[]> => {
      const { data, error } = await supabase
        .from("hr_documents")
        .select("*")
        .eq("employee_id", employeeId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Uploads a file to the PRIVATE `hr-docs` bucket at
 * `<orgId>/<employeeId>/<name>-<timestamp>.<ext>` and records an `hr_documents`
 * metadata row. Rolls back the storage object if the metadata insert fails.
 * HR admins only (RLS enforces the write).
 */
export function useUploadEmployeeDocument() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const { orgId } = useHrAccess();

  return useMutation({
    mutationFn: async (
      input: UploadEmployeeDocumentInput,
    ): Promise<HrDocumentRow> => {
      if (!orgId) throw new Error("No organization");

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("Not authenticated");

      const { file, employeeId, docType } = input;

      // Unique storage path: keep the original name but suffix a timestamp so
      // repeated uploads of the same file never collide.
      const ext = fileExtension(file.name);
      const dot = file.name.lastIndexOf(".");
      const base = dot > 0 ? file.name.slice(0, dot) : file.name;
      const safeBase = base.replace(/[^a-zA-Z0-9._-]+/g, "_");
      const fileName = ext
        ? `${safeBase}-${Date.now()}.${ext}`
        : `${safeBase}-${Date.now()}`;
      const storagePath = `${orgId}/${employeeId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from(HR_DOCS_BUCKET)
        .upload(storagePath, file, {
          upsert: false,
          contentType: file.type || undefined,
        });
      if (uploadError) throw uploadError;

      const { data, error } = await supabase
        .from("hr_documents")
        .insert({
          employee_id: employeeId,
          org_id: orgId,
          doc_type: docType ?? null,
          name: file.name,
          storage_path: storagePath,
          uploaded_by: user.id,
        })
        .select("*")
        .single();

      if (error) {
        // Roll back the uploaded object if the metadata insert failed.
        await supabase.storage.from(HR_DOCS_BUCKET).remove([storagePath]);
        throw error;
      }

      return data;
    },
    onSuccess: (doc) => {
      queryClient.invalidateQueries({
        queryKey: documentsKey(doc.employee_id),
      });
    },
  });
}

/**
 * Deletes an employee document: removes the storage object then the metadata
 * row. HR admins only (RLS enforces the write).
 */
export function useDeleteEmployeeDocument() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (doc: HrDocumentRow): Promise<void> => {
      const { error: storageError } = await supabase.storage
        .from(HR_DOCS_BUCKET)
        .remove([doc.storage_path]);
      if (storageError) throw storageError;

      const { error } = await supabase
        .from("hr_documents")
        .delete()
        .eq("id", doc.id);
      if (error) throw error;
    },
    onSuccess: (_data, doc) => {
      queryClient.invalidateQueries({
        queryKey: documentsKey(doc.employee_id),
      });
    },
  });
}

/**
 * Returns a ~1h signed download URL for a private HR document storage path.
 * Standalone helper (not a hook) so it can be called on demand (e.g. on click).
 */
export async function getHrDocumentSignedUrl(
  storagePath: string,
): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(HR_DOCS_BUCKET)
    .createSignedUrl(storagePath, 60 * 60);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error("Failed to create signed URL");
  return data.signedUrl;
}
