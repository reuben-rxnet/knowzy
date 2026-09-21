# KNOWZY Design Asset Integration and UI Polish

## Document Purpose

This document is the authoritative implementation specification for integrating the approved KNOWZY Design Elements Asset Pack into the existing KNOWZY applications.

The asset pack is already available at:

```text
design/approved/knowzy_design_elements_asset_pack/
```

This document supplements:

- `CLAUDE.md`
- `docs/ui/KNOWZY_UI_SOURCE_OF_TRUTH.md`
- `docs/ui/KNOWZY_LIVE_PORTAL_UI_SOURCE_OF_TRUTH.md`
- `docs/ui/full-solution-capability-matrix.md`
- `docs/ui/live-portal-capability-matrix.md`
- `docs/ui/ui-modernization-plan.md`
- Existing application code, API contracts, server actions, tests, and security controls

The existing repository remains the functional source of truth.

The UI specifications remain the UX source of truth.

The supplied asset pack is the approved visual asset library.

Do not redesign the application from scratch.

Do not implement unsupported functionality merely because an asset or mockup exists for it.

---

# 1. Objective

Integrate the supplied KNOWZY Design Elements Asset Pack into the existing shared KNOWZY shell and implemented pages so that both portals use a consistent, accessible, performant, and premium visual language.

The goal is to:

- Replace temporary or generic visual assets where an approved KNOWZY asset exists
- Improve brand consistency
- Improve visual hierarchy and polish
- Reuse assets through shared components
- Preserve the working application architecture and behavior
- Preserve accessibility and security
- Avoid duplicate icons, illustrations, and visual components

The goal is not simply to make the application compile.

The goal is to make KNOWZY consistently use the approved visual asset library while preserving the existing architecture, business behavior, accessibility, governance, and enterprise design language.

---

# 2. Non-Negotiable Guardrails

Preserve:

- Existing KNOWZY shared shell
- Existing design tokens
- Existing accessibility foundation
- Existing navigation architecture
- Existing RBAC and policy concepts
- Existing source and document workflows
- Existing question-generation workflow
- Existing review and approval workflow
- Existing Question Bank behavior
- Existing assessment and scoring workflow
- Existing server components and server actions
- Existing API contracts
- Existing browser-to-server security boundaries
- Existing answer-key protection
- Existing audit behavior
- Existing tests and CI gates

Do not:

- Introduce a new frontend framework
- Replace the entire existing icon system globally without a documented reason
- Modify backend contracts merely to accommodate a visual asset
- Replace accessible HTML controls with static images
- Turn an SVG into a fake interactive control
- Add fabricated courses, metrics, badges, certificates, recommendations, or support channels
- Expose inaccessible knowledge-source content
- Add direct browser calls to protected APIs
- Weaken active-assessment integrity
- Push to GitHub unless explicitly instructed

---

# 3. Asset Package

The approved source package is:

```text
design/approved/knowzy_design_elements_asset_pack/
```

Expected categories include:

```text
branding/
navigation/
categories/
stats/
course_thumbnails/
badges/
actions/
controls/
cards/
illustrations/
avatars/
backgrounds/
```

All filenames are lowercase and website-friendly.

Treat the package as the approved visual asset library for KNOWZY.

Before creating a new icon, illustration, SVG, thumbnail, or badge, check whether the asset pack already contains a suitable asset.

Use this priority:

```text
Existing approved asset
→ Existing shared component
→ CSS or semantic HTML
→ New asset only when genuinely required and approved
```

Do not create visual duplicates.

---

# 4. First Step: Inspect the Existing Application

Before modifying files:

1. Inspect the repository structure.
2. Identify:
   - Authoring application
   - Live Learning application
   - Shared UI package
   - Public/static asset directories
   - Existing CSS and design tokens
   - Existing branding components
   - Existing icon components
   - Existing image-loading conventions
   - Existing routes
   - Existing browser tests
3. Confirm whether the applications use:
   - Next.js
   - React
   - TypeScript
   - Plain CSS, CSS modules, Tailwind, or another existing styling layer
   - Server components
   - Server actions
   - Shared components
4. Inspect the implemented KNOWZY shells.
5. Inspect the capability matrices before activating assets associated with planned features.
6. Identify duplicates between the asset pack and current assets.
7. Identify assets that are decorative, informational, interactive-looking, or unsuitable for production use.

Do not duplicate existing components.

Extend the shared UI foundation wherever possible.

---

# 5. Create an Asset Inventory and Mapping

Before implementation, create:

```text
docs/ui/knowzy-design-asset-inventory.md
```

For every supplied asset, record:

| Asset path | Category | File type | Intended use | Portal | Route/component | Accessibility treatment | Capability status | Decision |
|---|---|---|---|---|---|---|---|---|

Use capability status values:

- `IMPLEMENTED`
- `PARTIALLY_IMPLEMENTED`
- `PLANNED`
- `REQUIRES_BACKEND_EXTENSION`
- `DISABLED_IN_CURRENT_RELEASE`

Use decision values:

- `USE`
- `USE_AS_DECORATIVE`
- `DEFER`
- `DUPLICATE`
- `REJECT`
- `REQUIRES_BRAND_APPROVAL`

The inventory must prevent Claude from copying every asset into every application without a clear use.

---

# 6. Install the Runtime Asset Library

Do not edit the approval-source files inside:

```text
design/approved/knowzy_design_elements_asset_pack/
```

Treat that folder as immutable reference material.

After inspecting the repository, copy only approved runtime assets into the appropriate application public/static locations.

Preferred structure for each application, if the repository uses per-application `public` directories:

```text
apps/<application>/public/assets/knowzy/
├── branding/
├── navigation/
├── categories/
├── stats/
├── course_thumbnails/
├── badges/
├── actions/
├── controls/
├── cards/
├── illustrations/
├── avatars/
└── backgrounds/
```

If both applications require the same static files, choose one documented strategy:

1. A build-time asset synchronization script from the approved source folder into both application public folders, or
2. A shared asset package supported by the current build system, or
3. Explicit duplication into each application public folder with a generated consistency check.

Do not assume one Next.js application's `public` folder is available to the other application.

Preserve lowercase filenames.

Do not rename assets unless there is a technical or accessibility reason.

Prefer SVG for scalable interface visuals.

Do not convert SVG assets to PNG unless the rendering environment genuinely requires it.

Add an automated asset-path or manifest test so missing files and broken references fail verification.

---

# 7. Branding

Use approved assets where valid:

```text
branding/essilorluxottica_logo.svg
branding/knowzy_wordmark.svg
branding/knowzy_icon.svg
branding/favicon.svg
```

Core colors:

- Primary Navy: `#001E62`
- EssilorLuxottica Green: `#00B388`

Supporting colors must remain compatible with the existing KNOWZY design tokens.

The header should contain:

```text
EssilorLuxottica logo
+ KNOWZY wordmark
+ global search
+ KNOWZY Copilot entry point
+ notifications
+ user profile
```

Requirements:

- Do not overlap the logo or wordmark with search or user controls.
- Preserve the existing responsive header behavior.
- Preserve the logo aspect ratio.
- Do not crop, recolor, stretch, compress, outline, or modify approved brand assets.
- Use sharp SVG rendering.
- Provide appropriate accessible names.
- Use empty alternative text when a nearby text label already supplies the same product name and the image is redundant.
- Install the approved favicon using the existing Next.js metadata convention.

Do not represent KNOWZY Copilot as Microsoft Copilot unless formally approved.

---

# 8. Asset Component Architecture

Create or extend reusable shared components where appropriate:

```text
<KnowzyLogo />
<KnowzyWordmark />
<KnowzyIcon />
<KnowzyNavIcon />
<KnowzyCourseThumbnail />
<KnowzyBadgeVisual />
<KnowzyStatIcon />
<KnowzyCategoryIcon />
<KnowzyIllustration />
<KnowzySourceVisual />
<KnowzyProgressVisual />
```

Component rules:

- Use strict typed registries instead of arbitrary user-supplied asset paths.
- Do not allow path traversal or runtime injection into asset URLs.
- Centralize the mapping from semantic names to asset files.
- Provide size, class name, decorative/informational mode, and accessible-label options.
- Avoid duplicate implementations in Authoring and Live applications.
- Extend existing shared components when an equivalent already exists.
- Interactive behavior remains in semantic buttons, links, inputs, checkboxes, and radios.
- The asset component may decorate an interactive control but must not replace the control.

---

# 9. Learner Portal Navigation

Approved learner navigation:

1. Home
2. My Learnings
3. Assessments
4. Discover
5. Badges
6. Knowledge Library
7. My Progress
8. Help & Support

Use the corresponding approved navigation assets where present:

```text
Home              → navigation/icon_home.svg
My Learnings      → navigation/icon_my_learnings.svg
Assessments       → navigation/icon_assessments.svg
Discover          → navigation/icon_discover.svg
Badges            → navigation/icon_badges.svg
Knowledge Library → navigation/icon_library.svg
My Progress       → navigation/icon_progress.svg
Help & Support    → navigation/icon_help.svg
```

Rules:

- Respect the capability matrix.
- Keep planned or backend-dependent destinations accurately labeled, disabled, or hidden according to the approved release plan.
- Do not create dead links.
- Do not implement fake pages solely because a navigation icon exists.
- Preserve active, hover, focus, disabled, and refusal states.
- Ensure the icon style is visually consistent with the Authoring navigation.

---

# 10. Learner Home

Use approved assets to enhance the implemented learner home without fabricating data.

Potential visual assets:

- Course thumbnails
- Stat icons
- Badge visuals
- Approved illustrations
- Copilot card art
- Progress visuals

The full design vision may communicate:

- Welcome back
- Continue Learning
- Learning Progress
- Assessments
- Badges
- Knowledge Level
- Recommended Learning
- Knowledge Gaps
- Upcoming Assessments
- Learning Journey

However, only activate cards backed by implemented and authorized data.

Current assessment data may support:

- Available assessments
- In-progress assessment
- Completed assessments
- Recent score
- Proficiency result
- Topic-level gaps
- Resume action

Do not fabricate:

- Course progress
- Badges earned
- Recommendations
- Upcoming learning
- Journey stages
- Learning hours

Do not overcrowd the page.

Maintain a visual hierarchy inspired by Microsoft Learn, Copilot-style enterprise experiences, and premium SaaS while retaining KNOWZY's identity.

---

# 11. My Learnings

Potential domain thumbnails include:

- RxNet
- MES 360
- VisionStar
- SAP
- Azure
- Other configured learning domains

A learning card may support, once the backend capability exists:

- Thumbnail
- Title
- Source
- Difficulty or skill level
- Duration
- Progress
- Module count
- Continue or Start action

Use real HTML buttons and links.

Do not replace an action with an image.

The current repository does not have complete Course, Module, Enrollment, LearningPath, Bookmark, or course-completion behavior unless this has changed since the capability matrix was produced.

Do not populate My Learnings with invented course data.

If the capability remains unreleased, integrate only the navigation visual or approved preview treatment documented in the plan.

---

# 12. Assessments

Use appropriate approved assets for:

- Navigation
- Assessment statistics
- Skill or proficiency level
- Domain thumbnails where relevant
- Decorative progress visuals

Interactive controls must remain real semantic controls.

Do not replace real radio buttons, checkboxes, links, or buttons with SVG images.

The assessment flow must continue to work:

```text
Open assessment
→ Start or resume
→ Answer one question at a time
→ Persist answers
→ Finish and score
→ Display deterministic results
```

Preserve the regression fix for empty-body POST requests.

Do not send:

```text
Content-Type: application/json
```

when the request has no body.

Regression protection must continue to cover:

- Learner Finish and score
- Authoring Test connection
- Commentless question transitions where permitted
- Assessment Submit, Approve, and Publish transitions

Do not relax Fastify's strict request parsing to hide a malformed client request.

---

# 13. Badges and Certifications

Approved badge assets may include:

```text
badges/badge_knowledge_explorer.svg
badges/badge_assessment_pro.svg
badges/badge_team_learner.svg
badges/badge_domain_specialist.svg
badges/badge_continuous_learner.svg
badges/badge_knowledge_sharer.svg
badges/badge_growth_mindset.svg
badges/badge_learning_champion.svg
```

Approved level visuals may include:

```text
level_beginner.svg
level_intermediate.svg
level_advanced.svg
level_expert.svg
```

The full page design may include:

- Total Badges
- Certifications
- Learning Streak
- Points Earned
- Badges
- Certifications
- In Progress
- All Achievements

Capability rules:

- Badge definitions may exist, but badge awards must not be invented.
- Certificate rules may exist, but certificates must not be invented.
- Learning streaks, points, ranks, and achievement levels require formally approved deterministic rules and persisted data.
- Claude must not award badges or certificates.
- Certificate generation, verification, expiry, and revocation must remain server-side.

Until backend capabilities are implemented, assets may be cataloged or used in an explicitly approved preview, but must not imply a learner has earned something.

---

# 14. Knowledge Library

Category assets may represent configured categories such as:

- All Content
- RxNet
- MES 360
- VisionStar
- SAP
- Infrastructure
- Service Management
- Soft Skills

Potential source visuals may represent:

- Leonardo
- SharePoint
- Confluence
- Microsoft Learn
- Udemy
- LinkedIn Learning

These are examples, not proof of active integrations.

Do not display a source as connected until it has:

- Approved enterprise integration
- Authentication
- Authorization
- Access trimming
- Metadata normalization
- Deep-link governance
- Licensing approval where applicable

The Knowledge Library must not expose inaccessible resource titles, descriptions, thumbnails, or links.

Do not fabricate an aggregated catalog merely because thumbnails exist.

---

# 15. My Progress

Use stat, progress, level, thumbnail, and illustration assets only with verified metrics.

Potential full-solution metrics include:

- Courses Completed
- Assessments Completed
- Learning Hours
- Average Score
- Badges Earned
- Overall Progress
- Learning Activity
- Recent Activity
- Upcoming Learning
- Learning Streak
- Next Milestone

Current assessment data may support:

- Assessments completed
- Assessment scores
- Pass rate
- Proficiency
- Topic-level performance
- Knowledge gaps
- Attempt history

Do not fabricate course metrics, learning hours, streaks, badges, or upcoming events.

Every displayed metric must define its calculation, source, time period, and denominator.

---

# 16. Help and Support

Potential approved assets:

```text
icon_copilot.svg
icon_help.svg
icon_phone.svg
icon_email.svg
icon_chat.svg
```

Potential full-solution capabilities:

- Ask KNOWZY Copilot
- Browse Help Articles
- Raise Support Ticket
- Contact Support
- Email Support
- Live Chat
- Schedule a Call
- System Status

Do not activate support channels without approved integrations and real configuration.

Potential integrations require separate authorization and governance, for example:

- Approved ticketing platform
- Approved support mailbox/API
- Teams or approved chat
- Enterprise scheduling
- Health/status service

Do not hardcode real support addresses, telephone numbers, hours, service commitments, or URLs as demo content.

Assets for unavailable channels may be cataloged but must not appear as active actions.

---

# 17. Authoring Portal

Apply the same KNOWZY visual language to the Authoring and Administration Portal.

Approved navigation includes:

1. Dashboard
2. Knowledge Sources
3. AI Quiz Generation
4. Review Queue
5. Approvals
6. Question Bank
7. Assessments
8. Publish
9. Reports
10. Governance
11. Administration

Use approved reusable navigation, status, stat, illustration, and background assets where appropriate.

The Authoring dashboard should remain operational and honest.

Use real data for existing metrics such as:

- Knowledge Sources
- Documents Indexed
- Draft Questions
- Questions in Review
- Pending Approvals
- Approved Questions
- Published Questions
- Published Assessments
- Pipeline stages

Potential sections include:

- Recent Activity
- Workflow Status
- Knowledge Source Health
- Pending Reviews
- Recent Publications

Do not add trends, activity histories, coverage percentages, owners, or other values that are not stored or authorized.

Do not redesign the application from scratch. Improve existing pages through reusable components and approved assets.

---

# 18. Actions and Controls Assets

Assets under `actions/` and `controls/` are visual references or decorative elements unless explicitly designed as non-interactive indicators.

Rules:

- Real interaction uses semantic HTML/React controls.
- Preserve keyboard interaction.
- Preserve focus states.
- Preserve disabled states.
- Preserve accessible names.
- Preserve form submission behavior.
- Do not place essential text only inside an image.
- Do not use an image asset to simulate a checkbox or radio button.
- Decorative assets use empty alt text.

---

# 19. Accessibility

Target WCAG 2.2 AA.

All informational image assets require meaningful alternative text unless an adjacent textual label already conveys the same information.

Decorative images use:

```html
alt=""
```

or the equivalent accessibility mechanism.

Maintain:

- Semantic headings
- Skip links
- Keyboard navigation
- Visible focus states
- Correct ARIA only where required
- Color contrast
- Reduced-motion support
- Accessible tables
- Accessible quiz controls
- Accessible dialogs and drawers
- Screen-reader-friendly progress and status

Do not sacrifice accessibility for visual fidelity.

---

# 20. Performance

- Prefer SVG where possible.
- Do not rasterize scalable assets unnecessarily.
- Do not load the entire asset library on every page.
- Load only the assets required by the current route.
- Avoid unnecessary client-side JavaScript.
- Avoid increasing First Load JS merely to render static visual assets.
- Use Next.js image handling where appropriate for raster images.
- Define dimensions or aspect ratios to prevent layout shift.
- Optimize unusually large SVG or raster assets only after preserving visual and brand fidelity.
- Do not inline very large SVG files into repeated components without measuring impact.

Record bundle or route-size changes where the existing build tooling supports them.

---

# 21. Visual Quality

Target style:

- Premium enterprise SaaS
- Microsoft Learn-inspired clarity
- Copilot-style productivity
- Power BI-inspired data presentation
- Clean
- Professional
- Light
- Accessible
- High information density without crowding

Use:

- `#001E62`
- `#00B388`
- White
- Light neutral backgrounds
- Soft borders
- Subtle shadows
- Moderate corner radius
- Clear typography

Do not:

- Introduce random colors
- Use excessive gradients
- Use excessive glassmorphism
- Use cartoon-style graphics
- Use oversized decorative illustrations
- Redesign the KNOWZY brand
- Use inconsistent icon styles
- Mix unrelated icon libraries unnecessarily

---

# 22. Routes to Verify

Use the actual route inventory from the repository. Do not assume mockup names are route names.

At minimum inspect the current equivalents of:

## Live Learning Portal

```text
/
/my-learnings
/assessments
/discover
/badges
/knowledge-library
/my-progress
/help-support
/assessments/[id]
/sessions/[id]
/results/[id]
```

## Authoring Portal

```text
/
/sources
/sources/[id]
/generate
/review
/review/[id]
/publish
/reports
/governance
/administration
```

If the route structure differs, document the actual path and update the asset mapping.

Do not create missing routes merely to satisfy this list unless the approved milestone explicitly includes the required backend and UI capability.

---

# 23. Testing

Run the complete repository verification:

```powershell
npm run verify
```

Also confirm the relevant individual gates where useful:

- Formatting
- Lint
- Type checking
- Tests
- Builds
- Boundary checks
- Generated-contract checks
- Asset-manifest/path tests
- Browser tests

Pay particular attention to:

- Broken SVG paths
- Asset 404s
- Case-sensitive filename mismatches that may work on Windows but fail in Linux/CI
- Duplicate asset IDs inside inline SVGs
- Layout overflow
- Header overlap
- Active navigation states
- Accessibility
- Assessment submission
- Empty-body POST behavior
- Responsive behavior
- Hydration errors
- Browser console errors

Add or preserve regression tests for all defects found during implementation.

---

# 24. Visual QA

Render and inspect important pages at:

- `1920 x 1080`
- `1440 x 900`
- `1280 x 720`

Inspect:

- Header
- Logo alignment
- Wordmark alignment
- Search width
- Copilot placement
- Profile area
- Navigation
- Workflow ribbon
- Cards
- Asset proportions
- Course thumbnails
- Badge sizing
- Icon sizing
- Spacing
- Text wrapping
- Overflow
- Responsive behavior
- Loading, empty, refusal, and error states

Do not accept a page merely because it compiles.

Actually inspect the rendered results.

Screenshots may be retained as implementation evidence only if the milestone's documentation rules require them.

---

# 25. Documentation Updates

Create or update:

- `docs/ui/knowzy-design-asset-inventory.md`
- `docs/ui/ui-modernization-plan.md`
- `docs/ui/full-solution-capability-matrix.md`, if classifications change
- `docs/ui/live-portal-capability-matrix.md`, if classifications change
- `docs/USER-GUIDE.md`, for any visible behavior or navigation changes
- The project-history document, if configured by the project

Record:

- Assets used
- Assets deferred
- Duplicate assets rejected
- Brand-approval gaps
- Components created or extended
- Routes updated
- Accessibility decisions
- Performance decisions
- Defects found and fixed

---

# 26. Delivery Sequence

1. Inspect repository and current shells.
2. Inventory and classify every asset.
3. Identify runtime asset strategy for both Next.js applications.
4. Add an asset manifest and missing-path validation.
5. Integrate branding assets into shared shell components.
6. Integrate navigation assets without changing route behavior.
7. Integrate assets into implemented Authoring pages.
8. Integrate assets into implemented Live Portal pages.
9. Defer assets tied to unsupported capabilities.
10. Add regression and browser coverage.
11. Run full verification.
12. Perform visual QA at all target sizes.
13. Update user guide and project history.
14. Commit a focused milestone.
15. Do not push unless explicitly instructed.

---

# 27. Acceptance Criteria

The milestone is complete only when:

1. The approved source asset pack remains unchanged.
2. Runtime assets are installed using a documented strategy.
3. Asset names and paths are case-correct for Linux CI.
4. Missing approved asset references fail an automated check.
5. Branding assets render without distortion or overlap.
6. Both applications preserve responsive header behavior.
7. Existing navigation and workflows remain functional.
8. Only implemented capabilities are shown as active.
9. Fake learner achievements, metrics, catalogs, recommendations, and support channels are not introduced.
10. Interactive controls remain semantic and accessible.
11. Active assessments preserve answer-key protection.
12. Empty-body POST regressions remain fixed and tested.
13. No broken asset requests appear in the browser.
14. No hydration or browser-console errors remain.
15. Accessibility checks pass for affected controls.
16. Performance is not materially degraded without a documented reason.
17. `npm run verify` passes.
18. Visual QA is completed at all required sizes.
19. `docs/USER-GUIDE.md` reflects visible changes.
20. The project-history log is updated when required.
21. The change is committed with a focused commit.
22. The commit is not pushed unless explicitly instructed.

---

# 28. Final Report

When finished, provide:

1. Files added
2. Files modified
3. Source assets inspected
4. Assets integrated
5. Assets deferred or rejected
6. Components created
7. Components reused or extended
8. Routes updated
9. Accessibility decisions
10. Performance impact
11. Defects discovered and fixed
12. Tests executed
13. Test results
14. Build result
15. Visual QA result
16. Documentation updated
17. Remaining issues
18. Git commit hash

Do not push to GitHub unless explicitly instructed.

---

# 29. Final Instruction to Claude

Use:

- `CLAUDE.md`
- Existing code and tests
- Architecture documents under `docs/`
- UI source-of-truth documents under `docs/ui/`
- Capability matrices
- The approved asset pack at `design/approved/knowzy_design_elements_asset_pack/`

The repository is the functional source of truth.

The asset pack is the approved visual library, not a feature specification.

Do not activate an unimplemented feature merely because a visual asset exists for it.

First create the asset inventory and implementation mapping.

Then integrate assets incrementally through shared components, preserve application behavior, validate in a browser, run the full verification suite, update documentation, and create a focused commit.
