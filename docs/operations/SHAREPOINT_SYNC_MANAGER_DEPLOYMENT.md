# SharePoint Sync Manager — deployment

**Status:** the application is **deployable**. It has **not been deployed**.

There is no approved hosting target for this platform. `ACCESS_DISCOVERY_REPORT.md` records that no
Azure subscription, resource group or container registry has been made available to this project,
and the CI pipeline builds images and pushes none. So this document says what a deployment needs and
stops short of inventing one: there is no App Service, no Container App, no hostname and no
environment named here, because none exists.

**What "deployable" means concretely, and each item is done:**

| | |
| --- | --- |
| Its own workspace package | `apps/sync-web` (`@knowzy/sync-web`) |
| Its own port | **3002** |
| Its own image | `infrastructure/docker/Dockerfile.web` with `--build-arg APP=sync-web` |
| A compose service | `sync-web`, with a health check |
| CI | typecheck, lint and test through turbo; a **sixth entry** in the image matrix; the trivy scan applies to it like every other image |
| Static assets | `npm run assets:sync` now writes `apps/sync-web/public/assets/knowzy` |

---

## 1. Running it locally

```bash
docker compose -f infrastructure/compose/docker-compose.yml up -d
# then http://localhost:3002
```

The whole stack, in one command: postgres, migrate, api, mcp, jobs, authoring-web (3000),
live-web (3001), **sync-web (3002)**, mailpit.

### 1.1 Configuration it needs

| Variable | Local value | Purpose |
| --- | --- | --- |
| `API_INTERNAL_BASE_URL` | `http://api:8080` | **Server-only.** The portal calls the API from its own process, so the browser never holds an identity header and there is no CORS surface |
| `PUBLIC_API_BASE_URL` | `http://localhost:8080` | Browser-visible, for a link in a page |
| `KNOWZY_ENV` | `local` | Selects the stub issuer; a deployed value refuses it |
| `OTEL_SERVICE_NAME` | `knowzy-sync-web` | Telemetry |

And two **platform configuration** keys the Sync Manager depends on, set in
`application_configuration` rather than in the environment:

| Key | Default | Effect |
| --- | --- | --- |
| `sources.allowedLocalRoots` | `[]` | Directories a `FILE_REPOSITORY` source may read. **Empty means no local source can be registered**, which is the safe default: an unconfigured environment must not be the most permissive one |
| `sources.schedulerTickMinutes` | `5` | How often the scheduler looks for due runs. Bounds lateness, not frequency |
| `sources.scheduledSyncMaxAttempts` | `3` | Attempts before a scheduled run is left exhausted for an operator |

Setting the roots locally:

```sql
UPDATE application_configuration
   SET value = '["/corpus"]', value_type = 'array', updated_at = now()
 WHERE key = 'sources.allowedLocalRoots' AND scope = 'PLATFORM';
```

### 1.2 The scheduler needs the job runner

Scheduling is executed by `apps/jobs`, not by the portal. Two variables matter there:

| Variable | Purpose |
| --- | --- |
| `MCP_ENDPOINT` | The job runner's HTTP path to the MCP server. **`stdio` means the scheduler refuses to run**, loudly, rather than silently doing nothing |
| `SOURCE_SYNC_SUBJECT` | The identity a scheduled run is attributed to. Defaults to the seeded administrator locally; a deployment should give the scheduler its own service identity |

---

## 2. Building the image

```bash
docker build -f infrastructure/docker/Dockerfile.web \
  --build-arg APP=sync-web -t knowzy/sync-web:local .
```

The image is Next.js `output: 'standalone'`: one server, the minimal `node_modules` it actually
needs, running as the `node` user, listening on **3000 inside the container**. Map it to whatever the
host uses — compose maps 3002.

### 2.1 Scanning it

CI runs `aquasecurity/trivy-action@v0.36.0` against every matrix image, `HIGH,CRITICAL`,
`exit-code: 1`. The `v` in that tag is load-bearing: written `0.24.0` the action does not resolve,
and GitHub resolves actions **before** running any step, so every matrix leg fails in three seconds
with the build never attempted.

**The scan has never executed against an image from this repository.** The images had never been
built anywhere before 2026-09-21, and the first two CI rounds failed before the scan step. A
base-image CVE is therefore an unknown rather than an absence — for `sync-web` exactly as for the
other five.

---

## 3. What a real deployment still needs

Nothing below is provisioned. Each line is an input somebody with tenant authority must supply.

### 3.1 Inputs required, whatever the target

| # | Input | Why |
| --- | --- | --- |
| D-01 | A container registry, and credentials to push to it | CI builds images and pushes none |
| D-02 | A hostname and a TLS certificate | The portal is served over HTTPS or not at all |
| D-03 | The API's internal address, reachable from the portal | `API_INTERNAL_BASE_URL` must resolve on the platform network, and must **not** be public |
| D-04 | `KNOWZY_ENV` for the environment | Any value other than `local` refuses the stub issuer, which is the point |
| D-05 | Entra app registration for this portal | **T-02/T-03 equivalent, and it does not exist.** The Sync Manager authorizes as the AUTHORING context, so it needs a public client of its own or a documented decision to reuse the authoring one |
| D-06 | `sources.allowedLocalRoots` for the environment | Empty means no local source can be registered. A deployed environment reading a mounted mirror needs the mount path declared here |
| D-07 | A service identity for the scheduler | `SOURCE_SYNC_SUBJECT` must not be a person's account in a deployed environment |
| D-08 | Log and metric sinks | `OTEL_SERVICE_NAME` is set; an exporter endpoint is not |

### 3.2 Target options, for a future approved decision

Listed with what each needs. **Recommending one is not this document's job** — the decision belongs
to whoever owns the subscription.

| Option | Fits when | What it needs beyond §3.1 |
| --- | --- | --- |
| **Azure Container Apps** | The platform is deployed as several containers with internal ingress between them | An environment, a managed identity for registry pull, internal ingress for `api`, external ingress for the portal, and a Dapr-free single-container app definition |
| **Azure App Service for Containers** | One container per app, with the App Service platform handling TLS and scale | An App Service plan, `WEBSITES_PORT=3000`, VNet integration to reach the API privately, and a deployment slot if zero-downtime is required |
| **An approved VM or container host** | The tenant prefers to run its own host | A container runtime, a reverse proxy terminating TLS, a restart policy, and a host-level secret store |

### 3.3 What must NOT be done to make a deployment work

- **Do not expose the API publicly** to let the browser call it. The portal is a
  backend-for-frontend: the browser holds no identity header, and that is what keeps authorization
  server-side (invariant 8).
- **Do not set `KNOWZY_ENV=local`** in a deployed environment to get the identity picker. The stub
  issuer throws on construction outside `local`, deliberately — a stub issuer reachable in a
  deployed environment is a complete authentication bypass.
- **Do not widen `sources.allowedLocalRoots` to `/`.** It is the only thing standing between
  "register a source" and reading any file the container can see.

---

## 4. What this release of the Sync Manager does not do

Stated here as well as on screen, because a deployment conversation is where the expectation gets
set.

| Capability the approved design shows | Reality |
| --- | --- |
| Destination site / library / folder | **There is no destination model.** The product synchronizes sources INTO Knowzy for extraction and indexing. It does not replicate content between two SharePoint locations |
| Two-way sync | Not implemented. One-way, into Knowzy |
| Sync deletes to SharePoint | Not implemented |
| Write metadata to SharePoint | Not implemented |
| A SharePoint Graph source | **The adapter does not exist** (roadmap Phase 7). Today's adapters are `FILE_REPOSITORY` — which reads a locally synchronized mirror — and `MOCK` in `local` only |

Every one of those is rendered **disabled with the sentence "Requires Microsoft Graph write
integration and tenant approval."** The API reports them at
`GET /authoring/sync/capabilities`, so the reason travels with the refusal rather than living in the
screen, and one change re-enables them when the dependency lands.

The tenant dependencies behind them are **T-22** (`Sites.Selected` Write) and the Graph application
permissions in `ENTERPRISE_PILOT_READINESS.md` §9.1. None is granted.
