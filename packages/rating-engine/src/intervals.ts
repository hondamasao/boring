import { DateTime } from 'luxon';
import type { LoadProfile } from '@boring/tariff-schema';
import { place, type Calendar, type Placement } from './calendar.js';
import { RatingError } from './errors.js';

/**
 * A metered demand window: the unit over which maximum demand is averaged.
 *
 * SCE defines maximum demand as the maximum average kW during any 15-minute
 * metered interval, with a 5-minute interval where the load is intermittent or
 * subject to violent fluctuation. `avgKw` is that average, over the minutes of
 * data actually present.
 */
export interface DemandWindow {
  startMs: number;
  startLocal: string;
  minutes: number;
  kwh: number;
  kvarh: number | null;
  avgKw: number;
  placement: Placement;
}

/** One metered interval, placed in the calendar. */
export interface PlacedReading {
  startMs: number;
  startLocal: string;
  kwh: number;
  kvarh: number | null;
  placement: Placement;
}

export interface NormalizedIntervals {
  readings: PlacedReading[];
  windows: DemandWindow[];
  windowMinutes: number;
  warnings: string[];
  /** Readings supplied that fall outside the billing period. */
  outsidePeriod: number;
  hasReactiveData: boolean;
}

/**
 * Places every reading, then aggregates readings into demand windows.
 *
 * Windows are keyed by flooring the instant to a multiple of the window length.
 * For America/Los_Angeles that coincides with local wall-clock boundaries,
 * because the zone's offsets are whole hours and window lengths divide an hour —
 * so a window never straddles a DST transition. A zone with a sub-hour offset
 * would break that alignment, so it is checked rather than assumed.
 */
export function normalizeIntervals(
  profile: LoadProfile,
  calendar: Calendar,
  windowMinutes: number,
): NormalizedIntervals {
  const warnings: string[] = [];
  const readings: PlacedReading[] = [];
  let outsidePeriod = 0;
  let hasReactiveData = false;
  let sawSubHourOffset = false;

  for (const reading of profile.readings) {
    const instant = DateTime.fromISO(reading.start, { setZone: true });
    if (!instant.isValid) {
      throw new RatingError(`unparseable interval start "${reading.start}": ${instant.invalidReason}`);
    }

    const local = instant.setZone(calendar.zone);
    if (local.offset % 60 !== 0) sawSubHourOffset = true;

    const placement = place(calendar, instant);
    if (placement === null) {
      outsidePeriod += 1;
      continue;
    }

    if (reading.kvarh !== undefined) hasReactiveData = true;
    readings.push({
      startMs: instant.toMillis(),
      startLocal: local.toISO({ suppressMilliseconds: true }) as string,
      kwh: reading.kwh,
      kvarh: reading.kvarh ?? null,
      placement,
    });
  }

  if (outsidePeriod > 0) {
    warnings.push(
      `${outsidePeriod} interval reading(s) fall outside the billing period and were not billed`,
    );
  }
  if (sawSubHourOffset) {
    warnings.push(
      `time zone "${calendar.zone}" has a sub-hour UTC offset in this period, so demand windows may not align to the local clock`,
    );
  }

  const straddles = countStraddles(profile, calendar, readings);
  if (straddles > 0) {
    warnings.push(
      `${straddles} interval reading(s) span a TOU period boundary; each was billed entirely to the period containing its start, which understates the finer-grained split`,
    );
  }

  let windows: DemandWindow[];
  if (profile.intervalMinutes > windowMinutes) {
    warnings.push(
      `interval data is ${profile.intervalMinutes} minutes, coarser than the ${windowMinutes}-minute demand window; the maximum demand may understate the metered figure`,
    );
    windows = readings.map((reading) => ({
      startMs: reading.startMs,
      startLocal: reading.startLocal,
      minutes: profile.intervalMinutes,
      kwh: reading.kwh,
      kvarh: reading.kvarh,
      avgKw: reading.kwh / (profile.intervalMinutes / 60),
      placement: reading.placement,
    }));
  } else {
    windows = aggregateWindows(readings, profile.intervalMinutes, windowMinutes);
  }

  return { readings, windows, windowMinutes, warnings, outsidePeriod, hasReactiveData };
}

/**
 * Groups readings into windows by flooring their instant.
 *
 * A window's `avgKw` divides by the minutes of data actually present, not the
 * nominal window length, so a gap in the data does not silently deflate a peak
 * into looking smaller than it was.
 */
function aggregateWindows(
  readings: readonly PlacedReading[],
  intervalMinutes: number,
  windowMinutes: number,
): DemandWindow[] {
  const windowMs = windowMinutes * 60_000;
  const byWindow = new Map<number, DemandWindow>();

  for (const reading of readings) {
    const key = Math.floor(reading.startMs / windowMs);
    const existing = byWindow.get(key);
    if (existing === undefined) {
      byWindow.set(key, {
        startMs: key * windowMs,
        startLocal: reading.startLocal,
        minutes: intervalMinutes,
        kwh: reading.kwh,
        kvarh: reading.kvarh,
        avgKw: 0,
        placement: reading.placement,
      });
    } else {
      existing.minutes += intervalMinutes;
      existing.kwh += reading.kwh;
      if (reading.kvarh !== null) existing.kvarh = (existing.kvarh ?? 0) + reading.kvarh;
    }
  }

  const windows = [...byWindow.values()].sort((a, b) => a.startMs - b.startMs);
  for (const window of windows) {
    window.avgKw = window.kwh / (window.minutes / 60);
  }
  return windows;
}

/** Readings whose span crosses a TOU period change. */
function countStraddles(
  profile: LoadProfile,
  calendar: Calendar,
  readings: readonly PlacedReading[],
): number {
  let count = 0;
  for (const reading of readings) {
    const lastInstant = DateTime.fromMillis(reading.startMs + profile.intervalMinutes * 60_000 - 1, {
      zone: calendar.zone,
    });
    const atEnd = place(calendar, lastInstant);
    if (atEnd !== null && atEnd.periodId !== reading.placement.periodId) count += 1;
  }
  return count;
}

/** The highest window in a set, with the window that produced it. */
export function peakOf(windows: readonly DemandWindow[]): { kw: number; at: string | null } {
  let best: DemandWindow | null = null;
  for (const window of windows) {
    if (best === null || window.avgKw > best.avgKw) best = window;
  }
  return best === null ? { kw: 0, at: null } : { kw: best.avgKw, at: best.startLocal };
}

/** The highest reactive demand in a set, in kVAR. */
export function peakKvar(windows: readonly DemandWindow[]): number {
  let peak = 0;
  for (const window of windows) {
    if (window.kvarh === null) continue;
    peak = Math.max(peak, window.kvarh / (window.minutes / 60));
  }
  return peak;
}
