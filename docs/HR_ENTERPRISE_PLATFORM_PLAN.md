# Cubes Enterprise HR App Plan

## Goal

Turn Cubes HR from a foundational internal suite into a full enterprise HR app that can handle the entire employee lifecycle in one place:

- hiring and applicant tracking
- offer letters and document generation
- onboarding and offboarding
- employee records and org structure
- attendance, leave, shifts, and workforce operations
- payroll, reimbursements, loans, and compliance workflows
- performance, goals, feedback, and skills
- assets, service requests, and employee self-service
- analytics, workflows, and app integrations

This plan extends the current shipped HR foundation in Cubes. It does not replace the existing schema immediately. It defines the next target state.

## Why This Expansion Is Needed

The current HR suite in the repo covers:

- core employee directory
- attendance
- leave
- payroll
- org chart
- onboarding checklist basics
- HR analytics basics

That is a solid base, but it is still not a complete Keka-style or enterprise-grade HR platform.

If Cubes wants HR to become a serious product area, then HR cannot stop at:

- employee profiles
- attendance
- leave
- payslips

It also needs:

- recruitment and hiring workflows
- offer letter lifecycle
- document packets and e-sign
- lifecycle events from candidate to alumni
- configurable approvals and policy engines
- employee experience and performance systems
- asset and IT/admin handover workflows
- platform APIs for other Cubes apps

## External Reference Baseline

This plan is informed by the current Cubes repo plus current Keka product surfaces and public materials:

- Keka positions itself as a complete HR and payroll platform spanning payroll automation, attendance, recruitment, performance management, and engagement.
- Keka's pricing and feature pages explicitly include org structure management, documents and letters, onboarding, dynamic employee profiles, payroll, attendance, compliance, hiring, onboarding, performance, and culture.
- Keka's ATS and performance pages emphasize candidate pipelines, collaboration, offer workflows, goals and OKRs, 360 reviews, feedback, calibration, and development.

Reference links:

- https://www.keka.com/
- https://www.keka.com/us/
- https://www.keka.com/pricing
- https://www.keka.com/us/applicant-tracking-system
- https://www.keka.com/recruitment-management-software
- https://www.keka.com/performance-management-software
- https://keka.com/us/employee-experience-management
- https://www.keka.com/best-offer-letter-management-software

## Product Positioning

Cubes HR should be treated as:

- a first-party installable app
- an org-wide system of record for people operations
- a platform that other apps can read from through approved contracts

Important architectural correction:

- the current app installation model is team-based
- HR is fundamentally org-scoped
- long term, HR installation should move to an org-scoped installed-app model, or an equivalent `installed_org_apps` layer

Using team-scoped install state for HR is acceptable as a short transition, but it is not the correct final model.

## Module Map

### 1. Core HR

This remains the backbone.

Required capabilities:

- employee master records
- employment lifecycle states
- legal entities, business units, departments, locations
- reporting hierarchy and matrix hierarchy
- job titles, grades, bands, levels
- compensation bands and job architecture
- custom fields per employee category
- employee timeline and change history
- document vault per employee

Existing Cubes foundation:

- `hr_employees`
- `hr_departments`
- `hr_designations`
- `hr_documents`
- org chart

Needs expansion:

- `hr_locations`
- `hr_business_units`
- `hr_legal_entities`
- `hr_cost_centers`
- `hr_job_levels`
- `hr_employment_changes`
- `hr_employee_custom_fields`
- `hr_employee_custom_values`

### 2. Recruitment and ATS

This is mandatory if Cubes should manage offer letters and hiring end to end.

Required capabilities:

- job requisitions
- hiring plans and headcount requests
- candidate pipelines
- sourcing channels
- resume and portfolio storage
- interview rounds, panels, and scorecards
- feedback collection
- hiring approvals
- candidate to employee conversion
- offer packet generation and acceptance tracking

Recommended tables:

- `hr_job_requisitions`
- `hr_job_openings`
- `hr_candidates`
- `hr_candidate_sources`
- `hr_candidate_stage_events`
- `hr_interviews`
- `hr_interview_feedback`
- `hr_hiring_approvals`
- `hr_offer_packets`

Important note:

- candidate records must stay separate from employee records until hire
- conversion to `hr_employees` should be explicit and auditable

### 3. Documents, Letters, and E-Sign

This is one of the most important missing enterprise features.

Required capabilities:

- offer letter templates
- appointment letters
- increment letters
- promotion letters
- experience and relieving letters
- NDA, policy, and compliance documents
- merge fields from employee, role, location, and compensation data
- approval workflows before issue
- versioning
- PDF generation
- digital acceptance / e-sign
- audit trail of sent, viewed, signed, revoked

Recommended tables:

- `hr_letter_templates`
- `hr_letter_template_versions`
- `hr_letter_merge_fields`
- `hr_generated_letters`
- `hr_letter_approvals`
- `hr_signature_requests`
- `hr_signature_events`
- `hr_document_packets`

Recommended architecture:

- template definition stored as structured HTML or JSON document blocks
- merge engine resolves dynamic fields into a render snapshot
- generated letter snapshot must be immutable once sent
- signed files stored in private storage with version trace

This is where Cubes can become much more useful than a basic HRMS.

Detailed execution spec:

- `docs/HR_LETTERS_AND_DOCUMENTS_PLAN.md`

### 4. Preboarding, Onboarding, and Offboarding

Current onboarding checklist exists, but it is too small for enterprise HR.

Required capabilities:

- preboarding before day 1
- document collection
- policy acknowledgements
- equipment requests
- account provisioning tasks
- buddy or mentor assignments
- role-based onboarding templates
- exit workflows and clearance
- knowledge transfer and asset return
- alumni records

Recommended tables:

- `hr_onboarding_templates`
- `hr_onboarding_steps`
- `hr_employee_onboarding_runs`
- `hr_offboarding_templates`
- `hr_employee_offboarding_runs`
- `hr_clearance_items`

Key design rule:

- onboarding and offboarding should be workflow-driven, not just checklist notes

### 5. Attendance, Time, and Workforce Operations

Attendance must evolve into a platform, not a single daily row.

Required capabilities:

- shift planning
- attendance capture from web, mobile, kiosk, device import
- regularization and manual corrections
- overtime policies
- late/early rules
- comp-off
- attendance anomalies
- roster and shift override support
- payroll-attendance snapshotting

This is already covered in more depth by:

- `docs/ATTENDANCE_PAYROLL_PLATFORM_PLAN.md`

That plan should be treated as the attendance and payroll execution spec for this larger HR program.

### 6. Leave, Travel, and Expense

Current leave model is foundational but still narrow.

Required capabilities:

- leave policies by grade/location/entity
- leave encashment
- comp-off
- unpaid leave policies
- holiday calendars by geography
- travel requests
- reimbursements and claim workflows
- mileage and receipt handling
- approval chains

Recommended additions:

- `hr_leave_policy_groups`
- `hr_employee_leave_policy_assignments`
- `hr_travel_requests`
- `hr_expense_claims`
- `hr_expense_categories`
- `hr_expense_policy_rules`

### 7. Payroll and Compliance

Payroll must grow beyond payslip generation.

Required capabilities:

- payroll periods and locks
- country or region-specific compliance packs
- statutory deductions and filings
- arrears, bonuses, full-and-final settlement
- salary revision workflows
- variable pay
- reimbursements and benefits handling
- payroll imports and adjustments
- bank advice or payout export
- audit logs

Recommended additions:

- `hr_payroll_periods`
- `hr_payroll_attendance_inputs`
- `hr_payroll_adjustments`
- `hr_salary_revisions`
- `hr_bonus_runs`
- `hr_final_settlements`
- `hr_statutory_profiles`
- `hr_payroll_exports`

Key rule:

- payroll logic should be pack-based where country-specific rules differ
- core payroll engine stays generic

### 8. Performance, Goals, and Talent Development

This is a major gap if Cubes wants to compete with larger HR suites.

Required capabilities:

- goal setting
- OKRs and KPIs
- review cycles
- self review, manager review, peer review, 360 review
- one-on-one notes
- continuous feedback
- calibration
- skill matrix
- development plans
- succession readiness

Recommended tables:

- `hr_goals`
- `hr_goal_key_results`
- `hr_review_cycles`
- `hr_review_forms`
- `hr_review_responses`
- `hr_feedback_entries`
- `hr_skill_catalog`
- `hr_employee_skills`
- `hr_development_plans`

### 9. Employee Experience and Self Service

Required capabilities:

- employee self-service dashboard
- profile updates with approval
- policy hub
- request center
- announcements
- rewards and recognition
- surveys and pulse checks
- helpdesk tickets for HR requests

Recommended additions:

- `hr_policies`
- `hr_policy_acknowledgements`
- `hr_employee_requests`
- `hr_recognition_posts`
- `hr_surveys`
- `hr_survey_responses`
- `hr_helpdesk_tickets`

### 10. Asset and Admin Operations

This becomes critical once onboarding and offboarding are serious.

Required capabilities:

- company asset inventory
- asset assignment to employee
- asset return and condition logs
- software access requests
- ID card issuance
- workstation, email, and tool provisioning tracking

Recommended additions:

- `hr_assets`
- `hr_asset_assignments`
- `hr_asset_return_events`
- `hr_access_requests`
- `hr_provisioning_tasks`

### 11. Analytics, Workflows, and Automation

Enterprise HR needs a strong operational layer.

Required capabilities:

- approval flows
- SLA-backed queues
- reminders and escalations
- lifecycle analytics
- hiring funnel analytics
- headcount and attrition analytics
- attendance and payroll exception analytics
- performance and talent analytics

Recommended additions:

- `hr_workflow_templates`
- `hr_workflow_runs`
- `hr_approval_rules`
- `hr_audit_events`
- `hr_domain_events`

This should plug into the existing Cubes workflows engine rather than rebuilding automation from scratch.

## Recommended Information Architecture

The HR app should eventually have these top-level sections:

- Overview
- People
- Hiring
- Documents
- Onboarding
- Attendance
- Leave
- Payroll
- Performance
- Assets
- Requests
- Reports
- Settings

Within employee detail:

- Personal
- Job
- Compensation
- Documents
- Attendance
- Leave
- Assets
- Performance
- Timeline
- Access and Provisioning

## App and Data Architecture

### Install model

Target:

- HR app installed at org scope
- module-level feature flags inside HR

Examples:

- org may enable Core HR + Attendance first
- later enable ATS
- later enable Performance

Recommended table:

- `installed_org_apps`
- `org_app_modules`

### Namespace strategy

Keep `hr_*` as the domain namespace.

Reason:

- HR already exists in this namespace
- employee lifecycle data is cross-functional and too central to hide in a smaller app-specific namespace

### Storage strategy

Use private storage buckets with policy-based subpaths for:

- employee documents
- resumes
- offer letters
- signed contracts
- reimbursement receipts
- policy packets

### Integration strategy

Other apps should consume HR through narrow RPCs and events:

- project staffing
- payroll previews
- onboarding tasks
- IT provisioning
- social or recognition programs
- workflow automations

## Security and Compliance Requirements

This app becomes highly sensitive. Security has to be stronger than normal project data.

Required controls:

- org-scoped install and access
- module-level permissions
- field-level masking for sensitive PII
- restricted access to compensation and payroll
- audit logs for every critical write
- immutable letter and payslip snapshots
- secure document access with signed URLs
- approval trace for any employment or compensation change

Sensitive domains that need stronger gating:

- salary
- bank details
- government IDs
- offers and contracts
- employee exits
- performance calibration

## Phased Delivery Plan

### Phase A: Correct the app platform shape

Before more HR work:

1. move HR installation toward org-scoped install
2. add module flags inside HR
3. define app-level permissions and admin surfaces

### Phase B: Finish operational HR foundation

1. harden attendance architecture
2. improve payroll snapshots and locks
3. expand employee master and history
4. add stronger document vault semantics

### Phase C: Letters and document engine

1. template builder
2. merge field engine
3. generated letter snapshots
4. approval flows
5. e-sign integration layer

This phase is the minimum needed for proper offer letter handling.

### Phase D: ATS and hiring

1. requisitions
2. candidate pipeline
3. interview scheduling and feedback
4. offer packet creation
5. candidate-to-employee conversion

### Phase E: Lifecycle workflows

1. preboarding
2. role-based onboarding
3. asset and access provisioning
4. offboarding and clearance
5. final settlement handoff

### Phase F: Performance and talent

1. goals and OKRs
2. review cycles
3. 360 feedback
4. skill matrix
5. development plans

### Phase G: Experience and service operations

1. rewards and recognition
2. surveys and pulse
3. employee request center
4. HR helpdesk

### Phase H: Compliance packs and enterprise polish

1. statutory packs by region
2. payroll export formats
3. stronger audit and retention controls
4. advanced analytics

## Recommended Priority If You Want Fast Business Value

If the target is "HR that feels complete quickly", build in this order:

1. letters and document engine
2. attendance/payroll hardening
3. ATS and hiring
4. onboarding and offboarding
5. asset management
6. performance and goals

Reason:

- offer letters and hiring make the product feel like a true HR system
- attendance and payroll make it operationally trusted
- onboarding/offboarding make it sticky
- performance and experience modules become easier once employee lifecycle data is solid

## Clear Recommendation

Cubes should not treat HR as one large generic page cluster.

It should treat HR as a platform app with these major sub-products:

- Core HR
- Hire
- Letters and Docs
- Workforce
- Payroll
- Performance
- Employee Experience

That structure matches how larger HR suites become scalable without becoming messy.

## Immediate Next Step for This Repo

The best next concrete step is:

1. create a module map and feature flags for the HR app
2. define org-scoped HR app installation
3. start the Letters and Docs engine
4. align attendance and payroll with `ATTENDANCE_PAYROLL_PLATFORM_PLAN.md`

That gives Cubes a realistic path from the current HR base to a full enterprise HR product.
