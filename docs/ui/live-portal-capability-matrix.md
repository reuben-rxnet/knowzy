# Live Portal Capability Matrix (superseded)

> **Superseded by [`full-solution-capability-matrix.md`](full-solution-capability-matrix.md)**,
> which classifies all 147 features across both portals' 17 mockups with route, domain model,
> backend support, security and authorization impact, data dependency, required extension, and
> milestone. The seven rows below are the original draft and are kept for traceability only.
>
> Two corrections the full matrix makes to this draft: badges are `PLANNED` with **10 badge
> definitions already seeded** but no award engine, and certificates have **1 seeded rule** and a
> placeholder package — neither is purely "design only".

| Feature | Mockup | Current Route | Backend Support | Status | Required Extension | Milestone |
|---|---|---|---|---|---|---|
| Assessment list | assessments.png | Existing assessment route | Yes | IMPLEMENTED | None | LIVE-UI-M1 |
| Quiz resume | learner home and assessments | Existing session route | Yes | IMPLEMENTED | UI modernization | LIVE-UI-M1 |
| Course progress | my-learnings.png | None | No | REQUIRES_BACKEND_EXTENSION | Course and enrollment models | LIVE-FULL-M2 |
| Learning catalog | knowledge-library.png | None | No | REQUIRES_BACKEND_EXTENSION | Catalog and source adapters | LIVE-FULL-M1 |
| Badges | badges.png | None | Partial design only | PLANNED | Deterministic badge service | LIVE-FULL-M4 |
| Certificates | badges.png | None | No | REQUIRES_BACKEND_EXTENSION | Certificate generation and verification | LIVE-FULL-M4 |
| Help articles | help-and-support.png | None | No | REQUIRES_BACKEND_EXTENSION | Help content source and search | LIVE-FULL-M5 |