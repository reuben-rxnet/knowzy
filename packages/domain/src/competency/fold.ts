// The one fold every competency label is compared through —
// docs/competencies/COMPETENCY_MODEL.md §5.1.
//
// The fold decides EQUALITY and nothing else. It never produces a display name
// and never a code on its own, because "React JS" and "reactjs" are the same
// competency but only one of them is how a person writes it.

/**
 * NFKC, lower case, `&` to `and`, then everything but `a-z 0-9 + #` removed.
 *
 * `+` and `#` survive because `C++` and `C#` are not `C`, and `.` does not
 * because `.NET` and `NET` are one thing written two ways.
 */
export const foldLabel = (label: string): string =>
  label
    .normalize('NFKC')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9+#]/g, '');

/**
 * Levenshtein distance, bounded: returns `limit + 1` as soon as the distance
 * is known to exceed `limit`. Used only for NEAR-MATCH detection (rule N3),
 * never to merge anything — a near match stops the import for a person to
 * decide.
 */
export const boundedEditDistance = (a: string, b: string, limit: number): number => {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_value, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMinimum = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        (previous[j] as number) + 1,
        (current[j - 1] as number) + 1,
        (previous[j - 1] as number) + cost,
      );
      current.push(value);
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length] as number;
};

/** The near-match rule N3: both folds at least 4 characters, distance at most 2. */
export const isNearMatch = (a: string, b: string): boolean =>
  a !== b && a.length >= 4 && b.length >= 4 && boundedEditDistance(a, b, 2) <= 2;

/**
 * A code segment for an UNDECLARED label (rule N4): upper snake case of its
 * words. `Launch Darkly` becomes `LAUNCH_DARKLY`. Declared competencies carry
 * their code in the profile and never pass through here.
 */
export const deriveCodeSegment = (label: string): string => {
  const segment = label
    .normalize('NFKC')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/\+/g, 'P')
    .replace(/#/g, 'SHARP')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return segment.length > 0 ? segment : 'UNNAMED';
};
