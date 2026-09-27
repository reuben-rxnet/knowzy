// The previous-period comparison under a KPI.
//
// THE ONLY COMPONENT THAT MAY STATE A COMPARISON. The `rep.cmp*` copy keys are
// allow-listed by the no-fabricated-metrics contract test on one condition:
// that they are rendered from here and nowhere else. And this component prints
// a movement only when the API's comparison status is AVAILABLE — which the
// reporting package sets only when BOTH values were measured: a coverage
// snapshot recorded on the day the period began, or the same dated rows
// counted over the previous window. Every other status prints its own words,
// and "Not Yet Available" is what a reader sees until the history exists.
//
// Direction is shown by the arrow's SHAPE and the sign, never by colour alone,
// and the colour is neutral: whether a rise is good depends on the figure
// (cost), and a screen that painted every rise green would be editorializing.

import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { t } from '../copy';

export interface KpiComparisonData {
  readonly comparisonStatus: string;
  readonly direction: string | null;
  readonly change: number | null;
  readonly changePercent: number | null;
  readonly changeUnit: string;
  readonly basis: string;
  readonly baseFrom: string | null;
  readonly comparisonNote: string;
}

const signed = (value: number, digits: number): string =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toLocaleString('en-GB', {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  })}`;

const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

export const KpiComparison = ({
  data,
  windowDays,
}: {
  readonly data: KpiComparisonData;
  readonly windowDays: number;
}) => {
  if (data.comparisonStatus !== 'AVAILABLE') {
    const word =
      data.comparisonStatus === 'SUPPRESSED'
        ? t('rep.cmpSuppressed')
        : data.comparisonStatus === 'NOT_OBSERVABLE'
          ? t('rep.cmpNotObservable')
          : data.comparisonStatus === 'SCOPE_RESTRICTED'
            ? t('rep.cmpScope')
            : t('rep.cmpNotYet');
    return (
      <p className="text-xs font-medium text-ink-subtle" title={data.comparisonNote}>
        <span>{word}</span>
        <span className="knowzy-sr-only">. {data.comparisonNote}</span>
      </p>
    );
  }

  // Defined AFTER the guard on purpose: the movement wording is unreachable
  // for anything but a measured comparison, and the contract test checks the
  // order.
  const changeText = (): string => {
    const change = data.change ?? 0;
    if (data.direction === 'FLAT') return t('rep.cmpFlat');
    if (data.changeUnit === 'points') return t('rep.cmpPoints', { change: signed(change, 1) });
    if (data.changeUnit === 'currency') {
      return t('rep.cmpCurrency', { change: signed(change, Math.abs(change) < 0.01 ? 6 : 2) });
    }
    return data.changePercent === null
      ? signed(change, 0)
      : t('rep.cmpCountPercent', {
          change: signed(change, 0),
          percent: signed(data.changePercent, 1),
        });
  };

  const Arrow =
    data.direction === 'UP'
      ? ArrowUpRight
      : data.direction === 'DOWN'
        ? ArrowDownRight
        : ArrowRight;
  const against =
    data.basis === 'SNAPSHOT' && data.baseFrom !== null
      ? t('rep.cmpVsSnapshot', { date: shortDate(data.baseFrom) })
      : t('rep.cmpVsPreviousWindow', { days: windowDays });

  return (
    <p className="flex flex-col gap-0.5 text-xs" title={data.comparisonNote}>
      <span className="inline-flex items-center gap-1 font-semibold text-brand-navy-text">
        <Arrow aria-hidden="true" className="size-3.5" />
        {changeText()}
      </span>
      <span className="text-ink-subtle">{against}</span>
    </p>
  );
};
