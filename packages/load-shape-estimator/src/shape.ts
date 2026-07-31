/**
 * A generic small-commercial hour-of-day shape: low overnight, ramping up
 * through the morning, a business-hours plateau, ramping down in the
 * evening; weekends lower and shorter. This is a deliberately generic
 * placeholder, not derived from any real business's data — it exists only
 * for bills with no interval data to scale against (see estimate.ts). A
 * restaurant with a dinner rush, a 24-hour operation, or anything
 * refrigeration-heavy will not actually look like this.
 *
 * Values are relative intensity in [0, 1], one per hour of the local day.
 * Flat within each hour: a bill's totals carry no sub-hourly information, so
 * pretending finer resolution would be manufactured precision, not signal.
 */
export type DayType = 'weekday' | 'weekend';

const WEEKDAY_HOURLY: readonly number[] = [
  0.25, 0.22, 0.2, 0.2, 0.2, 0.22, 0.3, 0.55, 0.8, 0.95, 1.0, 1.0, 0.98, 0.98, 0.95, 0.92, 0.88, 0.8, 0.65, 0.5, 0.4,
  0.35, 0.3, 0.27,
];

const WEEKEND_HOURLY: readonly number[] = [
  0.18, 0.16, 0.15, 0.15, 0.15, 0.16, 0.18, 0.2, 0.28, 0.4, 0.5, 0.55, 0.55, 0.53, 0.5, 0.48, 0.45, 0.4, 0.32, 0.26,
  0.22, 0.2, 0.19, 0.18,
];

/** luxon's `DateTime.weekday`: 1 = Monday ... 7 = Sunday. */
export function dayType(weekday: number): DayType {
  return weekday >= 6 ? 'weekend' : 'weekday';
}

export function shapeMultiplier(hour: number, type: DayType): number {
  const table = type === 'weekday' ? WEEKDAY_HOURLY : WEEKEND_HOURLY;
  const value = table[hour];
  if (value === undefined) throw new RangeError(`hour out of range: ${hour}`);
  return value;
}
