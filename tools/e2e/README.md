# @knowzy/e2e — browser acceptance tests

Playwright, driving all three applications against the **running compose stack**.

`docs/initial-end-to-end-proof.md` §3 defines a 36-step acceptance script, and until 2026-09-23 the
equivalent had only ever been run by hand — which is why every defect in the week before was found
by a person clicking, not by the build.

## Running them

```bash
docker compose -f infrastructure/compose/docker-compose.yml up -d   # the stack must be up
npm run test:e2e
```

### On a network that blocks the Playwright CDN

`npm run test:e2e:install` downloads Playwright's own Chromium from `cdn.playwright.dev`. On this
machine that request times out, so the suite runs against the **installed** browser instead:

```bash
E2E_BROWSER_CHANNEL=chrome npm run test:e2e     # or msedge
```

CI should use the bundled Chromium (leave `E2E_BROWSER_CHANNEL` unset), which is why the channel is
an environment variable rather than a config constant.

### Other variables

| Variable              | Default                 | Purpose                                         |
| --------------------- | ----------------------- | ----------------------------------------------- |
| `E2E_AUTHORING_URL`   | `http://localhost:3000` | Authoring portal                                |
| `E2E_LEARNER_URL`     | `http://localhost:3001` | Learner portal                                  |
| `E2E_SYNC_URL`        | `http://localhost:3002` | SharePoint Sync Manager                         |
| `E2E_API_URL`         | `http://localhost:8080` | API, for preconditions and state reads          |
| `E2E_BROWSER_CHANNEL` | unset                   | `chrome` / `msedge` to use an installed browser |

## What it covers

| Spec                                        | Acceptance steps | The outcome it asserts                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authoring/sources-and-generation.spec.ts`  | 1–9              | Test Connection reports each check with its own outcome; Synchronize reports six counts with **skipped apart from failed** and the documents appear; preflight reports a recommendation **with its reason** and requires a recorded decision; a job's accounting appears and the drafts reach the queue                                                                                                                                              |
| `authoring/review-approval-publish.spec.ts` | 11–18            | The gate rail reads "12 of 13"; a DRAFT offers only Claim and **says why** the others cannot be taken; **gate 13** refuses the author and admits a second identity; publishing returns a bank item id and a KNZ identifier, and a replay reports `ALREADY_PUBLISHED`                                                                                                                                                                                 |
| `sync/sync-manager.spec.ts`                 | — (SYNC-M4)      | The dashboard's figures **match the API's**, not a fixture; the unsupported capabilities are disabled **and state the reason**; a workflow is created with a daily schedule and a computed next run; edit, pause and resume change server state; Sync Now reports its counts; Sync All reports **per-source outcomes and what it skipped, with reasons**; a failed run's detail opens; an identity without `source.read` is refused and sees no data |
| `learner/attempt.spec.ts`                   | 21–29            | An assessment is discoverable with its facts; start → answer → **reload and resume from server state** → finish → a score, an outcome, a band and per-topic accuracy; **no answer key on any response**; the authoring portal refuses a learner                                                                                                                                                                                                      |

**Assertions are on outcomes, not on elements.** "The Synchronize button exists" is worth nothing.

## Things learned the hard way, so the next person does not repeat them

- **A disabled button's accessible name carries its reason.** `Button` renders `disabledReason` as
  an sr-only span inside the button, so the name is `ApproveNot possible while ...`. Use the
  `decision()` helper, which anchors on the element's own text: `getByRole(name: 'Approve')` matches
  **three** buttons, because a string name is a case-insensitive substring and the other reasons
  contain "Available from here: APPROVED".
- **The sources screen is a table PLUS a card per source.** The action buttons are in the cards, so
  `getByRole('row', { name })` finds the row and none of the buttons. `sourceCard()` scopes by the
  card's own heading.
- **The publish checkboxes arrive already checked, inside their labels.** `check()` clicks the
  label, toggles the box **off**, and then waits forever for it to be on. Read `isChecked()` first.
- **Every decision is a server action behind `useActionState`, so it needs hydration.** A click that
  lands too early does nothing and leaves no trace. The gate-13 spec clicks, waits for the server's
  state to move, and retries once — the assertion is still on the state, so a transition that never
  happens still fails.
- **The browse read is container-scoped.** `items?recursive=true` without a `containerId` is a 400.
- **A KPI test must read the API, not a number.** The Sync Manager's five figures are counts over a
  live database that other suites write to, so asserting `5` is a test that fails on Tuesday. Each
  one is asserted against the same aggregate the screen reads.
- **`workers: 1`, always.** The suite drives one shared database through the real workflow; two
  workers approving at once produce failures that have nothing to do with the code.

## What it deliberately does not cover

On the Sync Manager: the failed-run spec **skips when no failure is among the 25 most recent runs**.
The activity feed is the last 25 of any outcome, so a failure ages out of it after 25 newer runs
while the 30-day KPI still counts it — running this suite a few times is enough to push one out.
The skip message prints the KPI's count so the reason is unambiguous, but it is a real hole: a
console that stopped rendering failures would not be caught once they have aged out.

Also on the Sync Manager: the table's client-side **sorting and free-text search are not built**, so
nothing here tests them; and **no test creates a destination, a two-way sync or a metadata
write-back**, because none of those exists — the specs assert the controls are disabled and carry
"Requires Microsoft Graph write integration and tenant approval." instead.

Steps the platform does not implement yet, and a test would have to fake: refreshers (30–31), the
revalidation queue (32–33), the audit surfaces (35–36), and the second-tab sequence conflict (26).
Step 3 (deleting a credential to force `SOURCE_NOT_CONFIGURED`) needs a source whose credential can
be removed through the UI, which the mock source has not got.

These are named here rather than written as skipped tests, because a skipped test reads like
coverage in a summary.
