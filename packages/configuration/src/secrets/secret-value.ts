// A secret that can only be read on purpose.
//
// The failure this exists to prevent is not a clever attack; it is a log line.
// `logger.info('calling provider', { settings })`, an error that interpolates
// its input, a response that spreads an object with one field too many -- each
// has put a key in a log somewhere, and none of them was written by somebody
// trying to. So the value is held in a closure, and every path that turns an
// object into text by accident prints `[redacted]`:
//
//   `${secret}`                 -> [redacted]   (toString)
//   JSON.stringify({ secret })  -> "[redacted]" (toJSON)
//   console.log(secret)         -> [redacted]   (util.inspect.custom)
//   Object.keys(secret)         -> []           (no enumerable own state)
//
// `reveal()` is the one way out, and grepping for it finds every place a key
// is used. In this build that is exactly one: the Authorization header of a
// readiness request.

import { inspect } from 'node:util';
import type { RevealableSecret } from '@knowzy/shared-types';

export const REDACTED = '[redacted]';

export class SecretValue implements RevealableSecret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  /** The length, for a diagnostic that needs to say "empty" without the value. */
  get length(): number {
    return this.#value.length;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [inspect.custom](): string {
    return REDACTED;
  }
}
