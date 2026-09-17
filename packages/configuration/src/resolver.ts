// Layered configuration resolution — environment-and-configuration.md §3.
//
// A value resolved at a higher layer wins outright; there is no merging of
// scalars. P2: access is typed and range-checked, and a malformed stored value
// falls back to the code default AND raises a finding rather than crashing a
// request or silently using a nonsense value.
//
// P8: the resolver reports which layer a value came from and what each lower
// layer would have given, so "why is this 0.92?" is answerable without reading
// code.

import type { ConfigurationScope } from '@knowzy/shared-types';
import {
  CONFIG_KEYS,
  type ConfigKey,
  type ConfigLayer,
  type ConfigValue,
} from './keys.js';

/** Precedence order, highest first (§3). */
const LAYER_ORDER: readonly ConfigLayer[] = [
  'ASSESSMENT',
  'PROFILE_OR_SOURCE',
  'DOMAIN',
  'PLATFORM',
  'ENVIRONMENT',
  'CODE_DEFAULT',
];

export interface StoredConfigRow {
  readonly key: string;
  readonly scope: ConfigurationScope;
  readonly scopeId: string | null;
  readonly value: unknown;
}

export interface ResolutionContext {
  readonly assessmentVersionId?: string | null;
  readonly profileId?: string | null;
  readonly sourceId?: string | null;
  readonly domainId?: string | null;
  /** Values supplied by the environment layer, already parsed from raw env. */
  readonly environmentOverrides?: Partial<Record<ConfigKey, unknown>>;
}

export interface LayerCandidate {
  readonly layer: ConfigLayer;
  readonly value: unknown;
  readonly accepted: boolean;
  readonly rejectReason?: string;
}

export interface Resolution<K extends ConfigKey> {
  readonly key: K;
  readonly value: ConfigValue<K>;
  readonly layer: ConfigLayer;
  /** Every layer that offered a value, in precedence order (P8). */
  readonly candidates: readonly LayerCandidate[];
}

export interface ConfigFinding {
  readonly checkKey: string;
  readonly detail: string;
}

const scopeToLayer = (row: StoredConfigRow): ConfigLayer | null => {
  switch (row.scope) {
    case 'ASSESSMENT':
      return 'ASSESSMENT';
    case 'PROFILE':
    case 'SOURCE':
      return 'PROFILE_OR_SOURCE';
    case 'DOMAIN':
      return 'DOMAIN';
    case 'PLATFORM':
      return 'PLATFORM';
    default:
      return null;
  }
};

const scopeMatches = (row: StoredConfigRow, ctx: ResolutionContext): boolean => {
  switch (row.scope) {
    case 'PLATFORM':
      return true;
    case 'DOMAIN':
      return row.scopeId != null && row.scopeId === ctx.domainId;
    case 'PROFILE':
      return row.scopeId != null && row.scopeId === ctx.profileId;
    case 'SOURCE':
      return row.scopeId != null && row.scopeId === ctx.sourceId;
    case 'ASSESSMENT':
      return row.scopeId != null && row.scopeId === ctx.assessmentVersionId;
    default:
      return false;
  }
};

/**
 * A resolver over an already-loaded set of rows. Construction is cheap; the
 * caller caches the instance keyed by the newest row's updatedAt, so any
 * configuration change invalidates it immediately (P6).
 */
export class ConfigurationResolver {
  private readonly byKey: Map<string, StoredConfigRow[]>;
  private readonly findings: ConfigFinding[] = [];

  constructor(rows: readonly StoredConfigRow[] = []) {
    this.byKey = new Map();
    for (const row of rows) {
      const list = this.byKey.get(row.key);
      if (list) list.push(row);
      else this.byKey.set(row.key, [row]);
    }
  }

  /** Findings accumulated by rejected stored values (P2). */
  drainFindings(): readonly ConfigFinding[] {
    const out = [...this.findings];
    this.findings.length = 0;
    return out;
  }

  resolve<K extends ConfigKey>(key: K, ctx: ResolutionContext = {}): Resolution<K> {
    const declaration = CONFIG_KEYS[key];
    if (!declaration) {
      // P1: an undeclared key cannot be read. Reaching here is a code defect.
      throw new Error(`Configuration key "${key}" is not declared in the catalogue.`);
    }

    const candidates: LayerCandidate[] = [];
    const rows = this.byKey.get(key) ?? [];

    const offer = (layer: ConfigLayer, value: unknown): boolean => {
      if (!declaration.layers.includes(layer)) {
        candidates.push({
          layer,
          value,
          accepted: false,
          rejectReason: `${key} may not be set at layer ${layer}`,
        });
        return false;
      }
      const parsed = declaration.schema.safeParse(value);
      if (!parsed.success) {
        const reason = parsed.error.issues[0]?.message ?? 'value out of range';
        candidates.push({ layer, value, accepted: false, rejectReason: reason });
        this.findings.push({
          checkKey: 'configuration.storedValueRejected',
          detail: `${key} at layer ${layer}: ${reason}; falling back to a lower layer`,
        });
        return false;
      }
      candidates.push({ layer, value: parsed.data, accepted: true });
      return true;
    };

    for (const layer of LAYER_ORDER) {
      if (layer === 'CODE_DEFAULT') break;

      if (layer === 'ENVIRONMENT') {
        const envValue = ctx.environmentOverrides?.[key];
        if (envValue !== undefined && offer('ENVIRONMENT', envValue)) {
          return this.accept(key, candidates, 'ENVIRONMENT');
        }
        continue;
      }

      const row = rows.find((r) => scopeToLayer(r) === layer && scopeMatches(r, ctx));
      if (row !== undefined && offer(layer, row.value)) {
        return this.accept(key, candidates, layer);
      }
    }

    candidates.push({ layer: 'CODE_DEFAULT', value: declaration.defaultValue, accepted: true });
    return this.accept(key, candidates, 'CODE_DEFAULT');
  }

  /** Convenience accessor when the provenance is not needed. */
  get<K extends ConfigKey>(key: K, ctx: ResolutionContext = {}): ConfigValue<K> {
    return this.resolve(key, ctx).value;
  }

  private accept<K extends ConfigKey>(
    key: K,
    candidates: readonly LayerCandidate[],
    layer: ConfigLayer,
  ): Resolution<K> {
    const winner = [...candidates].reverse().find((c) => c.accepted && c.layer === layer);
    return {
      key,
      value: winner?.value as ConfigValue<K>,
      layer,
      candidates,
    };
  }
}

/** An inert resolver over code defaults only. Used before rows are loaded. */
export const defaultResolver = (): ConfigurationResolver => new ConfigurationResolver([]);
