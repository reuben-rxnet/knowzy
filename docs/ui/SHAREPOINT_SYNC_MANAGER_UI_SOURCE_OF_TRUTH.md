# SharePoint Sync Manager UI Source of Truth

## Purpose

SharePoint Sync Manager is a dedicated workflow-management application used to configure, monitor, schedule, and execute SharePoint synchronization workflows.

It is designed to support enterprise content synchronization scenarios and can be used alongside KNOWZY where document ingestion, migration, synchronization, archival, or replication is required.

The Sync Manager is responsible for:

- Workflow configuration
- Source and destination management
- Scheduling
- Monitoring
- Operational visibility
- Synchronization governance

The Sync Manager is NOT responsible for:

- Knowledge extraction
- Question generation
- Learning workflows
- Assessments
- Badges
- Certificates

Synchronization is handled by backend services.

The UI is responsible only for:

- Workflow administration
- Monitoring
- Reporting status
- Scheduler management

---

# Product Design Principles

The design must feel like:

- Microsoft Fluent UI
- Power Automate
- Azure Portal
- Enterprise SaaS

The application should feel:

- Modern
- Professional
- Operational
- Clean
- Highly usable

Avoid:

- Excessive dashboards
- Decorative graphics
- Unnecessary complexity
- Marketing-style visuals

---

# Layout

## General Layout

Single-page application.

No left navigation rail.

Everything should exist on a single operational dashboard.

Responsive 16:9 layout.

Optimized for:

```text
1920 × 1080
1440 × 900
1280 × 720
```

Use:

- White backgrounds
- Soft gray borders
- Light Fluent UI styling
- Moderate card radius
- Subtle shadows

---

# Color Palette

Primary Blue

```text
#146EF5
```

Success Green

```text
#00B388
```

Warning

```text
#F59E0B
```

Error

```text
#DC2626
```

Text

```text
#08245C
```

Background

```text
#F5F8FC
```

---

# Header

Display:

- SharePoint Sync Manager logo
- Product name
- Connection status
- Last sync check
- Notifications
- Settings
- Help
- User profile

Connection Status Example:

```text
Connected
Last Checked:
Sep 16 2026 12:24 PM
```

Status colours:

Green
Connected

Amber
Warning

Red
Disconnected

---

# Main Dashboard

The dashboard contains:

1. KPI Summary
2. Workflow Actions
3. Workflow Management Table
4. Recent Activity Feed

All visible simultaneously.

No separate pages.

---

# KPI Summary

Cards:

## Total Workflows

Display:

- Total workflows
- Active workflows

## Successful Syncs

Display:

- Successful synchronizations
- Last 30 days

## Failed Syncs

Display:

- Failed synchronizations
- Last 30 days

## Pending Syncs

Display:

- Scheduled jobs pending execution

KPIs must use actual backend data.

Do not fabricate values.

---

# Action Bar

Buttons:

## New Workflow

Opens workflow wizard.

## Sync All

Triggers synchronization of all active workflows.

## Refresh

Refreshes workflow state.

Use real backend actions.

Do not create fake actions.

---

# Workflow Table

The workflow table is the main operational surface.

Columns:

| Column |
|----------|
| Workflow Name |
| Source Site |
| Source Library |
| Destination Site |
| Destination Library |
| Schedule |
| Last Run |
| Status |
| Actions |

Use:

- Sorting
- Filtering
- Search

Status values:

- Success
- Running
- Failed
- Paused
- Scheduled
- Disabled

Use clear badges.

---

# Workflow Actions

Every row should expose:

## Sync Now

Trigger immediate synchronization.

## Edit

Open workflow editor.

## Delete

Delete workflow.

Requires confirmation.

## Pause

Pause workflow.

## Resume

Resume workflow.

Only show when paused.

---

# Workflow Creation Wizard

Open in a modal.

Multi-step workflow.

Steps:

1. Basic Information
2. Source
3. Destination
4. Options
5. Schedule
6. Review

---

# Basic Information

Fields:

- Workflow Name
- Description

---

# Source Configuration

Fields:

- Source Site
- Source Library
- Source Folder

Provide validated pickers where possible.

Avoid free-form entry if source catalogs exist.

---

# Destination Configuration

Fields:

- Destination Site
- Destination Library
- Destination Folder

---

# Synchronization Options

Options:

- One-Way Sync
- Two-Way Sync
- Include Subfolders
- Sync Metadata
- Sync Deletes

Use real toggle controls.

Do not use SVGs as controls.

---

# Scheduling

Options:

- Manual
- Hourly
- Daily
- Weekly
- Monthly

Display next run.

Display timezone.

---

# Monitoring Dashboard

Monitoring must display real workflow state.

Metrics:

- Total Workflows
- Successful Syncs
- Failed Syncs
- Pending Syncs

Use:

- KPI cards
- Status indicators

Avoid:

- 3D charts
- Decorative dashboards

---

# Recent Activity

Display recent synchronization events.

Examples:

```text
Workflow completed successfully

Workflow failed

Workflow paused

Workflow resumed

Workflow scheduled
```

Show:

- Status icon
- Workflow
- Message
- Timestamp

---

# Components

Create reusable components:

```text
<WorkflowCard />
<WorkflowTable />
<WorkflowStatusBadge />
<WorkflowActionMenu />
<SyncSummaryCard />
<ActivityFeed />
<WorkflowWizard />
<WorkflowWizardStep />
<SourceSelector />
<LibrarySelector />
<ScheduleSelector />
```

Reuse components.

Do not create duplicate implementations.

---

# Accessibility

Use:

- Semantic tables
- Semantic buttons
- Accessible dialogs
- Keyboard navigation
- Focus states
- ARIA where required

Do not replace controls with images.

Any icon assets should be:

Decorative:

```html
alt=""
```

Informational:

Use meaningful labels.

---

# Performance

Prefer:

- SVG assets
- Lazy loading
- Data pagination
- Efficient table rendering

Avoid:

- Large images
- Unnecessary animations
- Heavy client-side state

---

# Verification

After implementation verify:

- Workflow creation
- Workflow editing
- Workflow deletion
- Pause
- Resume
- Sync Now
- Sync All
- Scheduling
- Activity Feed
- Status updates

Run:

```text
lint
typecheck
tests
build
npm run verify
```

---

# Acceptance Criteria

The milestone is complete only when:

1. Workflow management works.
2. Scheduling works.
3. Monitoring displays real data.
4. Actions use real backend integrations.
5. Access controls are enforced.
6. Accessibility passes.
7. Responsive validation passes.
8. No broken asset paths.
9. Build passes.
10. Verification passes.

---

# Final Instruction

Treat the approved image:

```text
design/approved/sharepoint-sync-manager/sharepoint-sync-manager-dashboard.png
```

as the visual source of truth.

Treat this document as the AI-readable source of truth.

Do not create functionality that does not exist.

Do not fabricate workflow metrics.

Preserve enterprise usability, accessibility, and operational clarity.