/**
 * Thrown when the inputs cannot be rated at all — a malformed tariff, a
 * time zone disagreement, a tariff whose effective window does not cover the
 * billing period.
 *
 * Deliberately distinct from a warning. Anything the engine can rate, it rates,
 * and reports its doubts in `ItemizedBill.warnings`; anything it cannot rate it
 * refuses loudly rather than guessing. Returning a plausible bill for inputs that
 * do not make sense is the failure mode this project cannot afford.
 */
export class RatingError extends Error {
  override readonly name = 'RatingError';

  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}
