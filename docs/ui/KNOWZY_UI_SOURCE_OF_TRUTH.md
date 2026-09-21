# KNOWZY UI Source of Truth

## Document Purpose

This document is the authoritative UI and UX specification for KNOWZY.

KNOWZY is an EssilorLuxottica enterprise knowledge, assessment, learning, and governance platform.

This document defines:

- Product branding
- Design language
- Application layout
- Authoring Portal experience
- Live Learning Portal experience
- Evidence and governance presentation
- Reusable UI components
- Accessibility requirements
- Responsive behavior
- Implementation guardrails
- UI acceptance criteria

The approved visual mockups are stored in:

```text
design/approved/
```

The stakeholder-facing Word specification is stored in:

```text
docs/ui/KNOWZY_Master_UI_UX_Design_and_Development_Prompt.docx
```

When implementing the redesign:

- Use this Markdown document as the primary AI-readable specification.
- Use the approved images as the visual baseline.
- Use the existing repository, code, `CLAUDE.md`, and `/docs` as the functional source of truth.
- Preserve existing business logic and security controls.

---

# 1. Product Overview

## Product

**Name:** KNOWZY  
**Company:** EssilorLuxottica  
**Tagline:** Knowledge Today. Brighter Tomorrow.

KNOWZY transforms governed enterprise knowledge into traceable assessments and personalized learning experiences with minimal manual effort.

KNOWZY is not a generic quiz-generation application. It is an evidence-driven enterprise knowledge platform combining:

- Enterprise knowledge sources
- Controlled content selection
- Evidence verification
- AI-assisted question generation
- Human review
- Independent approval
- Reusable question management
- Versioned assessments
- Deterministic scoring
- Knowledge-gap analysis
- Enterprise reporting
- Governance and auditability

The core workflow is:

```text
Knowledge Sources
→ Document Selection
→ Evidence Verification
→ AI Question Generation
→ Human Review
→ Approval
→ Question Bank
→ Assessments
→ Results and Insights
```

The interface must communicate:

```text
Trusted Knowledge
+ Responsible AI
+ Human Governance
+ Enterprise Learning
```

---

# 2. Functional Source of Truth

The current KNOWZY MVP is functional and validated. The UI modernization must preserve:

- Existing API contracts
- Existing server actions and server components
- Server-side authorization and source access controls
- Evidence verification, duplicate detection, and content coverage controls
- Generation preflight
- Human approval and separation of duties
- Thirteen approval gates
- Question version history
- Idempotent Question Bank publishing
- Quiz session snapshots and per-answer persistence
- Session resume
- Deterministic scoring and topic-level results
- Knowledge-gap identification
- Answer-key protection
- Audit logging
- Existing tests, CI, and security gates

Do not redesign the backend merely to match a visual mockup.

If a mockup shows functionality that is not implemented:

1. Do not invent the functionality.
2. Do not return fabricated data.
3. Do not silently add unsupported behavior.
4. Clearly label the feature as planned, preview, unavailable, or disabled.
5. Document any required backend extension before implementation.

---

# 3. Application Structure

KNOWZY consists of two separate, independently deployable applications.

## 3.1 Authoring and Administration Portal

- Dashboard
- Knowledge Source Administration
- Document browsing
- AI Quiz Generation
- Review Queue
- Approval workflow
- Question Bank
- Assessment management
- Reports
- Governance
- User and role administration
- Platform configuration

## 3.2 Live Learning Portal

- Available assessments
- Assessment eligibility
- Starting and resuming quizzes
- One-question-at-a-time quiz execution
- Results and proficiency levels
- Topic-level performance and knowledge gaps
- Assessment history
- Knowledge refreshers
- Badges and certificates when implemented

Do not combine both applications into one website using only hidden navigation.

---

# 4. Non-Negotiable Implementation Guardrails

## 4.1 Architecture

- Do not replace the working backend architecture.
- Do not rewrite validated domain logic as frontend logic.
- Keep protected API calls server-side.
- Preserve server components and server actions where currently implemented.
- The browser must not hold authentication subject headers or directly call protected APIs when the current design routes calls through the server.
- Do not create an unnecessary CORS surface.
- Use existing shared types rather than duplicating domain models in frontend applications.

## Detailed Portal Specifications

Authoring and shared UI requirements are defined in this document.

The detailed Live Learning Portal UI specification is:

- `docs/ui/KNOWZY_LIVE_PORTAL_UI_SOURCE_OF_TRUTH.md`

Where a learner mockup conflicts with validated application behavior, the existing code, API contracts, security controls, and learner specification take precedence.

## 4.2 Security

Do not move the following into browser code:

- Authentication or authorization decisions
- Role validation or user identity resolution
- Correct answers or scoring
- Approval or publishing decisions
- Badge or certificate eligibility
- Source, Anthropic, Microsoft Graph, or database credentials
- Access or refresh tokens

## 4.3 Governance

Do not weaken:

- Human approval
- Separation of duties
- Evidence verification
- Source permission checks
- Duplicate prevention
- Approval gates
- Version control
- Idempotent publishing
- Audit logging
- Answer-key protection

## 4.4 Data

- Do not fabricate production metrics.
- Use live application data where available.
- Development-only sample data must be labeled as demo or synthetic.
- Do not present mock data as real organizational performance.
- Do not hardcode demo domains as permanent production domains.
- Production domains must come from configured platform data.

---

# 5. Brand Identity

EssilorLuxottica branding must be visible and consistent on every page. Use only approved brand assets supplied in the repository.

Do not distort logos, recreate unofficial corporate logos, use unapproved variants, or present externally generated imagery as officially approved imagery without review.

## 5.1 Product Wordmark

Display:

```text
EssilorLuxottica | KNOWZY
```

The letters `ZY` in KNOWZY should use the approved green accent.

Tagline:

```text
Knowledge Today. Brighter Tomorrow.
```

## 5.2 Color Palette

- **Deep Navy `#001E62`:** top header, product identity, primary headings
- **EssilorLuxottica Green `#00B388`:** primary actions, approval, healthy states, progress, selected navigation
- **Dark Navy Text `#08245C`:** headings, body emphasis, primary readable text
- **Primary Blue `#146EF5`:** links, information, knowledge-related elements, secondary actions
- **AI Purple `#6B4EFF`:** AI-generated content, recommendations, KNOWZY Copilot, advanced AI insights
- **Light Background `#F5F8FC`:** application canvas and secondary surfaces
- **White `#FFFFFF`:** cards, tables, panels, dialogs, content surfaces

## 5.3 Semantic Colors

- Green: success and approval
- Blue: information and knowledge
- Purple: AI
- Amber: warnings and partial attention
- Red: errors, rejection, failed gates, and critical risk

Do not rely on color alone. Pair color with text, icons, accessible labels, and status descriptions.

---

# 6. Global Visual Style

The application should combine Microsoft Fluent clarity, Copilot-style productivity, Power BI analytical discipline, premium enterprise SaaS, and EssilorLuxottica branding.

## 6.1 Required Style

- Clean white and light-gray surfaces
- Deep navy top header
- Persistent navigation
- Rounded cards
- Restrained glass effects
- Soft shadows
- Generous spacing
- Clear hierarchy
- Modern typography
- High information density without crowding
- Consistent iconography and status treatment
- Executive-level visual polish

## 6.2 Avoid

- Excessive gradients, neon colors, or heavy borders
- Dark dashboard layouts
- Excessive glass effects
- Cartoonish illustrations
- Consumer-app styling
- Oversized typography
- Decorative clutter
- Dense walls of text
- Large hero banners that reduce operational workspace unnecessarily
- Different design systems on different pages

## 6.3 Screen Targets

Primary desktop target: `1920 x 1080`

Also validate at:

- `1440 x 810`
- `1280 x 720`

Use fluid responsive layouts. Do not hardcode the browser application to a fixed 16:9 canvas. Use 16:9 only for approved mockups and demonstrations.

---

# 7. Accessibility

Target WCAG 2.2 AA.

- Keyboard-accessible navigation, tables, dialogs, drawers, and quiz answers
- Visible focus indicators and sufficient contrast
- Semantic headings, labels, landmarks, and validation messages
- Screen-reader announcements and accessible table headings
- Reduced-motion support
- Text alternatives for meaningful imagery
- Accessible chart descriptions and data alternatives
- Non-color status indicators
- Logical tab order
- Minimum 44 x 44 pixel interaction targets where practical

Refusal and error states must explain the actual issue safely. Prefer specific messages such as:

```text
Approval is unavailable because the evidence-verification gate failed.
```

---

# 8. Global Application Shell

## 8.1 Top Header

Approximate desktop height: `72 px`

### Left

- Approved EssilorLuxottica branding
- Separator
- KNOWZY wordmark
- Product tagline where appropriate

### Center

Context-aware global search, for example:

```text
Search knowledge, questions, documents...
```

Include `Ctrl + K`.

### Right

- KNOWZY Copilot entry point
- Notifications
- User avatar
- Display name
- Active role
- User menu

In development/demo mode, clearly show the current acting identity, role, and local/mock environment.

Do not represent KNOWZY Copilot as Microsoft Copilot unless formally approved. Prefer `KNOWZY Copilot` with an original approved icon treatment.

---

# 9. Authoring Portal Navigation

1. Dashboard
2. Knowledge Sources
3. AI Quiz Generation
4. Review Queue
5. Approvals
6. Question Bank
7. Assessments
8. Reports
9. Governance
10. Administration

The selected item uses a light green background, green left indicator, green icon, and dark navy text.

Display real notification counts only. Navigation visibility must respect authorization, but visual hiding is not a replacement for server-side authorization.

---

# 10. Live Learning Portal Navigation

1. Home
2. Available Assessments
3. My Learning
4. Results and History
5. Knowledge Refreshers
6. Badges and Certificates, when implemented
7. Help

The Live Learning Portal should use the same brand tokens with lower information density and simpler interactions.

---

# 11. KNOWZY Workflow Ribbon

Display a compact ribbon on Authoring Portal workflow pages:

```text
Knowledge Sources → AI Generation → Review → Approval → Question Bank → Assessments → Insights
```

- Highlight the active stage.
- Mark a stage completed only when completion is known.
- Keep future stages neutral.
- Allow navigation only when valid and authorized.
- Keep the ribbon compact.
- On smaller screens, allow horizontal scrolling or a compact representation.

---

# 12. Reusable Page Standard

## Page Heading or Hero

- Page title
- Concise purpose statement
- Optional approved EssilorLuxottica visual

Use hero photography selectively. Operational pages may use compact title bands.

## KPI Cards

Only display KPI cards when meaningful metrics exist. Do not force a fixed number onto every transactional page.

## Main Workspace

Use appropriate combinations of search, filters, tables, tabs, charts, side panels, drawers, detail views, pagination, steppers, status badges, and complete page states.

---

# 13. Dashboard

## Hero

**Title:** Turn Knowledge into Impact  
**Subtitle:** AI-powered learning. Trusted knowledge. A smarter tomorrow.

Display:

```text
Find knowledge | Generate quizzes | Build skills | Drive performance
```

## KPI Cards

- Knowledge Coverage
- Published Questions
- Assessment Readiness
- Knowledge Risk or Knowledge Gaps

## Visualizations and Panels

- Proficiency heatmap
- Knowledge coverage donut
- Assessment success trend
- Knowledge risk summary
- Workflow health
- Recent activity
- Top knowledge sources
- Quick actions

RxNet, RxCNC, VisionStar, MES 360, SAP, Azure, Infrastructure, and Service Management may be used as realistic development data, but not hardcoded as production domains.

---

# 14. Knowledge Sources

## KPI Cards

- Total Sources
- Active Sources
- Last Successful Sync
- Total Documents
- Documents Requiring Attention

## Tabs

- All Sources
- Connected
- Disconnected
- Pending
- Needs Attention

## Source Table

- Source Name
- Type
- Status
- Last Sync
- Documents
- Owner
- Scope
- Actions

## Required Capabilities

- Add, edit, activate, deactivate, archive, test, and synchronize sources
- Configure SharePoint tenant/site, library, folder, file types, metadata, mapping, authentication, and schedule
- Display individual connection checks and honest skipped checks
- Browse containers, folders, documents, and sections
- Show permissions, selectability, extraction status, content hash, version, sections, coverage, and generation history
- Hide denied or inaccessible documents from unauthorized users

---

# 15. AI Quiz Generation

Generate grounded draft questions only from explicitly selected, accessible knowledge content.

## Flow

```text
Select source and documents
→ Review coverage
→ Run preflight
→ Review recommendation
→ Record explicit action
→ Generate questions
→ Verify evidence
→ Save drafts
→ Submit for review
```

## Preflight Actions

- Generate New
- View Existing
- Reuse Existing
- Generate Additional
- Regenerate

There must be no silent proceed-anyway action.

## Three-Zone Layout

### Knowledge Context

- Selected source, documents, and sections
- Document version and content hash
- Coverage and generation history
- Existing approved questions
- Preflight results

### Generated Drafts

- Question text
- Four options
- Proposed answer
- Explanation
- Topic and type
- Draft status and edit controls

### Evidence and Governance

- Source document and section
- Exact evidence excerpt
- Source offsets/location
- Verification mode and result
- Confidence/similarity score
- Duplicate risk
- Coverage contribution
- Insufficient-evidence reasons

## Actions

- Edit
- Refine
- Regenerate where permitted
- Save Draft
- Submit for Review

Do not provide direct publishing from generation. Difficulty must not be required if the validated workflow does not use it.

---

# 16. Review Queue

## KPI Cards

- Questions in Review
- Average Review Time
- Pending My Review
- Review Completion Rate

## Tabs

- All
- My Review
- Overdue
- High Priority
- Needs Changes

## Table

- Question
- Source
- Topic
- Type
- Priority
- Status
- Assigned To
- Created On
- Evidence Status
- Duplicate Risk
- Actions

## Detail Tabs

- Question
- Evidence
- Source
- Governance
- Review History
- Version History

## Actions

- Save Changes
- Request Changes
- Reject Draft
- Submit for Approval

Evidence-sensitive edits must trigger revalidation.

---

# 17. Approvals

## KPI Cards

- Pending Approvals
- Approved This Month
- Average Approval Time
- Active Approvers
- Compliance Rate

## Tabs

- Pending
- In Progress
- Approved
- Rejected
- All

## Detail Tabs

- Details
- Preview
- Evidence
- Approval Gates
- Comments
- History

Render actual server-evaluated approval gates. Each failed gate must show its name, reason, remediation, and blocking status.

## Actions

- Request Changes
- Reject
- Approve

Approval remains a server-side, audited action, with separation of duties enforced.

---

# 18. Question Bank

## KPI Cards

- Total Questions
- Published
- Approved but Unpublished, where supported
- Retired
- Usage or Quality Indicator

## Tabs and Filters

Tabs: All, Published, Approved, Retired, Archived where applicable.

Filters: Domain, Topic, Type, Status, Source, Version, Modified Date.

## Traceability

Display:

- Source repository, document, section, and URL
- Source content hash and version
- Evidence excerpt
- Generation, review, approval, and publish dates
- Reviewer, approver, and publisher
- Question Bank item ID
- Usage count

## Provenance Timeline

```text
Generated → Reviewed → Approved → Published → Used in Assessments
```

## Actions

- View
- Retire
- Create New Version
- Use in Assessment

Do not edit a published version in place.

---

# 19. Assessments

## KPI Cards

- Total Assessments
- Total Participants
- Average Score
- Pass Rate

## Tabs

- All
- Drafts
- Scheduled
- Active
- Completed
- Retired

## Table and Details

Display assessment version, participants, score, pass rate, status, dates, pinned question pool, question versions, thresholds, attempt/retake policy, availability, and publication status.

Published releases must look visually distinct from mutable drafts.

---

# 20. Reports and Insights

Use a KNOWZY-native style inspired by Power BI and Microsoft Fabric.

## Analytics

- Assessment performance trend
- Average score, pass rate, participation rate
- Knowledge coverage by domain
- Knowledge Risk Index
- Top knowledge gaps
- Question usage
- Learner performance by authorized role/team
- Content health
- Knowledge improvement trends

## Risk Categories

- High Risk
- Moderate Risk
- Low Risk

## Filters and Exports

Filters include time period, domain, content type, learner group/team, status, and proficiency.

Only display implemented exports. Enforce data-level authorization, team scoping, privacy, minimum-group-size rules, and audit logging.

---

# 21. Governance Center

Add Governance between Reports and Administration.

Governance areas:

- Governance Dashboard
- Audit Logs
- Publishing Activity
- Review Activity
- Approval History
- Role Change History
- Knowledge Source Changes
- Content Version History
- Security Exception Status
- Policy Status
- Reconciliation Status
- Knowledge Risk Monitoring

Audit search displays actor, action, entity, timestamp, correlation ID, outcome, and appropriate failure reason.

---

# 22. Administration

Rename Settings to Administration.

## Tabs

- User Management
- Role-Based Access Control
- Knowledge Source Integrations
- Knowledge Domains
- Brand and Website Settings
- Notification Settings
- Audit Configuration
- General Configuration

Use the actual KNOWZY role catalog. Permission matrices must reflect actual server-side capabilities. All changes require authorization, confirmation, and audit recording.

---

# 23. KNOWZY Copilot

Provide a global, context-aware right-side drawer or panel.

Example prompts:

- Generate questions from selected RxNet sections.
- Show documents requiring revalidation.
- Explain why an approval gate failed.
- Find possible duplicate questions.
- Show pending approvals.
- Summarize authorized knowledge risks.
- Recommend refreshers.

KNOWZY Copilot must never bypass authorization, reveal active quiz answers, approve or publish autonomously, modify scores, invent metrics, fabricate sources/citations, expose inaccessible content, or follow instructions embedded in retrieved documents.

If not backed by an API, render it as disabled, preview, or planned. Do not fake conversational results.

---

# 24. Live Learning Portal

## Learner Home

Hero:

```text
Welcome back, <display name>
Continue building trusted knowledge.
```

Display implemented cards for proficiency, readiness, assessments due/completed, refreshers, results, badges, and certificates.

## Assessment Cards

Display assessment name, domain, question count, pass mark, attempts, time limit, eligibility, and Start/Resume action.

## Resume State

Never display `NaN` or render a stale session as resumable. Explain unavailable sessions and provide safe navigation or a new attempt only when policy permits.

---

# 25. Assessment Start Page

Display assessment title, description, domain/topics, question count, pass mark, attempt policy, time limit, availability, Start/Resume action, and eligibility/refusal reason.

Explain that questions appear one at a time, answers are saved server-side, progress can be resumed where permitted, and answers are not disclosed during the quiz.

---

# 26. Quiz Page

- One question at a time
- Question X of Y
- Progress indicator
- Accessible answer cards A-D
- Explicit submit/next action
- Double-submit prevention
- Refresh/resume
- Exit warning
- Keyboard support

Never display or send correct answers, explanations, evidence, source excerpts, live scores, answer keys, or other learners' results during an active assessment.

---

# 27. Results Page

Display total, correct, incorrect, percentage, pass/fail, proficiency, topic performance, knowledge gaps, history, approved explanations according to policy, refreshers when implemented, and deterministic badge/certificate outcomes when implemented.

---

# 28. Reusable Component System

Build shared components first:

- App Header
- Authoring Sidebar
- Learner Navigation
- Workflow Ribbon
- Page Hero
- KPI Card
- Status, Risk, Evidence, Version, and Role Badges
- Approval Gate Checklist
- Provenance Timeline
- Search and Filter Controls
- Data Table and Pagination
- Tabs, Modal, Drawer, Detail Panel
- Chart Card
- Empty, Loading, Error, and Refusal States
- Confirmation Dialog and Toast
- Permission Matrix
- Primary, Secondary, and Danger Buttons
- Question and Answer Cards
- Source Citation Card
- Coverage Indicator

Do not create separate visual rules for every page.

---

# 29. Data Visualization

Use KPI cards, donut charts, horizontal bars, line/area charts, columns, heatmaps, and progress bars.

Avoid 3D charts, decorative charts, unlabeled axes, inconsistent palettes, hidden denominators, and color-only legends.

Charts require an accessible name, text summary, tooltip, legend, and data alternative where practical.

---

# 30. Responsive Behavior

- Desktop targets: 1920 x 1080, 1440 x 810, 1280 x 720
- Tables may scroll or reduce columns responsively
- Detail panels become drawers
- Navigation never overlaps content
- Workflow ribbon may scroll horizontally
- Charts resize without clipping
- KPI cards wrap consistently
- Filters may collapse into a drawer
- Authoring may remain desktop-focused
- Learner quiz flows should remain usable on tablet/mobile unless explicitly deferred

---

# 31. Page States

Every major page supports:

- Loading
- Empty
- Success
- Warning
- Validation Error
- Permission Refusal
- Service Unavailable
- Stale Data
- Stale Session
- No Results
- Pagination/Large Dataset

Messages must be actionable without exposing credentials, secrets, stack traces, answer keys, inaccessible content, or sensitive authorization details.

---

# 32. Technology Requirements

Use the existing Next.js, React, TypeScript, Tailwind CSS, Server Components, Server Actions, shared packages, and API structure.

Use Lucide or approved Fluent-style icons consistently and Recharts or the existing chart library. Do not add another styling framework without a documented reason.

---

# 33. Testing Requirements

Add browser-level tests for critical workflows.

## Authoring

- Source connection and synchronization
- Document selection
- Preflight and decision recording
- Draft generation and claim
- Question edit
- Submit for approval
- Gate refusal
- Independent approval
- Publishing

## Live Learning

- Learner access and manager refusal
- Assessment opening and quiz start
- Answer submission
- Refresh and resume
- Final scoring and results
- Stale-session recovery
- No answer-key exposure

Also run formatting, lint, type checking, boundaries, unit/integration tests, build validation, Prisma drift validation, audit/security gates, and image validation where configured.

---

# 34. Content Rules

Use realistic enterprise terminology but no lorem ipsum, generic sample labels, unlabeled fake metrics, or unapproved personal information.

Use approved synthetic users for local development and label persona switching as:

```text
Local Development Identity
```

---

# 35. Delivery Sequence

1. Inspect `CLAUDE.md`, `/docs`, routes, server actions, APIs, tests, mockups, and both current portals.
2. Create `docs/ui/ui-modernization-plan.md` with route inventory, behavior, proposed components, tokens, unsupported features, required extensions, risks, testing, and commits.
3. Implement shared tokens and components.
4. Modernize the Authoring shell.
5. Modernize Dashboard, Knowledge Sources, AI Generation, Review, Approvals, Question Bank, Assessments, Reports, Governance, and Administration in that order.
6. Modernize Learner Home, Assessment Detail, Quiz, Resume, Results, History, and Refreshers when implemented.
7. Add critical browser tests.
8. Perform visual QA at all target sizes.
9. Run full repository verification and security gates.
10. Commit each coherent milestone separately.

---

# 36. Acceptance Criteria

The redesign is complete only when:

1. Existing MVP workflows remain functional.
2. Both portals use approved EssilorLuxottica branding.
3. All Authoring pages use one coherent design system.
4. The Live Portal uses the same brand with a simpler learner experience.
5. AI generation shows document selection, preflight, evidence, and draft status.
6. Review displays evidence, source traceability, duplicate risk, and version history.
7. Approval displays actual server-evaluated gates and precise refusal reasons.
8. Separation of duties remains enforced.
9. Question Bank displays provenance and versions.
10. Published questions are not edited in place.
11. Assessments display pinned question versions.
12. Active quizzes never expose answers.
13. Session resume works correctly and stale sessions never show `NaN`.
14. All actions enforce server-side authorization.
15. No fake production metrics or fabricated citations are presented.
16. Critical browser workflows have automated tests.
17. Accessibility requirements are validated.
18. Existing tests and security gates pass.
19. The final application is suitable for enterprise leadership demonstration.

---

# 37. Final Quality Bar

KNOWZY must feel premium, trustworthy, intelligent, modern, accessible, governed, traceable, and enterprise-ready.

The benchmark is:

```text
Microsoft Fluent clarity
+ Copilot-style productivity
+ Power BI analytical discipline
+ EssilorLuxottica branding
+ KNOWZY evidence-driven governance
```

Users must immediately understand:

> KNOWZY converts enterprise knowledge into evidence-grounded, human-approved, reusable assessments and measurable learning outcomes.

---

# 38. Final Instruction to Claude

Treat:

- The existing repository as the functional source of truth.
- `CLAUDE.md` and `/docs` as the architectural source of truth.
- This file as the AI-readable UI source of truth.
- The approved mockups as the visual source of truth.

Do not change working business behavior merely to match a mockup.

Do not implement fake functionality.

Do not weaken security, evidence, approval, or publishing controls.

Do not rewrite every page simultaneously.

First create the UI modernization plan and route-to-component map.

Then implement incrementally, validate every route, add browser tests for critical workflows, run the full repository verification, and commit each completed milestone.
