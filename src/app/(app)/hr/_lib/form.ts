import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import type {
  CreateEmployeeInput,
  HrEmployeeRow,
  HrEmployeeWithRelations,
} from "@/features/hr/use-hr";

/** Form value shape for the employee create/edit forms. */
export interface EmployeeFormValues {
  full_name?: string;
  employee_code?: string | null;
  work_email?: string | null;
  department_id?: string | null;
  designation_id?: string | null;
  manager_id?: string | null;
  employment_type?: string | null;
  status?: string | null;
  work_location?: string | null;
  date_of_joining?: Dayjs | null;
  probation_end?: Dayjs | null;
  date_of_birth?: Dayjs | null;
  gender?: string | null;
  personal_email?: string | null;
  phone?: string | null;
  address?: string | null;
  emergency_contact?: string | null;
}

const DATE_FMT = "YYYY-MM-DD";

function trimOrNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const t = value.trim();
  return t.length === 0 ? null : t;
}

function dateOrNull(value: Dayjs | null | undefined): string | null {
  return value ? value.format(DATE_FMT) : null;
}

/**
 * Normalizes raw antd form values into a payload of plain DB columns. Empty
 * strings become null; Dayjs dates become YYYY-MM-DD strings. `employment_type`
 * / `status` are only included when chosen (they have non-null DB defaults).
 * `full_name` is included only when present so partial updates don't clobber it.
 *
 * The result is a `Partial` of the employee Insert/Update shape — usable as both
 * a `CreateEmployeeInput` (when `full_name` is set) and an update `patch`.
 */
export function toEmployeePayload(
  values: EmployeeFormValues,
): CreateEmployeeInput {
  const payload: CreateEmployeeInput = {
    full_name: trimOrNull(values.full_name) ?? "",
    employee_code: trimOrNull(values.employee_code),
    work_email: trimOrNull(values.work_email),
    department_id: values.department_id ?? null,
    designation_id: values.designation_id ?? null,
    manager_id: values.manager_id ?? null,
    work_location: trimOrNull(values.work_location),
    gender: values.gender ?? null,
    personal_email: trimOrNull(values.personal_email),
    phone: trimOrNull(values.phone),
    address: trimOrNull(values.address),
    emergency_contact: trimOrNull(values.emergency_contact),
    date_of_joining: dateOrNull(values.date_of_joining),
    probation_end: dateOrNull(values.probation_end),
    date_of_birth: dateOrNull(values.date_of_birth),
  };

  if (values.employment_type) payload.employment_type = values.employment_type;
  if (values.status) payload.status = values.status;

  return payload;
}

/**
 * Builds a partial update patch from form values. Unlike the create payload this
 * omits `full_name` when blank (so editing other fields never wipes the name).
 */
export function toEmployeePatch(
  values: EmployeeFormValues,
): CreateEmployeeInput {
  const payload = toEmployeePayload(values);
  if (!trimOrNull(values.full_name)) {
    delete (payload as { full_name?: string }).full_name;
  }
  return payload;
}

/** Maps an employee row back into antd form values (Dayjs for date pickers). */
export function employeeToFormValues(
  e: HrEmployeeRow | HrEmployeeWithRelations,
): EmployeeFormValues {
  return {
    full_name: e.full_name,
    employee_code: e.employee_code,
    work_email: e.work_email,
    department_id: e.department_id,
    designation_id: e.designation_id,
    manager_id: e.manager_id,
    employment_type: e.employment_type,
    status: e.status,
    work_location: e.work_location,
    gender: e.gender,
    personal_email: e.personal_email,
    phone: e.phone,
    address: e.address,
    emergency_contact: e.emergency_contact,
    date_of_joining: e.date_of_joining ? dayjs(e.date_of_joining) : null,
    probation_end: e.probation_end ? dayjs(e.probation_end) : null,
    date_of_birth: e.date_of_birth ? dayjs(e.date_of_birth) : null,
  };
}
