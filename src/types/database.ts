export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      agents: {
        Row: {
          created_at: string
          created_by: string | null
          data_scope: Json
          description: string | null
          emoji: string | null
          id: string
          name: string
          skills: Json
          team_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data_scope?: Json
          description?: string | null
          emoji?: string | null
          id?: string
          name: string
          skills?: Json
          team_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data_scope?: Json
          description?: string | null
          emoji?: string | null
          id?: string
          name?: string
          skills?: Json
          team_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      early_access_requests: {
        Row: {
          amount_cents: number
          company: string | null
          created_at: string
          email: string
          id: string
          name: string
          note: string | null
          paid_at: string | null
          payment_status: string
          provider: string | null
          provider_payment_id: string | null
          team_size: string | null
        }
        Insert: {
          amount_cents?: number
          company?: string | null
          created_at?: string
          email: string
          id?: string
          name: string
          note?: string | null
          paid_at?: string | null
          payment_status?: string
          provider?: string | null
          provider_payment_id?: string | null
          team_size?: string | null
        }
        Update: {
          amount_cents?: number
          company?: string | null
          created_at?: string
          email?: string
          id?: string
          name?: string
          note?: string | null
          paid_at?: string | null
          payment_status?: string
          provider?: string | null
          provider_payment_id?: string | null
          team_size?: string | null
        }
        Relationships: []
      }
      workflows: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          enabled: boolean
          id: string
          last_run_at: string | null
          name: string
          next_run_at: string | null
          prompt: string | null
          run_count: number
          team_id: string
          trigger_config: Json
          trigger_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          enabled?: boolean
          id?: string
          last_run_at?: string | null
          name: string
          next_run_at?: string | null
          prompt?: string | null
          run_count?: number
          team_id: string
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          enabled?: boolean
          id?: string
          last_run_at?: string | null
          name?: string
          next_run_at?: string | null
          prompt?: string | null
          run_count?: number
          team_id?: string
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      workflow_steps: {
        Row: {
          config: Json
          created_at: string
          enabled: boolean
          id: string
          position: number
          step_key: string
          step_type: string
          updated_at: string
          workflow_id: string
        }
        Insert: {
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          position: number
          step_key: string
          step_type: string
          updated_at?: string
          workflow_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          position?: number
          step_key?: string
          step_type?: string
          updated_at?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_steps_workflow_id_fk"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_runs: {
        Row: {
          context: Json
          current_position: number
          error: string | null
          finished_at: string | null
          id: string
          started_at: string
          status: string
          team_id: string
          trigger_snapshot: Json
          workflow_id: string
        }
        Insert: {
          context?: Json
          current_position?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
          team_id: string
          trigger_snapshot?: Json
          workflow_id: string
        }
        Update: {
          context?: Json
          current_position?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
          team_id?: string
          trigger_snapshot?: Json
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_runs_workflow_id_fk"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_step_runs: {
        Row: {
          error: string | null
          finished_at: string | null
          id: string
          input: Json
          output: Json
          run_id: string
          started_at: string
          status: string
          step_id: string | null
          step_key: string
          step_type: string
        }
        Insert: {
          error?: string | null
          finished_at?: string | null
          id?: string
          input?: Json
          output?: Json
          run_id: string
          started_at?: string
          status?: string
          step_id?: string | null
          step_key: string
          step_type: string
        }
        Update: {
          error?: string | null
          finished_at?: string | null
          id?: string
          input?: Json
          output?: Json
          run_id?: string
          started_at?: string
          status?: string
          step_id?: string | null
          step_key?: string
          step_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_step_runs_run_id_fk"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "workflow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      installed_apps: {
        Row: {
          app_key: string
          config: Json
          created_at: string
          enabled: boolean
          id: string
          installed_by: string | null
          team_id: string
          updated_at: string
        }
        Insert: {
          app_key: string
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          installed_by?: string | null
          team_id: string
          updated_at?: string
        }
        Update: {
          app_key?: string
          config?: Json
          created_at?: string
          enabled?: boolean
          id?: string
          installed_by?: string | null
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "installed_apps_team_id_fk"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      app_connection_secrets: {
        Row: {
          connection_id: string
          credentials: Json
          updated_at: string
        }
        Insert: {
          connection_id: string
          credentials?: Json
          updated_at?: string
        }
        Update: {
          connection_id?: string
          credentials?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_connection_secrets_connection_id_fk"
            columns: ["connection_id"]
            isOneToOne: true
            referencedRelation: "app_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      app_connections: {
        Row: {
          config: Json
          created_at: string
          created_by: string | null
          enabled: boolean
          id: string
          last_test_error: string | null
          last_test_status: string | null
          last_tested_at: string | null
          name: string
          org_id: string
          provider: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          last_test_error?: string | null
          last_test_status?: string | null
          last_tested_at?: string | null
          name: string
          org_id: string
          provider: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          last_test_error?: string | null
          last_test_status?: string | null
          last_tested_at?: string | null
          name?: string
          org_id?: string
          provider?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_connections_created_by_fk"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_connections_org_id_fk"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      archived_projects: {
        Row: {
          created_at: string
          id: string
          project_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "archived_projects_project_id_fk"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "archived_projects_user_id_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_runs: {
        Row: {
          automation_id: string
          created_at: string
          detail: string | null
          id: string
          status: string
          task_id: string | null
        }
        Insert: {
          automation_id: string
          created_at?: string
          detail?: string | null
          id?: string
          status?: string
          task_id?: string | null
        }
        Update: {
          automation_id?: string
          created_at?: string
          detail?: string | null
          id?: string
          status?: string
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_runs_automation_id_fk"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_runs_task_id_fk"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      automations: {
        Row: {
          action_config: Json
          action_type: string
          created_at: string
          created_by: string | null
          enabled: boolean
          id: string
          last_run_at: string | null
          name: string
          project_id: string
          run_count: number
          trigger_config: Json
          trigger_type: string
          updated_at: string
        }
        Insert: {
          action_config?: Json
          action_type: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          last_run_at?: string | null
          name: string
          project_id: string
          run_count?: number
          trigger_config?: Json
          trigger_type: string
          updated_at?: string
        }
        Update: {
          action_config?: Json
          action_type?: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          last_run_at?: string | null
          name?: string
          project_id?: string
          run_count?: number
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automations_created_by_fk"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automations_project_id_fk"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          created_at: string
          id: string
          name: string
          team_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          team_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_team_id_fk"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      countries: {
        Row: {
          code: string
          currency: string | null
          id: string
          name: string
          phone: number
        }
        Insert: {
          code: string
          currency?: string | null
          id?: string
          name: string
          phone: number
        }
        Update: {
          code?: string
          currency?: string | null
          id?: string
          name?: string
          phone?: number
        }
        Relationships: []
      }
      email_invitations: {
        Row: {
          created_at: string
          email: string
          id: string
          name: string
          role_id: string | null
          team_id: string
          team_member_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          name: string
          role_id?: string | null
          team_id: string
          team_member_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          name?: string
          role_id?: string | null
          team_id?: string
          team_member_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_invitations_role_id_fk"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_invitations_team_id_fk"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_invitations_team_member_id_fk"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      favorite_projects: {
        Row: {
          project_id: string
          user_id: string
        }
        Insert: {
          project_id: string
          user_id: string
        }
        Update: {
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorite_projects_project_id_fk"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorite_projects_user_id_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_admins: {
        Row: {
          created_at: string
          id: string
          org_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_admins_org_id_fk"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_admins_user_id_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_attendance: {
        Row: {
          clock_in: string | null
          clock_out: string | null
          created_at: string
          date: string
          employee_id: string
          id: string
          notes: string | null
          org_id: string
          source: string
          status: string
          updated_at: string
          work_minutes: number | null
        }
        Insert: {
          clock_in?: string | null
          clock_out?: string | null
          created_at?: string
          date: string
          employee_id: string
          id?: string
          notes?: string | null
          org_id: string
          source?: string
          status?: string
          updated_at?: string
          work_minutes?: number | null
        }
        Update: {
          clock_in?: string | null
          clock_out?: string | null
          created_at?: string
          date?: string
          employee_id?: string
          id?: string
          notes?: string | null
          org_id?: string
          source?: string
          status?: string
          updated_at?: string
          work_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "hr_attendance_employee_id_fk"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_attendance_org_id_fk"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_attendance_regularizations: {
        Row: {
          approver_id: string | null
          created_at: string
          date: string
          decided_at: string | null
          employee_id: string
          id: string
          org_id: string
          reason: string | null
          requested_in: string | null
          requested_out: string | null
          status: string
        }
        Insert: {
          approver_id?: string | null
          created_at?: string
          date: string
          decided_at?: string | null
          employee_id: string
          id?: string
          org_id: string
          reason?: string | null
          requested_in?: string | null
          requested_out?: string | null
          status?: string
        }
        Update: {
          approver_id?: string | null
          created_at?: string
          date?: string
          decided_at?: string | null
          employee_id?: string
          id?: string
          org_id?: string
          reason?: string | null
          requested_in?: string | null
          requested_out?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_attendance_regularizations_approver_id_fk"
            columns: ["approver_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_attendance_regularizations_employee_id_fk"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_attendance_regularizations_org_id_fk"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_bank_details: {
        Row: {
          account_name: string | null
          account_number: string | null
          bank_name: string | null
          created_at: string
          employee_id: string
          id: string
          ifsc: string | null
          org_id: string
          updated_at: string
        }
        Insert: {
          account_name?: string | null
          account_number?: string | null
          bank_name?: string | null
          created_at?: string
          employee_id: string
          id?: string
          ifsc?: string | null
          org_id: string
          updated_at?: string
        }
        Update: {
          account_name?: string | null
          account_number?: string | null
          bank_name?: string | null
          created_at?: string
          employee_id?: string
          id?: string
          ifsc?: string | null
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_bank_details_employee_id_fk"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_bank_details_org_id_fk"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_departments: {
        Row: {
          created_at: string
          head_user_id: string | null
          id: string
          name: string
          org_id: string
        }
        Insert: {
          created_at?: string
          head_user_id?: string | null
          id?: string
          name: string
          org_id: string
        }
        Update: {
          created_at?: string
          head_user_id?: string | null
          id?: string
          name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_departments_head_user_id_fk"
            columns: ["head_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_departments_org_id_fk"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_designations: {
        Row: {
          created_at: string
          id: string
          level: number
          org_id: string
          title: string
        }
        Insert: {
          created_at?: string
          id?: string
          level?: number
          org_id: string
          title: string
        }
        Update: {
          created_at?: string
          id?: string
          level?: number
          org_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_designations_org_id_fk"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_documents: {
        Row: {
          created_at: string
          doc_type: string | null
          employee_id: string
          id: string
          name: string
          org_id: string
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          doc_type?: string | null
          employee_id: string
          id?: string
          name: string
          org_id: string
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          doc_type?: string | null
          employee_id?: string
          id?: string
          name?: string
          org_id?: string
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hr_documents_employee_id_fk"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_documents_org_id_fk"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_documents_uploaded_by_fk"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_generated_documents: {
        Row: {
          created_at: string
          document_type: string
          employee_id: string
          generated_by: string | null
          id: string
          merge_payload: Json
          merged_html: string
          merged_text: string
          org_id: string
          status: string
          template_body_template: string
          template_id: string | null
          template_name: string
          template_title_template: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          document_type: string
          employee_id: string
          generated_by?: string | null
          id?: string
          merge_payload?: Json
          merged_html: string
          merged_text: string
          org_id: string
          status?: string
          template_body_template: string
          template_id?: string | null
          template_name: string
          template_title_template: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          document_type?: string
          employee_id?: string
          generated_by?: string | null
          id?: string
          merge_payload?: Json
          merged_html?: string
          merged_text?: string
          org_id?: string
          status?: string
          template_body_template?: string
          template_id?: string | null
          template_name?: string
          template_title_template?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_generated_documents_employee_id_fk"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_generated_documents_generated_by_fk"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_generated_documents_org_id_fk"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_generated_documents_template_id_fk"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "hr_letter_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_employee_shifts: {
        Row: {
          created_at: string
          effective_from: string
          employee_id: string
          id: string
          org_id: string
          shift_id: string | null
        }
        Insert: {
          created_at?: string
          effective_from?: string
          employee_id: string
          id?: string
          org_id: string
          shift_id?: string | null
        }
        Update: {
          created_at?: string
          effective_from?: string
          employee_id?: string
          id?: string
          org_id?: string
          shift_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hr_employee_shifts_employee_id_fk"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_employee_shifts_org_id_fk"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_employee_shifts_shift_id_fk"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "hr_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_employees: {
        Row: {
          address: string | null
          created_at: string
          date_of_birth: string | null
          date_of_joining: string | null
          department_id: string | null
          designation_id: string | null
          emergency_contact: string | null
          employee_code: string | null
          employment_type: string
          full_name: string
          gender: string | null
          id: string
          manager_id: string | null
          org_id: string
          personal_email: string | null
          phone: string | null
          probation_end: string | null
          status: string
          updated_at: string
          user_id: string | null
          work_email: string | null
          work_location: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          date_of_birth?: string | null
          date_of_joining?: string | null
          department_id?: string | null
          designation_id?: string | null
          emergency_contact?: string | null
          employee_code?: string | null
          employment_type?: string
          full_name: string
          gender?: string | null
          id?: string
          manager_id?: string | null
          org_id: string
          personal_email?: string | null
          phone?: string | null
          probation_end?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
          work_email?: string | null
          work_location?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string
          date_of_birth?: string | null
          date_of_joining?: string | null
          department_id?: string | null
          designation_id?: string | null
          emergency_contact?: string | null
          employee_code?: string | null
          employment_type?: string
          full_name?: string
          gender?: string | null
          id?: string
          manager_id?: string | null
          org_id?: string
          personal_email?: string | null
          phone?: string | null
          probation_end?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
          work_email?: string | null
          work_location?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hr_employees_department_id_fk"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "hr_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_employees_designation_id_fk"
            columns: ["designation_id"]
            isOneToOne: false
            referencedRelation: "hr_designations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_employees_manager_id_fk"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_employees_org_id_fk"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_employees_user_id_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_holidays: {
        Row: {
          created_at: string
          date: string
          id: string
          name: string
          optional: boolean
          org_id: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          name: string
          optional?: boolean
          org_id: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          name?: string
          optional?: boolean
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_holidays_org_id_fk"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_leave_balances: {
        Row: {
          allotted: number
          carried_forward: number
          employee_id: string
          id: string
          leave_type_id: string
          org_id: string
          pending: number
          used: number
          year: number
        }
        Insert: {
          allotted?: number
          carried_forward?: number
          employee_id: string
          id?: string
          leave_type_id: string
          org_id: string
          pending?: number
          used?: number
          year: number
        }
        Update: {
          allotted?: number
          carried_forward?: number
          employee_id?: string
          id?: string
          leave_type_id?: string
          org_id?: string
          pending?: number
          used?: number
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "hr_leave_balances_employee_id_fk"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_leave_balances_leave_type_id_fk"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "hr_leave_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_leave_balances_org_id_fk"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_leave_requests: {
        Row: {
          approver_id: string | null
          created_at: string
          days: number
          decided_at: string | null
          employee_id: string
          from_date: string
          id: string
          leave_type_id: string
          note: string | null
          org_id: string
          reason: string | null
          status: string
          to_date: string
        }
        Insert: {
          approver_id?: string | null
          created_at?: string
          days: number
          decided_at?: string | null
          employee_id: string
          from_date: string
          id?: string
          leave_type_id: string
          note?: string | null
          org_id: string
          reason?: string | null
          status?: string
          to_date: string
        }
        Update: {
          approver_id?: string | null
          created_at?: string
          days?: number
          decided_at?: string | null
          employee_id?: string
          from_date?: string
          id?: string
          leave_type_id?: string
          note?: string | null
          org_id?: string
          reason?: string | null
          status?: string
          to_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_leave_requests_approver_id_fk"
            columns: ["approver_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_leave_requests_employee_id_fk"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_leave_requests_leave_type_id_fk"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "hr_leave_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_leave_requests_org_id_fk"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_leave_types: {
        Row: {
          accrual: string
          annual_quota: number
          carry_forward: boolean
          code: string
          color: string | null
          created_at: string
          id: string
          max_carry_forward: number
          name: string
          org_id: string
          paid: boolean
        }
        Insert: {
          accrual?: string
          annual_quota?: number
          carry_forward?: boolean
          code: string
          color?: string | null
          created_at?: string
          id?: string
          max_carry_forward?: number
          name: string
          org_id: string
          paid?: boolean
        }
        Update: {
          accrual?: string
          annual_quota?: number
          carry_forward?: boolean
          code?: string
          color?: string | null
          created_at?: string
          id?: string
          max_carry_forward?: number
          name?: string
          org_id?: string
          paid?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "hr_leave_types_org_id_fk"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_letter_templates: {
        Row: {
          body_template: string
          created_at: string
          created_by: string | null
          document_type: string
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          org_id: string
          sort_order: number
          title_template: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          body_template: string
          created_at?: string
          created_by?: string | null
          document_type: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          org_id: string
          sort_order?: number
          title_template: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          body_template?: string
          created_at?: string
          created_by?: string | null
          document_type?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          org_id?: string
          sort_order?: number
          title_template?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hr_letter_templates_created_by_fk"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_letter_templates_org_id_fk"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_letter_templates_updated_by_fk"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_loans_advances: {
        Row: {
          balance: number
          created_at: string
          emi: number
          employee_id: string
          id: string
          org_id: string
          principal: number
          status: string
          type: string
        }
        Insert: {
          balance?: number
          created_at?: string
          emi?: number
          employee_id: string
          id?: string
          org_id: string
          principal?: number
          status?: string
          type?: string
        }
        Update: {
          balance?: number
          created_at?: string
          emi?: number
          employee_id?: string
          id?: string
          org_id?: string
          principal?: number
          status?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_loans_advances_employee_id_fk"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_loans_advances_org_id_fk"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_onboarding_tasks: {
        Row: {
          assignee_id: string | null
          completed_at: string | null
          created_at: string
          due_date: string | null
          employee_id: string
          id: string
          kind: string
          org_id: string
          sort_order: number
          status: string
          title: string
        }
        Insert: {
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          employee_id: string
          id?: string
          kind?: string
          org_id: string
          sort_order?: number
          status?: string
          title: string
        }
        Update: {
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          employee_id?: string
          id?: string
          kind?: string
          org_id?: string
          sort_order?: number
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_onboarding_tasks_assignee_id_fk"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_onboarding_tasks_employee_id_fk"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_onboarding_tasks_org_id_fk"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_payroll_runs: {
        Row: {
          employee_count: number
          id: string
          org_id: string
          period_month: number
          period_year: number
          run_at: string
          run_by: string | null
          status: string
          total_deductions: number
          total_gross: number
          total_net: number
        }
        Insert: {
          employee_count?: number
          id?: string
          org_id: string
          period_month: number
          period_year: number
          run_at?: string
          run_by?: string | null
          status?: string
          total_deductions?: number
          total_gross?: number
          total_net?: number
        }
        Update: {
          employee_count?: number
          id?: string
          org_id?: string
          period_month?: number
          period_year?: number
          run_at?: string
          run_by?: string | null
          status?: string
          total_deductions?: number
          total_gross?: number
          total_net?: number
        }
        Relationships: [
          {
            foreignKeyName: "hr_payroll_runs_org_id_fk"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_payroll_runs_run_by_fk"
            columns: ["run_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_payslips: {
        Row: {
          created_at: string
          deductions: Json
          earnings: Json
          employee_id: string
          gross: number
          id: string
          lop_days: number
          net: number
          org_id: string
          paid_days: number
          payroll_run_id: string
          total_deductions: number
          working_days: number
        }
        Insert: {
          created_at?: string
          deductions?: Json
          earnings?: Json
          employee_id: string
          gross?: number
          id?: string
          lop_days?: number
          net?: number
          org_id: string
          paid_days?: number
          payroll_run_id: string
          total_deductions?: number
          working_days?: number
        }
        Update: {
          created_at?: string
          deductions?: Json
          earnings?: Json
          employee_id?: string
          gross?: number
          id?: string
          lop_days?: number
          net?: number
          org_id?: string
          paid_days?: number
          payroll_run_id?: string
          total_deductions?: number
          working_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "hr_payslips_employee_id_fk"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_payslips_org_id_fk"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_payslips_payroll_run_id_fk"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "hr_payroll_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_reimbursements: {
        Row: {
          amount: number
          approver_id: string | null
          category: string | null
          created_at: string
          date: string
          decided_at: string | null
          employee_id: string
          id: string
          org_id: string
          receipt_path: string | null
          status: string
        }
        Insert: {
          amount: number
          approver_id?: string | null
          category?: string | null
          created_at?: string
          date?: string
          decided_at?: string | null
          employee_id: string
          id?: string
          org_id: string
          receipt_path?: string | null
          status?: string
        }
        Update: {
          amount?: number
          approver_id?: string | null
          category?: string | null
          created_at?: string
          date?: string
          decided_at?: string | null
          employee_id?: string
          id?: string
          org_id?: string
          receipt_path?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_reimbursements_approver_id_fk"
            columns: ["approver_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_reimbursements_employee_id_fk"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_reimbursements_org_id_fk"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_salary_components: {
        Row: {
          calc: string
          employee_id: string
          id: string
          is_basic: boolean
          kind: string
          name: string
          org_id: string
          sort_order: number
          structure_id: string
          value: number
        }
        Insert: {
          calc?: string
          employee_id: string
          id?: string
          is_basic?: boolean
          kind: string
          name: string
          org_id: string
          sort_order?: number
          structure_id: string
          value?: number
        }
        Update: {
          calc?: string
          employee_id?: string
          id?: string
          is_basic?: boolean
          kind?: string
          name?: string
          org_id?: string
          sort_order?: number
          structure_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "hr_salary_components_employee_id_fk"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_salary_components_org_id_fk"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_salary_components_structure_id_fk"
            columns: ["structure_id"]
            isOneToOne: false
            referencedRelation: "hr_salary_structures"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_salary_structures: {
        Row: {
          created_at: string
          ctc: number
          currency: string
          effective_from: string
          employee_id: string
          id: string
          org_id: string
        }
        Insert: {
          created_at?: string
          ctc: number
          currency?: string
          effective_from?: string
          employee_id: string
          id?: string
          org_id: string
        }
        Update: {
          created_at?: string
          ctc?: number
          currency?: string
          effective_from?: string
          employee_id?: string
          id?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_salary_structures_employee_id_fk"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "hr_employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_salary_structures_org_id_fk"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_shifts: {
        Row: {
          break_minutes: number
          created_at: string
          end_time: string | null
          id: string
          is_default: boolean
          name: string
          org_id: string
          start_time: string | null
          working_days: number[]
        }
        Insert: {
          break_minutes?: number
          created_at?: string
          end_time?: string | null
          id?: string
          is_default?: boolean
          name: string
          org_id: string
          start_time?: string | null
          working_days?: number[]
        }
        Update: {
          break_minutes?: number
          created_at?: string
          end_time?: string | null
          id?: string
          is_default?: boolean
          name?: string
          org_id?: string
          start_time?: string | null
          working_days?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "hr_shifts_org_id_fk"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      job_titles: {
        Row: {
          id: string
          name: string
          team_id: string
        }
        Insert: {
          id?: string
          name: string
          team_id: string
        }
        Update: {
          id?: string
          name?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_titles_team_id_fk"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_tokens: {
        Row: {
          created_at: string
          id: string
          last_used_at: string | null
          name: string
          revoked: boolean
          team_id: string
          token_hash: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_used_at?: string | null
          name: string
          revoked?: boolean
          team_id: string
          token_hash: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_used_at?: string | null
          name?: string
          revoked?: boolean
          team_id?: string
          token_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_tokens_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mcp_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_settings: {
        Row: {
          created_at: string
          daily_digest_enabled: boolean
          email_notifications_enabled: boolean
          id: string
          muted_types: string[]
          popup_notifications_enabled: boolean
          team_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          daily_digest_enabled?: boolean
          email_notifications_enabled?: boolean
          id?: string
          muted_types?: string[]
          popup_notifications_enabled?: boolean
          team_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          daily_digest_enabled?: boolean
          email_notifications_enabled?: boolean
          id?: string
          muted_types?: string[]
          popup_notifications_enabled?: boolean
          team_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_settings_team_id_fk"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_settings_user_id_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_working_days: {
        Row: {
          created_at: string
          friday: boolean
          id: string
          monday: boolean
          organization_id: string
          saturday: boolean
          sunday: boolean
          thursday: boolean
          tuesday: boolean
          updated_at: string
          wednesday: boolean
        }
        Insert: {
          created_at?: string
          friday?: boolean
          id?: string
          monday?: boolean
          organization_id: string
          saturday?: boolean
          sunday?: boolean
          thursday?: boolean
          tuesday?: boolean
          updated_at?: string
          wednesday?: boolean
        }
        Update: {
          created_at?: string
          friday?: boolean
          id?: string
          monday?: boolean
          organization_id?: string
          saturday?: boolean
          sunday?: boolean
          thursday?: boolean
          tuesday?: boolean
          updated_at?: string
          wednesday?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "org_working_days_organization_id_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address_line_1: string | null
          address_line_2: string | null
          city: string | null
          contact_number: string | null
          contact_number_secondary: string | null
          country: string | null
          created_at: string | null
          id: string
          is_lkr_billing: boolean | null
          license_type_id: string | null
          organization_name: string
          postal_code: string | null
          state: string | null
          storage: number
          subscription_status: string
          trial_expire_date: string | null
          trial_in_progress: boolean
          updated_at: string | null
          updating_plan: boolean | null
          user_id: string
          working_hours: number
        }
        Insert: {
          address_line_1?: string | null
          address_line_2?: string | null
          city?: string | null
          contact_number?: string | null
          contact_number_secondary?: string | null
          country?: string | null
          created_at?: string | null
          id?: string
          is_lkr_billing?: boolean | null
          license_type_id?: string | null
          organization_name: string
          postal_code?: string | null
          state?: string | null
          storage?: number
          subscription_status?: string
          trial_expire_date?: string | null
          trial_in_progress?: boolean
          updated_at?: string | null
          updating_plan?: boolean | null
          user_id: string
          working_hours?: number
        }
        Update: {
          address_line_1?: string | null
          address_line_2?: string | null
          city?: string | null
          contact_number?: string | null
          contact_number_secondary?: string | null
          country?: string | null
          created_at?: string | null
          id?: string
          is_lkr_billing?: boolean | null
          license_type_id?: string | null
          organization_name?: string
          postal_code?: string | null
          state?: string | null
          storage?: number
          subscription_status?: string
          trial_expire_date?: string | null
          trial_in_progress?: boolean
          updated_at?: string | null
          updating_plan?: boolean | null
          user_id?: string
          working_hours?: number
        }
        Relationships: [
          {
            foreignKeyName: "organizations_country_fk"
            columns: ["country"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_user_id_fk"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          description: string
          id: string
          name: string
        }
        Insert: {
          description: string
          id: string
          name: string
        }
        Update: {
          description?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      personal_todo_list: {
        Row: {
          color_code: string | null
          created_at: string
          description: string | null
          done: boolean
          id: string
          index: number
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          color_code?: string | null
          created_at?: string
          description?: string | null
          done?: boolean
          id?: string
          index?: number
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          color_code?: string | null
          created_at?: string
          description?: string | null
          done?: boolean
          id?: string
          index?: number
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "personal_todo_list_user_id_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      project_access_levels: {
        Row: {
          id: string
          key: string
          name: string
        }
        Insert: {
          id?: string
          key: string
          name: string
        }
        Update: {
          id?: string
          key?: string
          name?: string
        }
        Relationships: []
      }
      project_categories: {
        Row: {
          color_code: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          team_id: string
          updated_at: string
        }
        Insert: {
          color_code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          team_id: string
          updated_at?: string
        }
        Update: {
          color_code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_categories_created_by_fk"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_categories_team_id_fk"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      project_comments: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          id: string
          mentions: string[]
          project_id: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          mentions?: string[]
          project_id: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          mentions?: string[]
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_comments_created_by_fk"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_comments_project_id_fk"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_folders: {
        Row: {
          color_code: string
          created_at: string
          created_by: string | null
          id: string
          key: string | null
          name: string
          parent_folder_id: string | null
          team_id: string
          updated_at: string
        }
        Insert: {
          color_code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          key?: string | null
          name: string
          parent_folder_id?: string | null
          team_id: string
          updated_at?: string
        }
        Update: {
          color_code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          key?: string | null
          name?: string
          parent_folder_id?: string | null
          team_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_folders_created_by_fk"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_folders_parent_folder_fk"
            columns: ["parent_folder_id"]
            isOneToOne: false
            referencedRelation: "project_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_folders_team_id_fk"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      project_member_allocations: {
        Row: {
          allocated_from: string
          allocated_to: string
          created_at: string
          id: string
          project_id: string
          seconds_per_day: number
          team_member_id: string
        }
        Insert: {
          allocated_from: string
          allocated_to: string
          created_at?: string
          id?: string
          project_id: string
          seconds_per_day?: number
          team_member_id: string
        }
        Update: {
          allocated_from?: string
          allocated_to?: string
          created_at?: string
          id?: string
          project_id?: string
          seconds_per_day?: number
          team_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_member_allocations_project_id_fk"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_member_allocations_team_member_id_fk"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      project_members: {
        Row: {
          created_at: string
          default_view: string
          id: string
          project_access_level_id: string | null
          project_id: string
          role_id: string | null
          team_member_id: string
        }
        Insert: {
          created_at?: string
          default_view?: string
          id?: string
          project_access_level_id?: string | null
          project_id: string
          role_id?: string | null
          team_member_id: string
        }
        Update: {
          created_at?: string
          default_view?: string
          id?: string
          project_access_level_id?: string | null
          project_id?: string
          role_id?: string | null
          team_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_access_level_fk"
            columns: ["project_access_level_id"]
            isOneToOne: false
            referencedRelation: "project_access_levels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_project_id_fk"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_role_id_fk"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_team_member_id_fk"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      project_phases: {
        Row: {
          color_code: string
          created_at: string
          end_date: string | null
          id: string
          name: string
          project_id: string
          sort_index: number
          start_date: string | null
        }
        Insert: {
          color_code: string
          created_at?: string
          end_date?: string | null
          id?: string
          name: string
          project_id: string
          sort_index?: number
          start_date?: string | null
        }
        Update: {
          color_code?: string
          created_at?: string
          end_date?: string | null
          id?: string
          name?: string
          project_id?: string
          sort_index?: number
          start_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_phases_project_id_fk"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_subscribers: {
        Row: {
          created_at: string
          id: string
          project_id: string
          team_member_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          team_member_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          team_member_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_subscribers_project_id_fk"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_subscribers_team_member_id_fk"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_subscribers_user_id_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      project_views: {
        Row: {
          config: Json
          created_at: string
          id: string
          name: string | null
          position: number
          project_id: string
          view_key: string
        }
        Insert: {
          config?: Json
          created_at?: string
          id?: string
          name?: string | null
          position?: number
          project_id: string
          view_key: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          name?: string | null
          position?: number
          project_id?: string
          view_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_views_project_id_fk"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_templates: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          team_id: string
          template: Json
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          team_id: string
          template?: Json
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          team_id?: string
          template?: Json
        }
        Relationships: [
          {
            foreignKeyName: "project_templates_created_by_fk"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_templates_team_id_fk"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      status_templates: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          statuses: Json
          team_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          statuses?: Json
          team_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          statuses?: Json
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "status_templates_created_by_fk"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "status_templates_team_id_fk"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      user_dashboards: {
        Row: {
          layout: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          layout?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          layout?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_dashboards_user_id_fk"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      app_video_review_videos: {
        Row: {
          created_at: string
          created_by: string | null
          deleted: boolean
          editor_id: string | null
          folder: string | null
          folder_id: string | null
          id: string
          latest_revision: number
          project_id: string | null
          stage: string
          status: string
          task_id: string | null
          team_id: string
          title: string
          updated_at: string
          workflow_template_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted?: boolean
          editor_id?: string | null
          folder?: string | null
          folder_id?: string | null
          id?: string
          latest_revision?: number
          project_id?: string | null
          stage?: string
          status?: string
          task_id?: string | null
          team_id: string
          title: string
          updated_at?: string
          workflow_template_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted?: boolean
          editor_id?: string | null
          folder?: string | null
          folder_id?: string | null
          id?: string
          latest_revision?: number
          project_id?: string | null
          stage?: string
          status?: string
          task_id?: string | null
          team_id?: string
          title?: string
          updated_at?: string
          workflow_template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_video_review_videos_project_fk"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_video_review_videos_team_fk"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_video_review_videos_task_fk"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      app_video_review_revisions: {
        Row: {
          id: string
          revision: number
          storage_path: string | null
          summary: string | null
          uploaded_at: string
          uploaded_by: string | null
          url: string | null
          video_id: string
        }
        Insert: {
          id?: string
          revision: number
          storage_path?: string | null
          summary?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
          url?: string | null
          video_id: string
        }
        Update: {
          id?: string
          revision?: number
          storage_path?: string | null
          summary?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
          url?: string | null
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_video_review_revisions_video_fk"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "app_video_review_videos"
            referencedColumns: ["id"]
          },
        ]
      }
      app_video_review_comments: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          drawing: Json | null
          id: string
          resolved: boolean
          revision: number
          time_ms: number
          video_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          drawing?: Json | null
          id?: string
          resolved?: boolean
          revision?: number
          time_ms?: number
          video_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          drawing?: Json | null
          id?: string
          resolved?: boolean
          revision?: number
          time_ms?: number
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_video_review_comments_video_fk"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "app_video_review_videos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_video_review_comments_author_fk"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      app_client_portal_portals: {
        Row: {
          accent: string
          client_id: string
          created_at: string
          created_by: string | null
          id: string
          intro: string | null
          share_token: string
          show_progress: boolean
          show_tasks: boolean
          status: string
          team_id: string
          title: string
          updated_at: string
        }
        Insert: {
          accent?: string
          client_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          intro?: string | null
          share_token?: string
          show_progress?: boolean
          show_tasks?: boolean
          status?: string
          team_id: string
          title: string
          updated_at?: string
        }
        Update: {
          accent?: string
          client_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          intro?: string | null
          share_token?: string
          show_progress?: boolean
          show_tasks?: boolean
          status?: string
          team_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_client_portal_portals_team_fk"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_client_portal_portals_client_fk"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_client_portal_portals_created_by_fk"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      app_client_portal_projects: {
        Row: {
          created_at: string
          id: string
          portal_id: string
          project_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          portal_id: string
          project_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          portal_id?: string
          project_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "app_client_portal_projects_portal_fk"
            columns: ["portal_id"]
            isOneToOne: false
            referencedRelation: "app_client_portal_portals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_client_portal_projects_project_fk"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      app_client_portal_updates: {
        Row: {
          body: string | null
          created_at: string
          created_by: string | null
          id: string
          portal_id: string
          title: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          portal_id: string
          title: string
        }
        Update: {
          body?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          portal_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_client_portal_updates_portal_fk"
            columns: ["portal_id"]
            isOneToOne: false
            referencedRelation: "app_client_portal_portals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_client_portal_updates_created_by_fk"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      app_docs_docs: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          project_id: string
          sort_order: number
          team_id: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          project_id: string
          sort_order?: number
          team_id: string
          title?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          project_id?: string
          sort_order?: number
          team_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_docs_docs_project_fk"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_docs_docs_created_by_fk"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      app_docs_pages: {
        Row: {
          content: Json
          created_at: string
          created_by: string | null
          doc_id: string
          icon: string | null
          id: string
          is_private: boolean
          parent_id: string | null
          project_id: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          content?: Json
          created_at?: string
          created_by?: string | null
          doc_id: string
          icon?: string | null
          id?: string
          is_private?: boolean
          parent_id?: string | null
          project_id: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Update: {
          content?: Json
          created_at?: string
          created_by?: string | null
          doc_id?: string
          icon?: string | null
          id?: string
          is_private?: boolean
          parent_id?: string | null
          project_id?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_docs_pages_doc_fk"
            columns: ["doc_id"]
            isOneToOne: false
            referencedRelation: "app_docs_docs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_docs_pages_parent_fk"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "app_docs_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_docs_pages_project_fk"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      app_docs_page_shares: {
        Row: {
          created_at: string
          id: string
          page_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          page_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          page_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_docs_page_shares_page_fk"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "app_docs_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_docs_page_shares_user_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      app_files_folders: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          project_id: string | null
          team_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          project_id?: string | null
          team_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          project_id?: string | null
          team_id?: string
        }
        Relationships: []
      }
      app_files_files: {
        Row: {
          allow_download: boolean
          created_at: string
          created_by: string | null
          folder_id: string | null
          id: string
          mime: string | null
          name: string
          project_id: string | null
          published: boolean
          size_bytes: number | null
          source_import_label: string | null
          source_relative_path: string | null
          storage_path: string
          team_id: string
          watermark: boolean
        }
        Insert: {
          allow_download?: boolean
          created_at?: string
          created_by?: string | null
          folder_id?: string | null
          id?: string
          mime?: string | null
          name: string
          project_id?: string | null
          published?: boolean
          size_bytes?: number | null
          source_import_label?: string | null
          source_relative_path?: string | null
          storage_path: string
          team_id: string
          watermark?: boolean
        }
        Update: {
          allow_download?: boolean
          created_at?: string
          created_by?: string | null
          folder_id?: string | null
          id?: string
          mime?: string | null
          name?: string
          project_id?: string | null
          published?: boolean
          size_bytes?: number | null
          source_import_label?: string | null
          source_relative_path?: string | null
          storage_path?: string
          team_id?: string
          watermark?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "app_files_files_project_fk"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_files_files_created_by_fk"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      app_social_studio_channels: {
        Row: {
          avatar_url: string | null
          connected: boolean
          created_at: string
          created_by: string | null
          followers_count: number
          handle: string
          id: string
          name: string
          platform: string
          project_id: string | null
          team_id: string
          theme_color: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          connected?: boolean
          created_at?: string
          created_by?: string | null
          followers_count?: number
          handle: string
          id?: string
          name: string
          platform: string
          project_id?: string | null
          team_id: string
          theme_color?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          connected?: boolean
          created_at?: string
          created_by?: string | null
          followers_count?: number
          handle?: string
          id?: string
          name?: string
          platform?: string
          project_id?: string | null
          team_id?: string
          theme_color?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_social_studio_channels_team_fk"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_social_studio_channels_project_fk"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_social_studio_channels_created_by_fk"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      app_social_studio_campaigns: {
        Row: {
          brief: string | null
          created_at: string
          created_by: string | null
          end_date: string | null
          goal: string | null
          id: string
          name: string
          project_id: string | null
          start_date: string | null
          team_id: string
          theme_color: string
          updated_at: string
        }
        Insert: {
          brief?: string | null
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          goal?: string | null
          id?: string
          name: string
          project_id?: string | null
          start_date?: string | null
          team_id: string
          theme_color?: string
          updated_at?: string
        }
        Update: {
          brief?: string | null
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          goal?: string | null
          id?: string
          name?: string
          project_id?: string | null
          start_date?: string | null
          team_id?: string
          theme_color?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_social_studio_campaigns_team_fk"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_social_studio_campaigns_project_fk"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_social_studio_campaigns_created_by_fk"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      app_social_studio_posts: {
        Row: {
          approval_required: boolean
          campaign_id: string | null
          caption: string
          clicks: number
          created_at: string
          created_by: string | null
          engagements: number
          id: string
          impressions: number
          project_id: string | null
          published_at: string | null
          scheduled_for: string | null
          status: string
          target_url: string | null
          task_id: string | null
          team_id: string
          title: string
          updated_at: string
        }
        Insert: {
          approval_required?: boolean
          campaign_id?: string | null
          caption: string
          clicks?: number
          created_at?: string
          created_by?: string | null
          engagements?: number
          id?: string
          impressions?: number
          project_id?: string | null
          published_at?: string | null
          scheduled_for?: string | null
          status?: string
          target_url?: string | null
          task_id?: string | null
          team_id: string
          title: string
          updated_at?: string
        }
        Update: {
          approval_required?: boolean
          campaign_id?: string | null
          caption?: string
          clicks?: number
          created_at?: string
          created_by?: string | null
          engagements?: number
          id?: string
          impressions?: number
          project_id?: string | null
          published_at?: string | null
          scheduled_for?: string | null
          status?: string
          target_url?: string | null
          task_id?: string | null
          team_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_social_studio_posts_team_fk"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_social_studio_posts_project_fk"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_social_studio_posts_task_fk"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_social_studio_posts_campaign_fk"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "app_social_studio_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_social_studio_posts_created_by_fk"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      app_social_studio_post_channels: {
        Row: {
          channel_id: string
          created_at: string
          id: string
          post_id: string
          sort_order: number
          variant_caption: string | null
        }
        Insert: {
          channel_id: string
          created_at?: string
          id?: string
          post_id: string
          sort_order?: number
          variant_caption?: string | null
        }
        Update: {
          channel_id?: string
          created_at?: string
          id?: string
          post_id?: string
          sort_order?: number
          variant_caption?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_social_studio_post_channels_post_fk"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "app_social_studio_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_social_studio_post_channels_channel_fk"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "app_social_studio_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      app_social_studio_post_assets: {
        Row: {
          created_at: string
          file_id: string
          id: string
          post_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          file_id: string
          id?: string
          post_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          file_id?: string
          id?: string
          post_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "app_social_studio_post_assets_post_fk"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "app_social_studio_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_social_studio_post_assets_file_fk"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "app_files_files"
            referencedColumns: ["id"]
          },
        ]
      }
      app_video_review_folders: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          project_id: string | null
          team_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          project_id?: string | null
          team_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          project_id?: string | null
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_video_review_folders_team_fk"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_video_review_folders_project_fk"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      app_video_review_reviewers: {
        Row: {
          created_at: string
          id: string
          role: string
          user_id: string
          video_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: string
          user_id: string
          video_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          user_id?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_video_review_reviewers_video_fk"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "app_video_review_videos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_video_review_reviewers_user_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      app_video_review_workflow_templates: {
        Row: {
          config: Json
          created_at: string
          created_by: string | null
          id: string
          name: string
          team_id: string
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          team_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_video_review_wf_templates_team_fk"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          category_id: string | null
          client_id: string | null
          color_code: string
          created_at: string
          default_task_template_id: string | null
          end_date: string | null
          estimated_man_days: number | null
          folder_id: string | null
          health_id: string | null
          hours_per_day: number | null
          id: string
          key: string
          name: string
          notes: string | null
          owner_id: string | null
          share_token: string
          start_date: string | null
          status_id: string | null
          tasks_counter: number
          team_id: string
          updated_at: string
          use_manual_progress: boolean
          use_time_progress: boolean
          use_weighted_progress: boolean
          visibility: string
        }
        Insert: {
          category_id?: string | null
          client_id?: string | null
          color_code?: string
          created_at?: string
          end_date?: string | null
          estimated_man_days?: number | null
          folder_id?: string | null
          health_id?: string | null
          default_task_template_id?: string | null
          hours_per_day?: number | null
          id?: string
          key: string
          name: string
          notes?: string | null
          owner_id?: string | null
          share_token?: string
          start_date?: string | null
          status_id?: string | null
          tasks_counter?: number
          team_id: string
          updated_at?: string
          use_manual_progress?: boolean
          use_time_progress?: boolean
          use_weighted_progress?: boolean
          visibility?: string
        }
        Update: {
          category_id?: string | null
          client_id?: string | null
          color_code?: string
          created_at?: string
          end_date?: string | null
          estimated_man_days?: number | null
          folder_id?: string | null
          health_id?: string | null
          default_task_template_id?: string | null
          hours_per_day?: number | null
          id?: string
          key?: string
          name?: string
          notes?: string | null
          owner_id?: string | null
          share_token?: string
          start_date?: string | null
          status_id?: string | null
          tasks_counter?: number
          team_id?: string
          updated_at?: string
          use_manual_progress?: boolean
          use_time_progress?: boolean
          use_weighted_progress?: boolean
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_category_id_fk"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "project_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_client_id_fk"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_folder_id_fk"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "project_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_health_id_fk"
            columns: ["health_id"]
            isOneToOne: false
            referencedRelation: "sys_project_healths"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_owner_id_fk"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_status_id_fk"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "sys_project_statuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_team_id_fk"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          permission_id: string
          role_id: string
        }
        Insert: {
          permission_id: string
          role_id: string
        }
        Update: {
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fk"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fk"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          admin_role: boolean
          default_role: boolean
          id: string
          name: string
          owner: boolean
          team_id: string
        }
        Insert: {
          admin_role?: boolean
          default_role?: boolean
          id?: string
          name: string
          owner?: boolean
          team_id: string
        }
        Update: {
          admin_role?: boolean
          default_role?: boolean
          id?: string
          name?: string
          owner?: boolean
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "roles_team_id_fk"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      support_requests: {
        Row: {
          created_at: string
          id: string
          message: string
          status: string
          subject: string
          team_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          status?: string
          subject: string
          team_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          status?: string
          subject?: string
          team_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_requests_team_id_fk"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_requests_user_id_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_responses: {
        Row: {
          created_at: string
          id: string
          organization_id: string | null
          response: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id?: string | null
          response?: Json
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string | null
          response?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "survey_responses_organization_id_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_responses_user_id_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sys_project_healths: {
        Row: {
          color_code: string
          id: string
          is_default: boolean
          name: string
          sort_order: number
        }
        Insert: {
          color_code: string
          id?: string
          is_default?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          color_code?: string
          id?: string
          is_default?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      sys_project_statuses: {
        Row: {
          color_code: string
          icon: string
          id: string
          is_default: boolean
          name: string
          sort_order: number
        }
        Insert: {
          color_code: string
          icon: string
          id?: string
          is_default?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          color_code?: string
          icon?: string
          id?: string
          is_default?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      sys_task_status_categories: {
        Row: {
          color_code: string
          id: string
          is_doing: boolean
          is_done: boolean
          is_todo: boolean
          name: string
          sort_order: number
        }
        Insert: {
          color_code: string
          id?: string
          is_doing?: boolean
          is_done?: boolean
          is_todo?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          color_code?: string
          id?: string
          is_doing?: boolean
          is_done?: boolean
          is_todo?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      task_activity_logs: {
        Row: {
          action: string
          created_at: string
          field: string | null
          id: string
          new_value: string | null
          old_value: string | null
          project_id: string
          task_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          field?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          project_id: string
          task_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          field?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          project_id?: string
          task_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_activity_logs_project_id_fk"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_activity_logs_task_id_fk"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_activity_logs_user_id_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      task_attachments: {
        Row: {
          created_at: string
          id: string
          name: string | null
          project_id: string
          size: number | null
          storage_path: string
          task_id: string
          team_id: string
          type: string | null
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string | null
          project_id: string
          size?: number | null
          storage_path: string
          task_id: string
          team_id: string
          type?: string | null
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string | null
          project_id?: string
          size?: number | null
          storage_path?: string
          task_id?: string
          team_id?: string
          type?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_attachments_project_id_fk"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_attachments_task_id_fk"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_attachments_team_id_fk"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_attachments_uploaded_by_fk"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      task_comments: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          id: string
          mentions: string[]
          task_id: string
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          mentions?: string[]
          task_id: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          mentions?: string[]
          task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_created_by_fk"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_task_id_fk"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_dependencies: {
        Row: {
          created_at: string
          depends_on_task_id: string
          id: string
          relation_type: string
          task_id: string
        }
        Insert: {
          created_at?: string
          depends_on_task_id: string
          id?: string
          relation_type?: string
          task_id: string
        }
        Update: {
          created_at?: string
          depends_on_task_id?: string
          id?: string
          relation_type?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_dependencies_depends_on_task_id_fk"
            columns: ["depends_on_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_task_id_fk"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_labels: {
        Row: {
          label_id: string
          task_id: string
        }
        Insert: {
          label_id: string
          task_id: string
        }
        Update: {
          label_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_labels_label_id_fk"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "team_labels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_labels_task_id_fk"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_phase: {
        Row: {
          phase_id: string
          task_id: string
        }
        Insert: {
          phase_id: string
          task_id: string
        }
        Update: {
          phase_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_phase_phase_id_fk"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "project_phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_phase_task_id_fk"
            columns: ["task_id"]
            isOneToOne: true
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_reference_links: {
        Row: {
          created_at: string
          created_by: string | null
          domain: string | null
          id: string
          preview_image: string | null
          sort_order: number
          task_id: string
          title: string | null
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          domain?: string | null
          id?: string
          preview_image?: string | null
          sort_order?: number
          task_id: string
          title?: string | null
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          domain?: string | null
          id?: string
          preview_image?: string | null
          sort_order?: number
          task_id?: string
          title?: string | null
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_reference_links_created_by_fk"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_reference_links_task_fk"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_priorities: {
        Row: {
          color_code: string
          id: string
          name: string
          value: number
        }
        Insert: {
          color_code: string
          id?: string
          name: string
          value?: number
        }
        Update: {
          color_code?: string
          id?: string
          name?: string
          value?: number
        }
        Relationships: []
      }
      task_recurring_schedules: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          day_of_month: number | null
          day_of_week: number | null
          id: string
          interval_value: number
          last_created_at: string | null
          next_run_at: string | null
          schedule_type: string
          task_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          day_of_month?: number | null
          day_of_week?: number | null
          id?: string
          interval_value?: number
          last_created_at?: string | null
          next_run_at?: string | null
          schedule_type: string
          task_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          day_of_month?: number | null
          day_of_week?: number | null
          id?: string
          interval_value?: number
          last_created_at?: string | null
          next_run_at?: string | null
          schedule_type?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_recurring_schedules_created_by_fk"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_recurring_schedules_task_id_fk"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_statuses: {
        Row: {
          category_id: string
          created_at: string
          id: string
          name: string
          project_id: string
          sort_order: number
          team_id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          id?: string
          name: string
          project_id: string
          sort_order?: number
          team_id: string
        }
        Update: {
          category_id?: string
          created_at?: string
          id?: string
          name?: string
          project_id?: string
          sort_order?: number
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_statuses_category_id_fk"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "sys_task_status_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_statuses_project_id_fk"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_statuses_team_id_fk"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      task_templates: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          priority: string | null
          steps: Json
          tasks: Json
          team_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          priority?: string | null
          steps?: Json
          tasks?: Json
          team_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          priority?: string | null
          steps?: Json
          tasks?: Json
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_templates_created_by_fk"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_templates_team_id_fk"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      task_timers: {
        Row: {
          created_at: string
          id: string
          start_time: string
          task_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          start_time?: string
          task_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          start_time?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_timers_task_id_fk"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_timers_user_id_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      task_work_log: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_billable: boolean
          logged_by_timer: boolean
          task_id: string
          time_spent: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_billable?: boolean
          logged_by_timer?: boolean
          task_id: string
          time_spent: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_billable?: boolean
          logged_by_timer?: boolean
          task_id?: string
          time_spent?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_work_log_task_id_fk"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_work_log_user_id_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          archived: boolean
          completed_at: string | null
          created_at: string
          deliverable_type: string | null
          description: string | null
          done: boolean
          end_date: string | null
          id: string
          name: string
          parent_task_id: string | null
          priority_id: string | null
          progress_value: number | null
          project_id: string
          reporter_id: string | null
          sort_order: number
          start_date: string | null
          status_id: string | null
          submission_content: string | null
          submission_status: string
          task_no: number | null
          total_minutes: number
          updated_at: string
        }
        Insert: {
          archived?: boolean
          completed_at?: string | null
          created_at?: string
          deliverable_type?: string | null
          description?: string | null
          done?: boolean
          end_date?: string | null
          id?: string
          name: string
          parent_task_id?: string | null
          priority_id?: string | null
          progress_value?: number | null
          project_id: string
          reporter_id?: string | null
          sort_order?: number
          start_date?: string | null
          status_id?: string | null
          submission_content?: string | null
          submission_status?: string
          task_no?: number | null
          total_minutes?: number
          updated_at?: string
        }
        Update: {
          archived?: boolean
          completed_at?: string | null
          created_at?: string
          deliverable_type?: string | null
          description?: string | null
          done?: boolean
          end_date?: string | null
          id?: string
          name?: string
          parent_task_id?: string | null
          priority_id?: string | null
          progress_value?: number | null
          project_id?: string
          reporter_id?: string | null
          sort_order?: number
          start_date?: string | null
          status_id?: string | null
          submission_content?: string | null
          submission_status?: string
          task_no?: number | null
          total_minutes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_parent_task_id_fk"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_priority_id_fk"
            columns: ["priority_id"]
            isOneToOne: false
            referencedRelation: "task_priorities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fk"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_reporter_id_fk"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_status_id_fk"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "task_statuses"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks_assignees: {
        Row: {
          assigned_by: string | null
          created_at: string
          project_member_id: string | null
          task_id: string
          team_member_id: string
        }
        Insert: {
          assigned_by?: string | null
          created_at?: string
          project_member_id?: string | null
          task_id: string
          team_member_id: string
        }
        Update: {
          assigned_by?: string | null
          created_at?: string
          project_member_id?: string | null
          task_id?: string
          team_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignees_assigned_by_fk"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assignees_project_member_id_fk"
            columns: ["project_member_id"]
            isOneToOne: false
            referencedRelation: "project_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assignees_task_id_fk"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assignees_team_member_id_fk"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      team_labels: {
        Row: {
          color_code: string
          created_at: string
          id: string
          name: string
          team_id: string
        }
        Insert: {
          color_code: string
          created_at?: string
          id?: string
          name: string
          team_id: string
        }
        Update: {
          color_code?: string
          created_at?: string
          id?: string
          name?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_labels_team_id_fk"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_details: {
        Row: {
          address_line_1: string | null
          address_line_2: string | null
          city: string | null
          company_name: string | null
          company_size: string | null
          contact_email: string | null
          contact_number: string | null
          country: string | null
          created_at: string
          industry: string | null
          postal_code: string | null
          state: string | null
          tax_id: string | null
          team_id: string
          updated_at: string
          website: string | null
        }
        Insert: {
          address_line_1?: string | null
          address_line_2?: string | null
          city?: string | null
          company_name?: string | null
          company_size?: string | null
          contact_email?: string | null
          contact_number?: string | null
          country?: string | null
          created_at?: string
          industry?: string | null
          postal_code?: string | null
          state?: string | null
          tax_id?: string | null
          team_id: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          address_line_1?: string | null
          address_line_2?: string | null
          city?: string | null
          company_name?: string | null
          company_size?: string | null
          contact_email?: string | null
          contact_number?: string | null
          country?: string | null
          created_at?: string
          industry?: string | null
          postal_code?: string | null
          state?: string | null
          tax_id?: string | null
          team_id?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_details_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: true
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          active: boolean | null
          created_at: string
          id: string
          job_title_id: string | null
          role_id: string
          team_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string
          id?: string
          job_title_id?: string | null
          role_id: string
          team_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          active?: boolean | null
          created_at?: string
          id?: string
          job_title_id?: string | null
          role_id?: string
          team_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_members_job_title_id_fk"
            columns: ["job_title_id"]
            isOneToOne: false
            referencedRelation: "job_titles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_role_id_fk"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_team_id_fk"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_user_id_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          id: string
          name: string
          organization_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          organization_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          organization_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_organization_id_fk"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_user_id_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      timezones: {
        Row: {
          abbrev: string
          id: string
          name: string
          utc_offset: string
        }
        Insert: {
          abbrev: string
          id?: string
          name: string
          utc_offset: string
        }
        Update: {
          abbrev?: string
          id?: string
          name?: string
          utc_offset?: string
        }
        Relationships: []
      }
      user_notifications: {
        Row: {
          created_at: string
          id: string
          message: string
          project_id: string | null
          read: boolean
          remind_at: string | null
          task_id: string | null
          team_id: string | null
          type: string
          url: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          project_id?: string | null
          read?: boolean
          remind_at?: string | null
          task_id?: string | null
          team_id?: string | null
          type?: string
          url?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          project_id?: string | null
          read?: boolean
          remind_at?: string | null
          task_id?: string | null
          team_id?: string | null
          type?: string
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_notifications_project_id_fk"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_notifications_task_id_fk"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_notifications_team_id_fk"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_notifications_user_id_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          active_team: string | null
          avatar_url: string | null
          created_at: string
          deleted_at: string | null
          email: string
          id: string
          is_deleted: boolean | null
          language: Database["public"]["Enums"]["language_type"] | null
          name: string
          setup_completed: boolean
          timezone_id: string | null
          updated_at: string
        }
        Insert: {
          active_team?: string | null
          avatar_url?: string | null
          created_at?: string
          deleted_at?: string | null
          email: string
          id: string
          is_deleted?: boolean | null
          language?: Database["public"]["Enums"]["language_type"] | null
          name: string
          setup_completed?: boolean
          timezone_id?: string | null
          updated_at?: string
        }
        Update: {
          active_team?: string | null
          avatar_url?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string
          id?: string
          is_deleted?: boolean | null
          language?: Database["public"]["Enums"]["language_type"] | null
          name?: string
          setup_completed?: boolean
          timezone_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_active_team_fk"
            columns: ["active_team"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "users_timezone_id_fk"
            columns: ["timezone_id"]
            isOneToOne: false
            referencedRelation: "timezones"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitation: { Args: { p_invitation_id: string }; Returns: string }
      accrue_monthly_leave: { Args: never; Returns: number }
      app_activate_for_project: {
        Args: { p_project_id: string; p_app_key: string }
        Returns: undefined
      }
      video_review_send_for_review: { Args: { p_video_id: string }; Returns: undefined }
      video_review_decide: {
        Args: { p_video_id: string; p_approved: boolean }
        Returns: undefined
      }
      admin_list_projects: {
        Args: { p_org_id: string }
        Returns: {
          owner_name: string
          project_id: string
          project_name: string
          task_count: number
          team_name: string
        }[]
      }
      admin_list_teams: {
        Args: { p_org_id: string }
        Returns: {
          member_count: number
          project_count: number
          team_id: string
          team_name: string
        }[]
      }
      admin_list_users: {
        Args: { p_org_id: string }
        Returns: {
          email: string
          name: string
          team_count: number
          user_id: string
        }[]
      }
      admin_org_overview: {
        Args: { p_org_id: string }
        Returns: {
          completed_tasks: number
          org_name: string
          subscription_status: string
          total_members: number
          total_projects: number
          total_tasks: number
          total_teams: number
          trial_in_progress: boolean
        }[]
      }
      apply_india_salary_preset: {
        Args: { p_structure_id: string }
        Returns: undefined
      }
      apply_leave: {
        Args: {
          p_from: string
          p_leave_type_id: string
          p_reason?: string
          p_to: string
        }
        Returns: string
      }
      apply_task_template: {
        Args: { p_project_id: string; p_template_id: string }
        Returns: number
      }
      can_manage_employee: { Args: { _employee_id: string }; Returns: boolean }
      can_view_employee: { Args: { _employee_id: string }; Returns: boolean }
      cancel_leave: { Args: { p_request_id: string }; Returns: undefined }
      clock_in: { Args: never; Returns: string }
      clock_out: { Args: never; Returns: string }
      complete_account_setup: {
        Args: { p_organization_name?: string; p_team_name: string }
        Returns: string
      }
      create_team: { Args: { p_name: string }; Returns: string }
      compute_payslip: {
        Args: { p_employee_id: string; p_month: number; p_year: number }
        Returns: Json
      }
      count_working_days: {
        Args: { p_from: string; p_org_id: string; p_to: string }
        Returns: number
      }
      create_notification: {
        Args: {
          p_message: string
          p_project_id?: string
          p_task_id?: string
          p_team_id?: string
          p_type?: string
          p_url?: string
          p_user_id: string
        }
        Returns: string
      }
      clear_team_data: {
        Args: { p_team_id: string }
        Returns: Json
      }
      create_project: {
        Args: {
          p_category_id?: string
          p_client_id?: string
          p_color_code?: string
          p_name: string
          p_team_id: string
        }
        Returns: string
      }
      create_project_from_template: {
        Args: { p_name: string; p_team_id: string; p_template_id: string }
        Returns: string
      }
      create_project_template_from_project: {
        Args: { p_project_id: string; p_name: string }
        Returns: string
      }
      create_task_with_template: {
        Args: {
          p_project_id: string
          p_name: string
          p_template_id?: string
          p_description?: string
          p_priority_id?: string
          p_status_id?: string
          p_assignees?: string[]
        }
        Returns: string
      }
      create_task: {
        Args: {
          p_assignees?: string[]
          p_name: string
          p_parent_task_id?: string
          p_priority_id?: string
          p_project_id: string
          p_status_id?: string
        }
        Returns: string
      }
      current_employee_id: { Args: { _org_id: string }; Returns: string }
      decide_leave: {
        Args: { p_approve: boolean; p_note?: string; p_request_id: string }
        Returns: undefined
      }
      decide_regularization: {
        Args: { p_approve: boolean; p_id: string; p_note?: string }
        Returns: undefined
      }
      finalize_payroll_run: { Args: { p_run_id: string }; Returns: undefined }
      get_my_tasks: {
        Args: never
        Returns: {
          end_date: string
          name: string
          priority: string
          project_id: string
          project_name: string
          status_name: string
          task_id: string
        }[]
      }
      get_project_member_availability: {
        Args: { p_from: string; p_project_id: string; p_to: string }
        Returns: {
          day: string
          kind: string
          label: string
          team_member_id: string
          user_id: string
        }[]
      }
      get_client_portal: { Args: { p_token: string }; Returns: Json }
      get_shared_project: { Args: { p_token: string }; Returns: Json }
      get_team_member_availability: {
        Args: { p_from: string; p_team_id: string; p_to: string }
        Returns: {
          day: string
          kind: string
          label: string
          team_member_id: string
          user_id: string
        }[]
      }
      hr_org_analytics: { Args: { p_org_id: string }; Returns: Json }
      hr_shift_break_minutes: {
        Args: { _date: string; _employee_id: string }
        Returns: number
      }
      is_hr_admin: { Args: { _org_id: string }; Returns: boolean }
      is_org_admin: { Args: { _org_id: string }; Returns: boolean }
      is_org_member: { Args: { _org_id: string }; Returns: boolean }
      advance_workflow_run: { Args: { p_run_id: string }; Returns: undefined }
      start_workflow_run: {
        Args: { p_workflow_id: string; p_trigger_snapshot?: Json }
        Returns: string
      }
      wf_overdue_tasks: { Args: { p_team_id: string }; Returns: Json }
      is_project_member: { Args: { _project_id: string }; Returns: boolean }
      is_project_team_admin: { Args: { _project_id: string }; Returns: boolean }
      is_project_team_member: {
        Args: { _project_id: string }
        Returns: boolean
      }
      is_task_member: { Args: { _task_id: string }; Returns: boolean }
      is_team_admin: { Args: { _team_id: string }; Returns: boolean }
      is_team_owner: { Args: { _team_id: string }; Returns: boolean }
      is_team_member: { Args: { _team_id: string }; Returns: boolean }
      log_time: {
        Args: {
          p_description?: string
          p_is_billable?: boolean
          p_minutes: number
          p_task_id: string
        }
        Returns: string
      }
      materialize_recurring_tasks: { Args: never; Returns: number }
      provision_my_account: { Args: never; Returns: string }
      provision_user_account: { Args: { p_user_id: string }; Returns: string }
      report_members: {
        Args: { p_team_id: string }
        Returns: {
          assigned_tasks: number
          completed_tasks: number
          logged_minutes: number
          team_member_id: string
          user_name: string
        }[]
      }
      report_projects: {
        Args: { p_team_id: string }
        Returns: {
          completed_tasks: number
          completion_pct: number
          logged_minutes: number
          member_count: number
          project_id: string
          project_name: string
          total_tasks: number
        }[]
      }
      report_team_overview: {
        Args: { p_team_id: string }
        Returns: {
          active_projects: number
          completed_tasks: number
          overdue_tasks: number
          total_logged_minutes: number
          total_members: number
          total_projects: number
          total_tasks: number
        }[]
      }
      report_time_logs: {
        Args: { p_from?: string; p_team_id: string; p_to?: string }
        Returns: {
          is_billable: boolean
          log_id: string
          logged_at: string
          minutes: number
          project_name: string
          task_name: string
          user_name: string
        }[]
      }
      request_regularization: {
        Args: { p_date: string; p_in: string; p_out: string; p_reason?: string }
        Returns: string
      }
      run_payroll: {
        Args: { p_month: number; p_org_id: string; p_year: number }
        Returns: string
      }
      seed_onboarding_checklist: {
        Args: { p_employee_id: string; p_kind?: string }
        Returns: number
      }
      shares_team_with: { Args: { _other_user_id: string }; Returns: boolean }
      start_timer: { Args: { p_task_id: string }; Returns: string }
      stop_timer: {
        Args: {
          p_description?: string
          p_is_billable?: boolean
          p_task_id: string
        }
        Returns: string
      }
      team_id_of_project: { Args: { _project_id: string }; Returns: string }
    }
    Enums: {
      language_type: "en" | "es" | "pt" | "alb" | "de" | "zh_cn" | "ko"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      language_type: ["en", "es", "pt", "alb", "de", "zh_cn", "ko"],
    },
  },
} as const
