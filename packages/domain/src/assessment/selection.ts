// Question selection — workflows.md §6.1.
//
//   pool     = snapshot ∩ currently eligible published questions
//   pool     = one representative per similarity cluster
//   seed     = sessionId                  // stored, makes selection reproducible
//   selected = strategy.select(pool, config, seed)
//   order    = shuffle(selected, seed) unless FIXED_SET with a fixed order
//
// The seed being the session id is what makes a selection reproducible: given
// the snapshot and the id, the exact question set and order can be recomputed
// years later. So the RNG is written out here rather than taken from
// `Math.random`, which cannot be seeded, and the shuffle is Fisher-Yates
// driven by that RNG rather than a `sort` with a random comparator — the latter
// is not a uniform shuffle and differs between engines.
//
// §5.1: "an assessment release never silently acquires questions the approver
// never saw, and never serves a retired one." Both halves are enforced by the
// INTERSECTION below: the snapshot bounds what may be served, and the live
// filter removes what must not be.

import type { SelectionStrategy } from '@knowzy/shared-types';

export class PoolInsufficientError extends Error {
  readonly code = 'ASSESSMENT_POOL_INSUFFICIENT';
  constructor(
    detail: string,
    readonly shortfall: { readonly required: number; readonly available: number },
  ) {
    super(detail);
    this.name = 'PoolInsufficientError';
  }
}

export interface EligibleQuestion {
  readonly questionId: string;
  readonly publishedVersion: number;
  readonly topicId: string;
  readonly similarityClusterId: string | null;
  /** Ties broken by approval recency, per §6.1's "highest approval recency". */
  readonly approvedAt: Date | null;
}

export interface SnapshotMember {
  readonly questionId: string;
  readonly publishedVersion: number;
}

/**
 * A 32-bit seeded PRNG (mulberry32).
 *
 * Small, fast, and — the property that matters — identical on every platform
 * and every Node version, so a selection replayed in five years matches.
 */
export const createSeededRandom = (seed: string): (() => number) => {
  // FNV-1a over the seed string, so the whole session id contributes.
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  let state = hash >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Fisher-Yates, driven by the seeded RNG. Uniform and reproducible. */
export const seededShuffle = <T>(items: readonly T[], seed: string): T[] => {
  const out = [...items];
  const random = createSeededRandom(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a !== undefined && b !== undefined) {
      out[i] = b;
      out[j] = a;
    }
  }
  return out;
};

/**
 * Intersects the pinned snapshot with what is currently servable.
 *
 * Matching on BOTH id and version is the point: a question republished at v3
 * is not the v2 the approver pinned, so it is not served. §5.1 calls this
 * re-filtering "against current state (retired and inactive questions are
 * removed) and intersected with the snapshot".
 */
export const intersectWithSnapshot = (
  snapshot: readonly SnapshotMember[],
  eligible: readonly EligibleQuestion[],
): EligibleQuestion[] => {
  const pinned = new Set(
    snapshot.map((member) => `${member.questionId}@${member.publishedVersion}`),
  );
  return eligible.filter((question) =>
    pinned.has(`${question.questionId}@${question.publishedVersion}`),
  );
};

/**
 * One representative per similarity cluster — §4.5 stage 3.
 *
 * "Select AT MOST ONE question per similarity cluster. If this makes the pool
 * insufficient, the shortfall is reported honestly rather than silently filled
 * with a near-duplicate." Questions with no cluster are all kept: a null
 * cluster means "not similar to anything", not "all the same".
 */
export const onePerCluster = (pool: readonly EligibleQuestion[]): EligibleQuestion[] => {
  const best = new Map<string, EligibleQuestion>();
  const unclustered: EligibleQuestion[] = [];

  for (const question of pool) {
    if (question.similarityClusterId === null) {
      unclustered.push(question);
      continue;
    }
    const held = best.get(question.similarityClusterId);
    const heldAt = held?.approvedAt?.getTime() ?? -1;
    const thisAt = question.approvedAt?.getTime() ?? -1;
    // Highest approval recency wins; the id breaks a tie so the choice is
    // deterministic rather than dependent on query order.
    if (!held || thisAt > heldAt || (thisAt === heldAt && question.questionId < held.questionId)) {
      best.set(question.similarityClusterId, question);
    }
  }

  return [...unclustered, ...best.values()].sort((a, b) =>
    a.questionId.localeCompare(b.questionId),
  );
};

export interface SelectionConfig {
  readonly strategy: SelectionStrategy;
  readonly questionCount: number;
  /** FIXED_SET: the exact ordered list the approver pinned. */
  readonly fixedOrder?: readonly SnapshotMember[];
  /** TOPIC_DISTRIBUTION: explicit per-topic counts. */
  readonly topicCounts?: Readonly<Record<string, number>>;
}

export interface SelectionResult {
  readonly selected: readonly EligibleQuestion[];
  readonly seed: string;
  readonly strategy: SelectionStrategy;
}

const requireCount = (available: number, required: number, what: string): void => {
  if (available < required) {
    throw new PoolInsufficientError(
      `${what}: ${required} question(s) are required and ${available} are available. The learner is not served a short or padded assessment.`,
      { required, available },
    );
  }
};

/**
 * Selects the questions for one session.
 *
 * Never pads and never truncates silently: a pool that cannot satisfy the
 * configuration raises ASSESSMENT_POOL_INSUFFICIENT with the shortfall, which
 * §6.1 requires so "the learner sees 'temporarily unavailable' and the
 * authoring dashboard sees the cause".
 */
export const selectQuestions = (
  pool: readonly EligibleQuestion[],
  config: SelectionConfig,
  seed: string,
): SelectionResult => {
  const deduped = onePerCluster(pool);

  if (config.strategy === 'FIXED_SET') {
    const order = config.fixedOrder ?? [];
    const byKey = new Map(deduped.map((q) => [`${q.questionId}@${q.publishedVersion}`, q]));
    const selected = order
      .map((member) => byKey.get(`${member.questionId}@${member.publishedVersion}`))
      .filter((question): question is EligibleQuestion => question !== undefined);

    // A FIXED_SET that lost a member is insufficient by definition: the
    // approver pinned an exact list, and serving a subset is a different
    // assessment.
    requireCount(selected.length, order.length, 'The fixed question set is incomplete');
    // No shuffle: FIXED_SET with a fixed order keeps it (§6.1).
    return { selected, seed, strategy: config.strategy };
  }

  if (config.strategy === 'TOPIC_DISTRIBUTION' || config.strategy === 'TOPIC_BALANCED') {
    const byTopic = new Map<string, EligibleQuestion[]>();
    for (const question of deduped) {
      const list = byTopic.get(question.topicId) ?? [];
      list.push(question);
      byTopic.set(question.topicId, list);
    }

    const counts =
      config.strategy === 'TOPIC_DISTRIBUTION'
        ? (config.topicCounts ?? {})
        : allocateEvenly([...byTopic.keys()].sort(), config.questionCount);

    const selected: EligibleQuestion[] = [];
    for (const topicId of Object.keys(counts).sort()) {
      const required = counts[topicId] ?? 0;
      const available = byTopic.get(topicId) ?? [];
      requireCount(available.length, required, `Topic ${topicId} is short`);
      // Shuffled per topic with a topic-scoped seed, so adding a topic does not
      // change which questions another topic contributes.
      selected.push(...seededShuffle(available, `${seed}:${topicId}`).slice(0, required));
    }

    requireCount(selected.length, config.questionCount, 'The topic allocation is short');
    return {
      selected: seededShuffle(selected, seed),
      seed,
      strategy: config.strategy,
    };
  }

  // RANDOM_POOL
  requireCount(deduped.length, config.questionCount, 'The question pool is short');
  return {
    selected: seededShuffle(deduped, seed).slice(0, config.questionCount),
    seed,
    strategy: config.strategy,
  };
};

/**
 * Spreads a question count across topics as evenly as possible.
 *
 * The remainder goes to the earliest topics in sorted order, so the allocation
 * is deterministic rather than dependent on map iteration.
 */
export const allocateEvenly = (
  topicIds: readonly string[],
  questionCount: number,
): Record<string, number> => {
  const out: Record<string, number> = {};
  if (topicIds.length === 0) return out;

  const base = Math.floor(questionCount / topicIds.length);
  let remainder = questionCount % topicIds.length;

  for (const topicId of topicIds) {
    out[topicId] = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
  }
  return out;
};
