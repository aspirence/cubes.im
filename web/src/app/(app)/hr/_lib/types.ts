/**
 * Local re-exports of the shared HR contract types (from src/features/hr) so the
 * pages here reference a single source of truth without redefining row shapes.
 */
export type {
  HrEmployeeRow,
  HrEmployeeWithRelations,
  HrDepartmentRow,
  HrDesignationRow,
  HrDocumentRow,
} from "@/features/hr/use-hr";
