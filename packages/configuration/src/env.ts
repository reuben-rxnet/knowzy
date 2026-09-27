// Environment variable contract — environment-and-configuration.md §4.
//
// This module is the only reader of process.env in the repository (C3).
//
// Two rules are enforced structurally rather than by convention:
//   - a web app receives ONLY PUBLIC_*, its Entra client ID, and KNOWZY_ENV
//   - a PUBLIC_* variable may never hold a secret-shaped value, checked at
//     startup, because a PUBLIC_ prefix means world-readable

import { z } from 'zod';
import {
  KEY_VAULT_REFERENCE,
  KnowzyEnvSchema,
  LOCAL_STORE_REFERENCE,
  type KnowzyEnv,
} from '@knowzy/shared-types';

// SIX deployables. `sync-web` was added on 2026-09-26: the SharePoint Sync
// Manager shipped on 2026-09-23 as a third web application and the environment
// contract did not know it existed, so it had no per-deployable variable
// targeting and no distinct OTEL service name. It worked locally only because
// compose hands it its environment directly.
export const DEPLOYABLES = [
  'authoring-web',
  'live-web',
  'sync-web',
  'api',
  'mcp-server',
  'jobs',
] as const;
export type Deployable = (typeof DEPLOYABLES)[number];

/**
 * A secret REFERENCE, never a value: `keyvault://{vault}/secrets/{name}`, or
 * since P-5 `localstore://{name}` for the local secure store. The startup
 * check refuses a `localstore://` reference outside the local environment.
 */
const secretRef = z
  .string()
  .refine(
    (value) => LOCAL_STORE_REFERENCE.test(value) || KEY_VAULT_REFERENCE.test(value),
    'must be a localstore://{name} or keyvault://{vault}/secrets/{name} reference, never a secret value',
  );

const httpsUrl = z.string().url().startsWith('https://');
const anyUrl = z.string().url();
const uuid = z.string().uuid();

export interface EnvVarDeclaration {
  readonly name: string;
  readonly deployables: readonly Deployable[];
  readonly schema: z.ZodTypeAny;
  /** Environments in which the variable is required. */
  readonly requiredIn: readonly KnowzyEnv[];
  /** Environments in which the variable must be ABSENT. */
  readonly forbiddenIn?: readonly KnowzyEnv[];
  readonly description: string;
}

const ALL: readonly KnowzyEnv[] = ['local', 'dev', 'test', 'prod'];
const DEPLOYED: readonly KnowzyEnv[] = ['dev', 'test', 'prod'];
const LOCAL: readonly KnowzyEnv[] = ['local'];
const NON_LOCAL: readonly KnowzyEnv[] = ['dev', 'test', 'prod'];

const SERVICES: readonly Deployable[] = ['api', 'mcp-server', 'jobs'];
const WEB: readonly Deployable[] = ['authoring-web', 'live-web', 'sync-web'];

export const ENV_VARS: readonly EnvVarDeclaration[] = [
  {
    name: 'KNOWZY_ENV',
    deployables: DEPLOYABLES,
    schema: KnowzyEnvSchema,
    requiredIn: ALL,
    description: 'Stamped on every span, log line, and audit event (V6).',
  },
  {
    name: 'DATABASE_URL',
    deployables: SERVICES,
    schema: z.string().min(1),
    requiredIn: ALL,
    description: 'Managed identity in deployed environments; password only in local.',
  },
  {
    name: 'KEY_VAULT_URI',
    deployables: SERVICES,
    schema: httpsUrl,
    requiredIn: DEPLOYED,
    forbiddenIn: LOCAL,
    description: 'Absent in local, where no credential is needed.',
  },
  {
    name: 'BLOB_ACCOUNT_URL',
    deployables: ['api', 'jobs'],
    schema: httpsUrl,
    requiredIn: DEPLOYED,
    description: 'Certificates and report exports.',
  },
  {
    name: 'BLOB_CONTAINER',
    deployables: ['api', 'jobs'],
    schema: z.string().min(1),
    requiredIn: DEPLOYED,
    description: 'Private container; no public URL exists.',
  },
  {
    name: 'MCP_ENDPOINT',
    deployables: ['api', 'jobs'],
    schema: z.string().min(1),
    requiredIn: ALL,
    description: 'Internal URL in deployed environments; `stdio` locally.',
  },
  {
    name: 'ENTRA_TENANT_ID',
    deployables: DEPLOYABLES,
    schema: z.string().min(1),
    requiredIn: DEPLOYED,
    description: 'Tenant-specific value (T-01).',
  },
  {
    name: 'ENTRA_API_CLIENT_ID',
    deployables: ['api', 'mcp-server'],
    schema: uuid,
    requiredIn: DEPLOYED,
    description: 'The API app registration (T-04).',
  },
  {
    name: 'ENTRA_API_AUDIENCE',
    deployables: ['api', 'mcp-server'],
    schema: z.string().min(1),
    requiredIn: DEPLOYED,
    description: 'Expected `aud` claim.',
  },
  {
    name: 'ENTRA_AUTHORING_CLIENT_ID',
    deployables: ['authoring-web'],
    schema: uuid,
    requiredIn: DEPLOYED,
    description: 'Public client value (T-02).',
  },
  {
    name: 'ENTRA_LIVE_CLIENT_ID',
    deployables: ['live-web'],
    schema: uuid,
    requiredIn: DEPLOYED,
    description: 'Public client value (T-03).',
  },
  {
    name: 'ANTHROPIC_API_KEY_REF',
    deployables: ['api', 'jobs'],
    schema: secretRef,
    requiredIn: DEPLOYED,
    description: 'A Key Vault reference. With it absent, local uses a recorded-response stub.',
  },
  // The other providers' credential references, added 2026-09-26 with
  // Administration -> AI Providers. OPTIONAL IN EVERY ENVIRONMENT, unlike
  // ANTHROPIC_API_KEY_REF: no client for any of them exists in this build, so
  // requiring one in a deployed environment would block a deployment on a
  // credential nothing can spend. They are declared now so the reference is
  // validated as a reference the day one arrives -- an undeclared variable is
  // one somebody sets to a raw key.
  {
    name: 'OPENAI_API_KEY_REF',
    deployables: ['api', 'jobs'],
    schema: secretRef,
    requiredIn: [],
    description:
      'A Key Vault reference for OpenAI (Codex). Optional: no OpenAI client exists in this build, and generation is refused with BLOCKED_BY_APPROVAL until a data-processing approval is recorded.',
  },
  {
    name: 'AZURE_OPENAI_KEY_REF',
    deployables: ['api', 'jobs'],
    schema: secretRef,
    requiredIn: [],
    description:
      'A Key Vault reference for Azure OpenAI. Optional: no client exists in this build.',
  },
  {
    name: 'COPILOT_CLIENT_ID_REF',
    deployables: ['api', 'jobs'],
    schema: secretRef,
    requiredIn: [],
    description:
      'A Key Vault reference for a Microsoft Copilot app registration. Optional, and Copilot cannot be used for grounded generation at all: it performs its own retrieval, so it is BLOCKED_BY_CAPABILITY regardless of credential.',
  },
  // P-5, 2026-09-27. Where the LOCAL SECURE STORE lives inside the api and
  // jobs containers. Local only, and FORBIDDEN elsewhere: a deployed
  // environment resolves `keyvault://` references, and a store directory set
  // on a deployed host would be a developer convenience reaching production.
  {
    name: 'KNOWZY_LOCAL_SECRET_DIR',
    deployables: ['api', 'jobs'],
    schema: z.string().min(1),
    requiredIn: [],
    forbiddenIn: NON_LOCAL,
    description:
      'Directory of the local secure store (store.key + store.json). Local only; created by `npm run secrets -- init`.',
  },
  // OPENAI-CODEX-00, 2026-09-27. The hosts a provider's API key may be SENT
  // to. Deployment configuration, deliberately NOT a screen setting: the base
  // URL is editable in Administration -> AI Providers, and without a fence an
  // administrator could point it at any host and the platform would hand that
  // host the key. Absent means each provider's own documented host only.
  {
    name: 'LLM_ENDPOINT_ALLOWLIST',
    deployables: ['api', 'jobs'],
    schema: z
      .string()
      .regex(
        /^[a-z0-9.-]+(:[0-9]+)?(,[a-z0-9.-]+(:[0-9]+)?)*$/,
        'a comma-separated list of host names',
      ),
    requiredIn: [],
    description:
      'Extra hosts a provider credential may be sent to, comma-separated. Absent: api.openai.com for OpenAI and nothing else.',
  },
  {
    name: 'GRAPH_CREDENTIAL_REF',
    deployables: ['mcp-server'],
    schema: secretRef,
    requiredIn: DEPLOYED,
    description: "MCP only — the API's identity cannot read it (C6).",
  },
  {
    name: 'ENVELOPE_SIGNING_KEY_REF',
    deployables: ['api', 'mcp-server'],
    schema: secretRef,
    requiredIn: DEPLOYED,
    description: 'API signs, MCP verifies.',
  },
  {
    name: 'CERTIFICATE_SIGNING_KEY_REF',
    deployables: ['jobs'],
    schema: secretRef,
    requiredIn: DEPLOYED,
    description: 'Certificate verification codes are HMAC-derived from this key.',
  },
  {
    name: 'OTEL_EXPORTER_OTLP_ENDPOINT',
    deployables: DEPLOYABLES,
    schema: anyUrl,
    requiredIn: DEPLOYED,
    description: 'Telemetry sink. Audit is unaffected by its absence.',
  },
  {
    name: 'OTEL_SERVICE_NAME',
    deployables: DEPLOYABLES,
    schema: z.string().min(1),
    requiredIn: DEPLOYED,
    description: 'Distinct per deployable.',
  },
  {
    name: 'PUBLIC_API_BASE_URL',
    deployables: WEB,
    schema: anyUrl,
    requiredIn: ALL,
    description: 'The only API value a browser receives.',
  },
  {
    name: 'API_INTERNAL_BASE_URL',
    deployables: WEB,
    schema: anyUrl,
    // Not required at startup: a web app that never renders a page which calls
    // the API does not need it, and the client throws a clear error rather than
    // fetching a wrong address. Declared here so the value has ONE resolution
    // path (C3) and appears in the configuration surface like everything else.
    requiredIn: [],
    description: 'Server-side API address. Never reaches the browser (B1).',
  },
  {
    name: 'PILOT_MIRROR_ROOT',
    deployables: SERVICES,
    schema: z.string().min(1),
    // Not required anywhere: a deployment with no file-repository source does
    // not need it, and a source that needs it fails Test Connection with a
    // stated reason rather than failing startup for everyone.
    requiredIn: [],
    description:
      'Local root of a synchronized SharePoint or OneDrive mirror, for a FILE_REPOSITORY ' +
      'source. OPERATIONAL configuration only: it is machine-specific, is never committed, ' +
      'and is never persisted as document provenance.',
  },
  {
    name: 'MOCK_FIXTURE_ROOT',
    deployables: SERVICES,
    schema: z.string().min(1),
    requiredIn: [],
    forbiddenIn: NON_LOCAL,
    description: 'Local only. Startup fails if set elsewhere (check 4).',
  },
  {
    name: 'MOCK_FAULTS',
    deployables: SERVICES,
    schema: z.string(),
    requiredIn: [],
    forbiddenIn: NON_LOCAL,
    description: 'Local only fault injection.',
  },
];

export const envVarsFor = (deployable: Deployable): readonly EnvVarDeclaration[] =>
  ENV_VARS.filter((v) => v.deployables.includes(deployable));

/** Variables a browser bundle may legitimately receive. */
export const isBrowserSafeVarName = (name: string): boolean =>
  name.startsWith('PUBLIC_') ||
  name === 'KNOWZY_ENV' ||
  name === 'ENTRA_AUTHORING_CLIENT_ID' ||
  name === 'ENTRA_LIVE_CLIENT_ID' ||
  name === 'ENTRA_TENANT_ID';

/** Secret-shaped values that must never appear under a PUBLIC_ name. */
export const looksSecretShaped = (value: string): boolean =>
  /^keyvault:\/\//.test(value) ||
  /\beyJ[A-Za-z0-9_-]{10,}\./.test(value) ||
  /-----BEGIN /.test(value) ||
  (/^[A-Za-z0-9+/_-]{32,}={0,2}$/.test(value) &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /[0-9]/.test(value));

export type RawEnv = Readonly<Record<string, string | undefined>>;

/** Captures process.env once. The single sanctioned read (C3). */
export const readProcessEnv = (): RawEnv => ({ ...process.env });

export const resolveKnowzyEnv = (raw: RawEnv): KnowzyEnv | null => {
  const parsed = KnowzyEnvSchema.safeParse(raw['KNOWZY_ENV']);
  return parsed.success ? parsed.data : null;
};

/**
 * The ONLY environment values a web app may receive — §4: "the web apps receive
 * only PUBLIC_*, the Entra client ID, and KNOWZY_ENV; every other variable is
 * server-side."
 *
 * Exposed as a narrow accessor rather than letting a web app call
 * readProcessEnv(), so B1 and C3 stay enforceable: a browser bundle cannot
 * reach a server-side variable even by accident, because this function does not
 * return one.
 */
export const readPublicEnv = (): Readonly<Record<string, string>> => {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (!isBrowserSafeVarName(name)) continue;
    // Defence in depth: even a browser-safe NAME must not carry a secret VALUE.
    // Startup check 3 fails the process for this, but a web app may render
    // before that check runs in some topologies.
    if (looksSecretShaped(value)) continue;
    out[name] = value;
  }
  return Object.freeze(out);
};

/** Environment name for display. Returns 'unknown' rather than throwing. */
export const publicEnvironmentName = (): string => readPublicEnv()['KNOWZY_ENV'] ?? 'unknown';
