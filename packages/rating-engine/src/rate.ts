import type {
  BillingPeriod,
  LoadProfile,
  RatingContextInput,
  TariffInput,
} from '@boring/tariff-schema';
import type { ItemizedBill } from './types.js';

/**
 * Rate a load profile against a tariff for one billing period.
 *
 * Pure and deterministic (CLAUDE.md #1): no network, no LLM, no file system, no
 * clock, no randomness. Every input is an argument — including the holiday
 * calendar and the prior-month demand history — so the same inputs always
 * produce the same itemization.
 *
 * All TOU bucketing happens in the tariff's local clock time and is DST-aware:
 * the spring-forward day has 23 hours, the fall-back day has 25, and a 4 pm - 9
 * pm window is five clock-hours on both.
 */
export function rate(
  _loadProfile: LoadProfile,
  _tariff: TariffInput,
  _billingPeriod: BillingPeriod,
  _context: RatingContextInput,
): ItemizedBill {
  throw new Error('rate() is not implemented yet');
}
