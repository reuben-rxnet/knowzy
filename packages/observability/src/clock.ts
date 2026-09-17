// One injected clock — data-model.md §9 T3.
//
// Application code obtains "now" from Clock.now(), never from `new Date()`
// scattered through services. The lint rule in repository-structure.md §5.2 C6
// enforces that for @knowzy/domain and @knowzy/database; this module is the
// sanctioned implementation, which is why it is the one place `new Date()`
// legitimately appears.

export interface Clock {
  /** Current instant. Always UTC — there is no local-time accessor. */
  now(): Date;
  /** Milliseconds since the epoch. */
  nowMs(): number;
  /** ISO-8601 with a `Z` suffix, for wire and audit use. */
  nowIso(): string;
}

const currentDate = (): Date => new Date();

export const systemClock: Clock = {
  now: () => currentDate(),
  nowMs: () => currentDate().getTime(),
  nowIso: () => currentDate().toISOString(),
};

/**
 * A clock pinned to an instant, for tests. Every time-dependent behaviour in
 * the platform — expiry, availability windows, retake cooling-off, retention —
 * is testable deterministically because of this.
 */
export class FixedClock implements Clock {
  private current: number;

  constructor(instant: Date | string | number) {
    this.current = FixedClock.toMs(instant);
  }

  private static toMs(instant: Date | string | number): number {
    if (typeof instant === 'number') return instant;
    if (instant instanceof Date) return instant.getTime();
    return new Date(instant).getTime();
  }

  now(): Date {
    return new Date(this.current);
  }

  nowMs(): number {
    return this.current;
  }

  nowIso(): string {
    return this.now().toISOString();
  }

  /** Advance the clock. Returns the new instant. */
  advanceMs(ms: number): Date {
    this.current += ms;
    return this.now();
  }

  advanceSeconds(seconds: number): Date {
    return this.advanceMs(seconds * 1000);
  }

  setTo(instant: Date | string | number): Date {
    this.current = FixedClock.toMs(instant);
    return this.now();
  }
}

/**
 * Resolves a half-open UTC interval for a date-only boundary in a named IANA
 * zone — data-model.md §9 T6. Returned as [startUtc, endUtc) so there is no
 * gap or overlap at midnight (T7), and the resolved interval is displayed with
 * every report that used it (reporting.md §6 P3).
 *
 * Converting through the zone rather than a fixed offset is what makes a
 * DST-transition day correctly cover 23 or 25 hours (T8).
 */
export const resolveDateOnlyInterval = (
  fromDateIso: string,
  toDateIsoExclusive: string,
  timeZone: string,
): { startUtc: Date; endUtc: Date; timeZone: string } => {
  const zoneOffsetMsAt = (instant: Date): number => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(instant);

    const get = (type: Intl.DateTimeFormatPartTypes): number => {
      const found = parts.find((p) => p.type === type);
      return found ? Number(found.value) : 0;
    };

    const asUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
      get('second'),
    );
    return asUtc - instant.getTime();
  };

  const zoneMidnightToUtc = (dateIso: string): Date => {
    const naiveUtc = new Date(`${dateIso}T00:00:00Z`);
    // Two passes: the first offset is evaluated at the naive instant, the
    // second at the corrected one, which resolves dates that sit near a
    // transition.
    const firstPass = new Date(naiveUtc.getTime() - zoneOffsetMsAt(naiveUtc));
    return new Date(naiveUtc.getTime() - zoneOffsetMsAt(firstPass));
  };

  return {
    startUtc: zoneMidnightToUtc(fromDateIso),
    endUtc: zoneMidnightToUtc(toDateIsoExclusive),
    timeZone,
  };
};
