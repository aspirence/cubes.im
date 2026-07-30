# HR Letters, Templates, and Generated Documents Plan

## Objective

Inside the HR app, documents should not be just uploaded files.

They should be:

- generated from reusable templates
- merged with employee, candidate, organization, and compensation data
- previewed before sending
- saved as internal source documents
- exported as PDF
- tracked through approval, acceptance, and signing states
- attached to onboarding and offboarding workflows automatically

This plan defines how Cubes HR should handle:

- offer letters
- appointment letters
- increment letters
- promotion letters
- confirmation letters
- NDA and compliance forms
- relieving and experience letters
- employee document packets

## Product Principle

For HR, there are three different things:

1. Template
   - reusable letter structure
2. Generated document
   - one specific rendered document for one person or one candidate
3. Output file
   - PDF or other export generated from the document snapshot

If these three are mixed together, the system becomes hard to audit.

## What the User Wants

The exact requirement is:

- templates will be prepared and stored in the system
- HR should generate letters and documents directly from those templates
- generated output should be available as document-style content and as PDF
- onboarding and offboarding should use these generated documents directly

This means Cubes HR needs a proper document engine, not only a file uploader.

## Current Repo State

What exists today:

- employee document storage through `hr_documents`
- onboarding and offboarding checklist tasks
- manual "Sign offer letter" checklist item
- payslip PDF generation already exists in payroll using `jsPDF`

What does not exist yet:

- letter template library
- merge field engine
- generated document snapshots
- approval workflow for documents
- e-sign acceptance flow
- onboarding documents linked to employee lifecycle state

## Target Feature Set

### 1. Template Library

HR should have a dedicated template center inside the HR app.

Template categories:

- Offer Letter
- Appointment Letter
- Internship Letter
- Contract Renewal
- Confirmation Letter
- Salary Revision Letter
- Promotion Letter
- Transfer Letter
- Warning Letter
- NDA
- Policy Acknowledgement
- Relieving Letter
- Experience Letter
- Exit Clearance Packet

Each template should support:

- name
- category
- entity or location scope
- department or employment-type scope
- versioning
- active/inactive state
- default approvers
- output format rules
- required signers

Recommended tables:

- `hr_letter_templates`
- `hr_letter_template_versions`
- `hr_letter_template_rules`
- `hr_letter_template_approvers`

## 2. Template Builder

Templates should be created and maintained inside Cubes, not only uploaded from outside.

Recommended editing model for v1:

- rich HTML document editor
- header and footer blocks
- merge token insertion
- table blocks
- clause library blocks
- signature blocks

Recommended editing model for later:

- structured JSON document blocks for stronger rendering control

Template builder should support:

- page layout
- organization branding
- logos
- legal entity details
- dynamic compensation tables
- conditional sections
- multilingual variants

Examples:

- if employee type is contractor, show contractor clause
- if location is UAE, show UAE legal wording
- if probation exists, show probation clause

## 3. Merge Field Engine

This is the heart of document generation.

Supported merge domains should include:

- employee
- candidate
- reporting manager
- department
- designation
- organization
- legal entity
- location
- salary structure
- leave policy group
- joining details
- offboarding details
- approver details
- generated date and period values

Example merge fields:

- `{{employee.full_name}}`
- `{{employee.employee_code}}`
- `{{job.designation_title}}`
- `{{org.name}}`
- `{{compensation.monthly_ctc}}`
- `{{offer.joining_date}}`
- `{{manager.full_name}}`

Recommended tables:

- `hr_letter_merge_fields`
- `hr_letter_merge_sources`

Recommended merge engine outputs:

- resolved HTML snapshot
- resolved plain-text metadata
- merge audit payload showing exactly which values were used

## 4. Generated Document Model

Every generated document should become an immutable record once issued.

Recommended tables:

- `hr_generated_documents`
- `hr_generated_document_outputs`
- `hr_generated_document_events`

Recommended fields in `hr_generated_documents`:

- `id`
- `org_id`
- `employee_id` nullable
- `candidate_id` nullable
- `template_id`
- `template_version_id`
- `document_type`
- `title`
- `status`
- `source_snapshot`
- `merged_snapshot`
- `merge_payload`
- `created_by`
- `approved_by`
- `sent_at`
- `completed_at`
- `revoked_at`

Recommended status flow:

- `draft`
- `pending_approval`
- `approved`
- `generated`
- `sent`
- `viewed`
- `signed`
- `declined`
- `revoked`
- `archived`

Important rule:

- after `generated` or `sent`, the merged snapshot must not be mutated
- if content changes, generate a new document version or a new document instance

## 5. Output Formats

The user specifically wants Docs/PDF style generation.

Recommended outputs:

### Primary outputs in v1

- in-app document preview
- downloadable PDF

### Secondary outputs in v2

- DOCX export
- HTML email-safe output
- print-ready format

Recommended storage split:

- editable source snapshot stored in DB
- PDF stored in private HR storage bucket
- output metadata stored in `hr_generated_document_outputs`

Example output record:

- `output_kind = 'pdf'`
- `storage_path = 'hr-docs/org/employee/generated/offer-letter-v3.pdf'`
- `checksum`
- `created_at`

## 6. PDF Generation Strategy

Use a two-step rendering model.

### Step 1: render document snapshot

- merge all values into a clean HTML snapshot
- freeze the snapshot

### Step 2: generate PDF from snapshot

Options:

1. client-side PDF for MVP
   - similar to current payslip flow
2. server-side or Edge rendering for production reliability

Recommended path:

- start with HTML snapshot preview in app
- move PDF generation to server-side renderer once letters become core workflow

Reason:

- HR documents need layout consistency
- browser-side PDFs are acceptable for MVP but weak for enterprise letters

## 7. Approval Workflow

Document generation should not be one-click final in most cases.

Recommended flow:

1. choose template
2. fill optional overrides
3. preview merged result
4. submit for approval
5. approvers approve or reject
6. system generates final snapshot and PDF
7. send to employee or candidate

Approval rules can vary by document type:

- offer letter may need recruiter + HR manager + finance approval
- salary revision may need manager + HR + payroll approval
- relieving letter may need HR only

Recommended tables:

- `hr_document_approval_runs`
- `hr_document_approval_steps`

This should eventually connect to the Cubes workflows engine.

## 8. E-Sign and Acceptance

Some documents are informational. Some need acknowledgement. Some need signatures.

Document action types:

- download only
- acknowledge
- e-sign
- counter-sign

Recommended additions:

- `hr_signature_requests`
- `hr_signature_participants`
- `hr_signature_events`

Even if external e-sign provider is added later, Cubes should own:

- signature request state
- sign audit trail
- signed output reference

## 9. Onboarding Integration

This is the most important UI integration for the screen you shared.

Current state:

- onboarding is a checklist with a manual "Sign offer letter" row

Target state:

- onboarding becomes a lifecycle workspace
- checklist items can be either task-based or document-based

Recommended onboarding item types:

- `task`
- `document_request`
- `document_generation`
- `policy_acknowledgement`
- `signature_step`
- `asset_step`
- `provisioning_step`

Examples:

- Generate offer letter
- Candidate signs offer letter
- Employee uploads ID proof
- Employee signs NDA
- Generate appointment letter
- Generate payroll enrollment form

Recommended tables:

- `hr_lifecycle_templates`
- `hr_lifecycle_template_steps`
- `hr_employee_lifecycle_runs`
- `hr_employee_lifecycle_step_runs`

Current `hr_onboarding_tasks` can stay for compatibility, but longer term it should evolve into this richer model.

## 10. Offboarding Integration

Documents also matter heavily during offboarding.

Examples:

- resignation acknowledgement
- clearance packet
- full and final settlement letter
- experience letter
- relieving letter
- asset handover form

Offboarding should trigger:

- document generation
- signature or acknowledgement where needed
- archive of final outputs in employee timeline

## 11. Candidate to Employee Journey

The best enterprise flow is:

1. candidate created in ATS
2. interview and approval completed
3. offer packet generated from template
4. candidate receives and signs offer
5. preboarding packet starts
6. candidate converts into employee
7. onboarding documents continue in employee profile

This means generated document model must support both:

- `candidate_id`
- `employee_id`

and transition cleanly between them.

## 12. Document Packet Feature

Single documents are not enough. HR often sends packets.

Document packet examples:

- joining packet
  - offer letter
  - NDA
  - policy acknowledgement
  - bank form
- salary revision packet
  - increment letter
  - revised salary breakdown
- exit packet
  - resignation acceptance
  - clearance form
  - relieving letter
  - experience letter

Recommended tables:

- `hr_document_packets`
- `hr_document_packet_items`

Packet behaviors:

- bulk generate from selected templates
- order documents inside packet
- mixed sign/acknowledge requirements
- progress tracking

## 13. Employee Timeline and Audit

Every generated HR document should appear in the employee timeline.

Timeline events:

- offer created
- offer approved
- offer sent
- offer viewed
- offer signed
- appointment letter generated
- salary revision letter accepted
- relieving letter issued

Recommended table:

- `hr_document_timeline_events`

This timeline becomes very important for compliance and support.

## 14. Search and Retrieval

Enterprise HR users need fast retrieval.

Search dimensions:

- employee
- candidate
- document type
- template name
- status
- approver
- signer
- date range
- legal entity
- location

Useful filters:

- awaiting approval
- awaiting signature
- issued this month
- due before joining date
- revoked

## 15. Permissions Model

Documents in HR are highly sensitive.

Recommended roles:

- HR admin
- recruiter
- hiring manager
- payroll admin
- employee self-service
- signer only

Permission examples:

- recruiter can generate offer letters for assigned requisitions
- payroll admin can view compensation-linked letters
- employee can only view documents explicitly issued to them
- only HR admin can revoke or replace issued documents

Some fields should support masking:

- compensation
- bank details
- government identifiers

## 16. Storage Strategy

Do not mix HR-generated documents into the generic Files app by default.

Recommended default:

- private HR storage bucket remains source of truth

Reason:

- HR documents are more sensitive than normal workspace files
- permissions are different
- audit expectations are higher

Optional later feature:

- explicit publish or share to Files app for selected non-sensitive documents

## 17. UI Plan

### A. New HR section

Add a new section under HR:

- `Documents`

Subareas:

- Templates
- Generated Documents
- Packets
- Approval Queue
- Awaiting Signature

### B. Employee profile

Add tabs or sections:

- Documents
- Letters
- Timeline

### C. Onboarding screen evolution

The current onboarding page should evolve into:

- left: checklist and lifecycle progress
- right: document packet progress and pending signatures

Each step should show:

- generated or not
- sent or not
- signed or not
- due date
- blocker state

### D. Template builder

Reuse the product's existing template management patterns from Settings where possible:

- list view
- create modal or full editor
- version history
- duplicate template
- archive template

## 18. Phased Implementation Plan

### Phase 1: Template and generation foundation

1. create template tables
2. create generated document tables
3. create merge field registry
4. build preview renderer
5. build PDF output storage flow

### Phase 2: HR documents module

1. template library UI
2. generate document flow
3. employee documents timeline
4. document list and filters

### Phase 3: approvals and packets

1. approval runs
2. packet generation
3. queue views
4. sign/acknowledge states

### Phase 4: onboarding and offboarding integration

1. lifecycle step types richer than plain tasks
2. document-triggered onboarding steps
3. preboarding packet support
4. exit packet support

### Phase 5: ATS integration

1. candidate-linked documents
2. offer management
3. candidate acceptance to employee conversion

### Phase 6: e-sign and external integrations

1. provider abstraction
2. webhooks
3. signed output archive

## 19. Best First Slice for This Repo

If we want maximum value quickly, build this first:

1. `hr_letter_templates`
2. `hr_letter_template_versions`
3. `hr_generated_documents`
4. document preview + PDF generation
5. employee-level generated document list
6. onboarding step integration for offer letter and paperwork

This first slice is enough to make the current onboarding screen feel much more like a real HR system.

## Final Recommendation

For Cubes HR, the correct model is:

- templates are reusable blueprints
- generated documents are immutable business records
- PDFs are output artifacts
- onboarding and offboarding consume document flows as first-class lifecycle steps

That is the right structure if you want document generation to feel enterprise-grade and not like a simple upload feature.
