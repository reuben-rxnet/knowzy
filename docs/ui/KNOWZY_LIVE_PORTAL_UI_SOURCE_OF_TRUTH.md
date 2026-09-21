# KNOWZY Live Learning Portal UI Source of Truth

## Document Purpose

This document is the authoritative AI-readable UI and UX specification for the KNOWZY Live Learning Portal.

It supplements:

- `CLAUDE.md`
- `docs/ui/KNOWZY_UI_SOURCE_OF_TRUTH.md`
- Existing architecture and product documents under `docs/`
- Existing Live Learning Portal code and routes
- Existing API contracts, server actions, tests, and security controls

The current repository remains the functional source of truth.

The approved learner mockups are the visual source of truth.

This file defines how Claude must interpret those mockups without inventing unsupported functionality or weakening the validated KNOWZY MVP.

---

# 1. Approved Visual References

Store the approved learner mockups under:

```text
design/approved/live-portal/
```

Expected files:

```text
design/approved/live-portal/learner-home-page.png
design/approved/live-portal/my-learnings.png
design/approved/live-portal/assessments.png
design/approved/live-portal/discover.png
design/approved/live-portal/badges.png
design/approved/live-portal/knowledge-library.png
design/approved/live-portal/my-progress.png
design/approved/live-portal/help-and-support.png
```

Visual-reference mapping:

| Approved image | Intended destination | Implementation classification |
|---|---|---|
| `learner-home-page.png` | Learner home dashboard | Modernize existing Live Portal home route |
| `assessments.png` | Available assessments and assessment history | Modernize existing assessment discovery route |
| `my-learnings.png` | Learning assignments, in-progress learning, recommendations | Full-solution capability; may require new models and routes |
| `discover.png` | Personalized discovery across learning and assessments | Full-solution capability; requires catalog and recommendation APIs |
| `badges.png` | Badges, certificates, achievement level | Full-solution capability; requires deterministic recognition services |
| `knowledge-library.png` | Unified learning-resource catalog | Full-solution capability; requires source/catalog aggregation |
| `my-progress.png` | Learner analytics and progress | Partly derivable from assessment data; broader learning metrics require extensions |
| `help-and-support.png` | Help center, support channels, Copilot entry point | Full-solution capability; requires approved support integrations and content |

Do not assume every action shown in a mockup already works.

Before implementation, classify each visible control as:

- `IMPLEMENTED`
- `PARTIALLY_IMPLEMENTED`
- `PLANNED`
- `REQUIRES_BACKEND_EXTENSION`
- `DISABLED_IN_CURRENT_RELEASE`

Do not implement fake actions or fabricated data to make a screenshot appear complete.

---

# 2. Product Goal

The KNOWZY Live Learning Portal is the learner-facing application for enterprise knowledge validation, growth, and continuous learning.

The learner journey is:

```text
Discover
→ Learn
→ Assess
→ Understand Results
→ Refresh Knowledge
→ Improve
→ Earn Recognition
```

The currently validated MVP covers:

```text
Discover Published Assessment
→ Check Eligibility
→ Start or Resume Quiz
→ Answer One Question at a Time
→ Complete Assessment
→ Receive Deterministic Score
→ View Topic-Level Results and Knowledge Gaps
```

The full-solution learner vision additionally includes:

- Assigned and self-selected learning
- External and internal learning-resource catalogs
- Personalized recommendations
- Learning paths
- Progress tracking across courses and assessments
- Knowledge refreshers
- Badges and certificates
- Help and support
- KNOWZY Copilot

The interface must clearly distinguish validated current capabilities from future capabilities.

---

# 3. Non-Negotiable Functional Guardrails

The learner redesign must preserve:

- Server-side authentication and authorization
- Server-side identity resolution
- Assessment eligibility checks
- Published-assessment-only access
- Server-side quiz session snapshots
- Pinned question IDs and versions
- One-question-at-a-time delivery
- Per-answer persistence
- Duplicate-answer prevention
- Session refresh and resume
- Deterministic backend scoring
- Configured pass and proficiency thresholds
- Topic-level results
- Knowledge-gap calculation
- Assessment history
- Answer-key protection
- Audit logging
- Existing refusal behavior

During an active quiz, never send or display:

- Correct answers
- Explanations
- Evidence excerpts
- Source documents
- Live scores
- Answer keys
- Other learners' results

Do not move scoring, eligibility, authorization, badge decisions, certificate decisions, or recommendation authorization into browser code.

Do not create direct browser-to-protected-API calls if the existing Live Portal uses server components and server actions.

---

# 4. Brand and Visual Design

Use the shared KNOWZY design tokens from:

```text
docs/ui/KNOWZY_UI_SOURCE_OF_TRUTH.md
```

Core palette:

- Deep Navy: `#001E62`
- EssilorLuxottica Green: `#00B388`
- Dark Navy Text: `#08245C`
- Primary Blue: `#146EF5`
- AI Purple: `#6B4EFF`
- Light Background: `#F5F8FC`
- White: `#FFFFFF`

Use approved EssilorLuxottica brand assets only.

The Live Portal must share the KNOWZY visual identity with the Authoring Portal while providing:

- Simpler navigation
- Lower information density
- Larger learning cards
- Clear progress indicators
- Motivational but professional language
- Accessible quiz interactions
- Clear next actions
- Personal information visible only to the authenticated learner or an authorized role

Do not use the Microsoft Copilot name or logo as if KNOWZY Copilot were a Microsoft product unless formally approved.

---

# 5. Global Live Portal Shell

## 5.1 Header

Display:

- Approved EssilorLuxottica logo
- KNOWZY wordmark
- Tagline where space permits
- Context-aware search
- KNOWZY Copilot entry point
- Notifications
- Learner avatar
- Learner display name
- Current role
- Account menu

In local development, identify persona switching clearly as:

```text
Local Development Identity
```

Do not present synthetic identities as real employees.

## 5.2 Learner Navigation

Approved navigation:

1. Home
2. My Learnings
3. Assessments
4. Discover
5. Badges
6. Knowledge Library
7. My Progress
8. Help & Support

Navigation rules:

- Show only authorized and released destinations.
- Mark planned destinations as preview only when product owners explicitly want them visible.
- Otherwise hide unreleased destinations.
- Do not create dead links.
- Do not rely on navigation hiding as the authorization control.

## 5.3 Global Search

The search placeholder should reflect implemented scope.

Examples:

- Current MVP: `Search assessments and topics...`
- Full catalog release: `Search courses, assessments, knowledge, and skills...`

Do not claim global knowledge search until the required retrieval APIs and access trimming exist.

---

# 6. Learner Home Page

Approved reference:

```text
design/approved/live-portal/learner-home-page.png
```

## 6.1 Purpose

Provide a personalized overview of the learner's current progress, available assessments, knowledge gaps, recommendations, and recognition.

## 6.2 Hero

Example:

```text
Welcome back, <display name>
Continue your learning journey.
Build skills. Complete assessments. Grow together.
```

Use approved, inclusive brand imagery.

## 6.3 Current MVP Cards

Use real data for:

- Available assessments
- Assessments completed
- Current average or latest score, if well-defined
- Current proficiency level, if derivable from verified results
- In-progress quiz session
- Upcoming or assigned assessments, if assignment data exists
- Recent results
- Knowledge gaps based on completed assessments

## 6.4 Full-Solution Cards

These require explicit backend support:

- Learning progress across courses
- Badges earned
- Learning paths
- Recommended learning content
- Knowledge level across sources
- Learning journey stages
- Upcoming learning calendar

If unsupported, do not fabricate percentages, courses, badges, or dates.

## 6.5 Resume Safety

The page must never display invalid progress such as:

```text
NaN / undefined
```

If a stored session is stale, missing, expired, or belongs to another identity:

- Do not render a Resume link.
- Explain that the previous session is unavailable.
- Offer a safe return to assessments.
- Offer a new attempt only when policy permits.

---

# 7. My Learnings

Approved reference:

```text
design/approved/live-portal/my-learnings.png
```

## 7.1 Purpose

Provide one place for assigned, in-progress, completed, recommended, and bookmarked learning activities.

## 7.2 Required Full-Solution Data Model

Before implementing this page fully, confirm models and APIs for:

- LearningItem
- Course
- LearningPath
- Module
- Enrollment or Assignment
- LearnerProgress
- Bookmark
- LearningCalendarEvent
- CompletionRecord
- Recommendation
- ExternalCatalogReference

Do not reinterpret assessments as courses merely to populate this page.

## 7.3 Tabs

- In Progress
- Completed
- Recommended
- Bookmarks

## 7.4 Learning Item Card

Display when supported:

- Title
- Source
- Domain
- Skill level
- Duration
- Module count
- Progress
- Assignment status
- Due date
- Continue or Start action

## 7.5 Calendar

Only show calendar events when backed by actual assignment, event, or schedule data.

Do not fabricate sessions, office hours, or join links.

---

# 8. Assessments

Approved reference:

```text
design/approved/live-portal/assessments.png
```

## 8.1 Purpose

Allow learners to discover, start, resume, and review assessments.

## 8.2 KPI Cards

Use verified data for:

- Total eligible or visible assessments
- Completed assessments
- Pending or assigned assessments
- Average score
- Pass rate

Define each metric precisely. Do not mix assessment availability with assigned assessments.

## 8.3 Tabs

- All Assessments
- Assigned to Me, if supported
- In Progress
- Completed

## 8.4 Assessment Card or Row

Display:

- Assessment name
- Description
- Domain
- Question count
- Estimated duration, only when configured or calculated transparently
- Pass mark
- Attempt status
- Eligibility state
- Start or Resume action

## 8.5 Right-Side Panels

Use verified data for:

- Learner assessment progress
- Recent results
- Recommended assessments, only when recommendation logic exists

## 8.6 Refusal States

Display the precise reason an assessment is not startable, including:

- Not eligible
- Not yet available
- Availability expired
- Attempt limit reached
- Existing session conflict
- Prerequisite missing
- Unauthorized domain

---

# 9. Assessment Detail and Start

This page may not have a separate approved mockup, but remains required by the existing routes.

Display:

- Assessment name and description
- Domain and topics
- Question count
- Pass threshold
- Proficiency thresholds where appropriate
- Attempt limit and attempts used
- Retake policy
- Time limit, if configured
- Availability
- Start or Resume action
- Clear eligibility or refusal reason

Explain:

- Questions are presented one at a time.
- Answers are saved server-side.
- Progress may be resumed where policy permits.
- Correct answers are not shown during the active assessment.

---

# 10. Quiz Session

The quiz page is part of the Live Portal even though the approved design set focuses on surrounding learner pages.

Requirements:

- Question X of Y
- Progress bar
- Clear question text
- Accessible answer cards for A, B, C, D
- Explicit Submit or Next behavior
- Double-submit prevention
- Keyboard support
- Refresh and resume
- Exit or abandon warning
- Clear expired-session handling

Never expose the answer key in HTML, serialized props, browser state, logs, error messages, or network payloads during the active quiz.

---

# 11. Results and History

The results page is required by the validated MVP.

Display:

- Total Questions
- Correct Answers
- Incorrect Answers
- Percentage Score
- Pass or Fail
- Proficiency Level
- Topic-Level Accuracy
- Knowledge Gaps
- Assessment Version
- Completion Date
- Attempt Number
- Approved explanations according to policy
- Recommended refreshers when implemented

Do not reveal additional protected content merely because the assessment is complete. Follow the configured review policy.

---

# 12. Discover

Approved reference:

```text
design/approved/live-portal/discover.png
```

## 12.1 Purpose

Provide personalized discovery across courses, assessments, learning paths, knowledge articles, videos, and interactive resources.

## 12.2 Prerequisites

Before full implementation, confirm:

- Unified catalog model
- Search API
- Access-trimmed source retrieval
- Content-type taxonomy
- Skill-level taxonomy
- Duration metadata
- Recommendation engine
- Bookmarking
- Click-through/deep-link rules
- External catalog governance

## 12.3 Discovery Topics

Topics and domains must come from configured data, not hardcoded mockup labels.

## 12.4 Recommendations

Recommendations must state why an item is recommended when possible, for example:

- Based on knowledge gap
- Based on assigned role
- Based on incomplete learning path
- Based on assessment result

Do not fabricate personalized recommendations.

---

# 13. Knowledge Library

Approved reference:

```text
design/approved/live-portal/knowledge-library.png
```

## 13.1 Purpose

Provide a permission-trimmed unified catalog of approved internal and external learning resources.

## 13.2 Potential Sources

Sources shown in the design, such as SharePoint, Confluence, Microsoft Learn, Udemy, LinkedIn Learning, Leonardo, and other repositories, are visual examples only.

Each source requires:

- Approved enterprise integration
- Authentication and authorization
- Metadata normalization
- Access trimming
- Deep-link policy
- Source health monitoring
- Licensing validation where applicable

Do not imply a source is connected until configured and verified.

## 13.3 Catalog Capabilities

- Grid and list view
- Search
- Source filter
- Domain filter
- Content-type filter
- Skill-level filter
- Recommended tab
- Recently Added tab
- Most Popular tab, only with valid usage analytics
- Bookmarks
- Source attribution
- Content duration

## 13.4 Security

The knowledge library must not expose inaccessible document titles, thumbnails, descriptions, or links.

---

# 14. Badges and Certifications

Approved reference:

```text
design/approved/live-portal/badges.png
```

## 14.1 Purpose

Recognize verified learning and assessment achievements.

## 14.2 Deterministic Rules

Badges and certificates must be awarded by deterministic backend rules, not Claude.

Required models and services may include:

- BadgeDefinition
- BadgeRule
- UserBadge
- CertificateDefinition
- Certificate
- CertificateVerification
- Revocation
- Expiry
- ExternalCertification
- PointsLedger, only if points are approved
- AchievementLevel, only if formally defined

## 14.3 Supported Displays

When implemented:

- Earned badges
- Locked badge targets
- Progress toward badges
- Issued certificates
- Certificate expiry
- Certificate verification
- Revoked certificate state
- External certifications with verification status

Do not display invented points, ranks, achievement levels, streaks, or certifications.

## 14.4 Certificate Security

Certificates must use:

- Server-side generation
- Unique certificate ID
- Verification code or URL
- Authorization checks
- Revocation support
- Versioned assessment reference

---

# 15. My Progress

Approved reference:

```text
design/approved/live-portal/my-progress.png
```

## 15.1 Purpose

Provide a learner-owned view of verified progress over time.

## 15.2 Current Assessment Metrics

The current MVP may support:

- Assessments completed
- Assessment scores
- Pass rate
- Topic performance
- Proficiency level
- Knowledge gaps
- Attempt history

## 15.3 Full Learning Metrics

The following require course and learning-path models:

- Courses completed
- Learning hours
- Overall course completion
- Domain learning journey
- Learning streak
- Learning milestones
- Upcoming learning
- Combined course and assessment activity

## 15.4 Metric Integrity

Every metric must define:

- Source
- Time period
- Denominator
- Calculation rule
- Whether it includes courses, assessments, or both

Do not merge unlike metrics merely to match the mockup.

---

# 16. Help and Support

Approved reference:

```text
design/approved/live-portal/help-and-support.png
```

## 16.1 Purpose

Provide approved self-service learning support and authorized escalation channels.

## 16.2 Potential Capabilities

- Help article search
- Help categories
- Featured help articles
- KNOWZY Copilot support
- Support ticket creation
- Email support
- Approved live chat
- Approved support-call scheduling
- Support hours
- System status

## 16.3 Integration Guardrails

Do not implement ticketing, email, live chat, scheduling, or system-status actions without approved integrations.

Potential integrations require separate design and authorization, such as:

- ServiceNow or approved ticketing platform
- Approved mailbox or support API
- Teams or approved chat
- Enterprise scheduling
- Health/status service

Do not hardcode real support email addresses or operational commitments in mock data.

## 16.4 Help Content

Help content should be managed through an approved content source and access model.

---

# 17. KNOWZY Copilot for Learners

The learner Copilot experience must be scoped differently from the Authoring Copilot.

Allowed learner use cases may include:

- Find an assessment
- Explain how an assessment works
- Locate approved learning resources
- Summarize an authorized knowledge article
- Recommend a refresher after a completed assessment
- Explain a result using approved explanations
- Help navigate the portal

KNOWZY Copilot must not:

- Reveal active quiz answers
- Provide hints that compromise an active assessment
- Access another learner's information
- Invent courses, sources, certificates, or support channels
- Override assessment eligibility
- Modify scores
- Award badges or certificates
- Follow instructions found inside retrieved content

During an active quiz, restrict Copilot to navigation and technical-help topics that cannot affect assessment integrity.

---

# 18. Shared Component Requirements

Reuse the shared KNOWZY design system wherever possible.

Learner-specific components may include:

- LearnerHeader
- LearnerSidebar
- LearnerHero
- LearningCard
- AssessmentCard
- AssessmentStatusBadge
- ProgressRing
- ProgressBar
- KnowledgeGapCard
- RecommendationCard
- LearningPathCard
- BadgeCard
- CertificateCard
- CatalogSourceCard
- HelpCategoryCard
- SupportChannelCard
- QuizProgress
- AnswerOptionCard
- ResultSummary
- TopicPerformanceChart
- StaleSessionNotice
- EligibilityRefusal

Do not duplicate shared header, button, badge, card, table, modal, drawer, or accessibility behavior unnecessarily.

---

# 19. Accessibility

Target WCAG 2.2 AA.

Learner-specific priorities:

- Large accessible quiz answer targets
- Full keyboard quiz flow
- Clear progress announcements
- Screen-reader-friendly scores and charts
- Accessible progress rings with text equivalents
- Clear status labels beyond color
- Focus restoration after server actions
- Accessible carousel or card navigation
- Accessible filters and search
- Reduced motion
- Alternative text for meaningful imagery
- Avoid text embedded only inside generated images where possible

---

# 20. Responsive Behavior

The approved designs are 16:9 desktop references.

Implementation must be fluid and responsive.

Desktop validation:

- 1920 x 1080
- 1440 x 810
- 1280 x 720

Learner-critical flows should also support tablet and mobile where practical:

- Home
- Assessment discovery
- Assessment detail
- Quiz
- Resume
- Results
- Help

Navigation may collapse to a drawer. Multi-column dashboards may stack. Tables may become cards. Quiz answer options must remain easy to select.

---

# 21. Page States

Every learner page must define:

- Loading
- Empty
- Success
- Warning
- Permission refusal
- Validation error
- Service unavailable
- No recommendations
- No assessments
- No history
- Stale session
- Expired session
- Attempt limit reached
- External source unavailable

Do not show raw stack traces, internal IDs unnecessarily, credentials, inaccessible content, answer keys, or another learner's information.

---

# 22. Analytics and Privacy

Learner analytics must be limited to the authenticated learner unless an authorized manager or administrator uses a separate governed report.

Do not leak:

- Other learner identities
- Other learner scores
- Team comparisons not authorized for learners
- Hidden ranking
- Sensitive performance data

Recommendation and progress analytics must be explainable and based on approved data.

---

# 23. Required Repository Updates

## 23.1 Add Approved Images

Create:

```text
design/approved/live-portal/
```

Add:

```text
learner-home-page.png
my-learnings.png
assessments.png
discover.png
badges.png
knowledge-library.png
my-progress.png
help-and-support.png
```

## 23.2 Add This File

Save as:

```text
docs/ui/KNOWZY_LIVE_PORTAL_UI_SOURCE_OF_TRUTH.md
```

## 23.3 Update Main UI Source

In:

```text
docs/ui/KNOWZY_UI_SOURCE_OF_TRUTH.md
```

Add a reference to this document as the detailed Live Learning Portal specification.

## 23.4 Update CLAUDE.md

Add:

```markdown
### Live Learning Portal UI

Detailed learner UI specification:

- `docs/ui/KNOWZY_LIVE_PORTAL_UI_SOURCE_OF_TRUTH.md`

Approved learner visual references:

- `design/approved/live-portal/learner-home-page.png`
- `design/approved/live-portal/my-learnings.png`
- `design/approved/live-portal/assessments.png`
- `design/approved/live-portal/discover.png`
- `design/approved/live-portal/badges.png`
- `design/approved/live-portal/knowledge-library.png`
- `design/approved/live-portal/my-progress.png`
- `design/approved/live-portal/help-and-support.png`

The existing Live Portal code is the functional source of truth.
The learner Markdown specification is the detailed AI-readable UX source of truth.
The images are visual references only.
Do not implement fake functionality to match a mockup.
```

## 23.5 Update UI Modernization Plan

Update:

```text
docs/ui/ui-modernization-plan.md
```

Add:

- Live route inventory
- Mockup-to-route mapping
- Current MVP coverage
- Required full-solution backend extensions
- Learner design-system components
- Accessibility plan
- Browser test plan
- Delivery milestones

## 23.6 Add an Implementation Matrix

Create:

```text
docs/ui/live-portal-capability-matrix.md
```

For every visible feature, record:

| Feature | Mockup page | Current route | Backend support | Status | Required extension | Release milestone |
|---|---|---|---|---|---|---|

Use status values:

- `IMPLEMENTED`
- `PARTIALLY_IMPLEMENTED`
- `PLANNED`
- `REQUIRES_BACKEND_EXTENSION`
- `DISABLED_IN_CURRENT_RELEASE`

---

# 24. Recommended Delivery Milestones

## LIVE-UI-M1: Learner Shell and Existing MVP Routes

- Shared learner header and navigation
- EssilorLuxottica/KNOWZY branding
- Responsive learner shell
- Home page using only real assessment data
- Assessment list
- Assessment detail
- Quiz
- Resume
- Results
- Stale-session handling
- Browser tests for existing MVP

## LIVE-UI-M2: Assessment History and Progress

- My Progress using verified assessment data
- Assessment history
- Topic trends
- Knowledge-gap visualization
- No course metrics until course models exist

## LIVE-FULL-M1: Learning Catalog Foundation

- Unified catalog domain model
- Source adapters for approved learning sources
- Access-trimmed search
- Content metadata normalization
- Deep-link governance

## LIVE-FULL-M2: My Learnings

- Assignments/enrollments
- Course and module progress
- Bookmarks
- Learning paths
- Calendar/schedule support

## LIVE-FULL-M3: Discover and Knowledge Library

- Search
- Filters
- Personalized and explainable recommendations
- Catalog browsing
- Source attribution

## LIVE-FULL-M4: Badges and Certificates

- Deterministic badge rules
- Certificate generation and verification
- Revocation and expiry
- External certification workflow if approved

## LIVE-FULL-M5: Help and Support

- Help content source
- Search
- Approved support-ticket integration
- Approved email/chat/scheduling integrations
- System status

## LIVE-FULL-M6: Learner Copilot

- Context-aware learning assistance
- Assessment-integrity restrictions
- Grounded recommendations
- Safe support and navigation help

---

# 25. Browser Test Requirements

At minimum automate:

## Existing MVP

1. Learner identity selection in local mode
2. Assessment list rendering
3. Eligibility refusal
4. Start assessment
5. Answer submission
6. Refresh and resume
7. Complete assessment
8. Deterministic result rendering
9. Topic-level gaps
10. Stale-session recovery
11. No answer-key exposure

## Full-Solution Features When Implemented

1. Search and filter catalog
2. Bookmark resource
3. Start/continue learning item
4. Learning progress update
5. Recommendation explanation
6. Badge award from deterministic rule
7. Certificate verification
8. Help article search
9. Support escalation authorization
10. Copilot assessment-integrity restrictions

---

# 26. Acceptance Criteria

The Live Portal modernization or expansion is acceptable only when:

1. Existing quiz workflows remain functional.
2. The learner portal uses approved EssilorLuxottica/KNOWZY branding.
3. The interface is simpler than the Authoring Portal.
4. Existing MVP routes use real application data.
5. Unsupported mockup features are not presented as working.
6. Active quizzes never expose answers or hints.
7. Stale sessions are handled safely.
8. Scores remain deterministic and server-side.
9. Learners see only their own authorized data.
10. Catalog resources are permission-trimmed.
11. Recommendations are explainable and grounded.
12. Badges and certificates are deterministic and verifiable.
13. Help channels are approved and real before activation.
14. Core learner flows have browser-level tests.
15. Accessibility and responsive checks pass.
16. Existing repository verification and security gates pass.

---

# 27. Final Instruction to Claude

Treat:

- Existing Live Portal code and APIs as the functional source of truth.
- `CLAUDE.md` and `/docs` as the architecture source of truth.
- `docs/ui/KNOWZY_UI_SOURCE_OF_TRUTH.md` as the shared UI source of truth.
- This file as the detailed learner UI source of truth.
- The learner mockups as visual references.

Do not implement the full set of mockup capabilities in one change.

First inspect the repository and create or update the capability matrix and modernization plan.

Then modernize the validated MVP learner routes before adding new learning catalog, recognition, help, or Copilot capabilities.

Any new full-solution capability must include:

- Domain model
- API and authorization design
- Audit behavior
- Data privacy controls
- UI states
- Accessibility
- Browser tests
- Migration and rollback plan
- Focused commit
