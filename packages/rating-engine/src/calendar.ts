import { DateTime } from 'luxon';
import {
  CALENDAR_DAY_TYPES,
  SLOTS_PER_DAY,
  monthDayOrdinal,
  seasonOrdinals,
  slotForLocalTime,
  slotRange,
  type DayType,
  type HolidayCalendar,
  type Season,
  type Tariff,
} from '@boring/tariff-schema';
import { RatingError } from './errors.js';
import type { DayClassification, SeasonSegment } from './types.js';

/**
 * Local-clock calendar work. Everything here is DST-aware by construction:
 * calendar arithmetic goes through luxon in the tariff's zone, so a day is
 * whatever length the zone says it is.
 */

/** Season lookup by month-day ordinal, built once per rating. */
function buildSeasonTable(seasons: readonly Season[]): (string | undefined)[] {
  const table = new Array<string | undefined>(366);
  for (const season of seasons) {
    for (const ordinal of seasonOrdinals(season)) table[ordinal] = season.id;
  }
  return table;
}

/** Zoned midnight for a local date, or a RatingError naming the problem. */
export function localMidnight(date: string, zone: string): DateTime {
  const dt = DateTime.fromISO(date, { zone });
  if (!dt.isValid) {
    throw new RatingError(`cannot interpret "${date}" in time zone "${zone}": ${dt.invalidReason}`, {
      explanation: dt.invalidExplanation,
    });
  }
  return dt.startOf('day');
}

export interface Calendar {
  zone: string;
  /** One entry per local day in `[start, end)`. */
  days: DayClassification[];
  /** Local date -> index into `days`. */
  dayIndex: Map<string, number>;
  segments: SeasonSegment[];
  /** `seasonId|dayType` -> 96 quarter-hour slots of period id. */
  touTable: Map<string, (string | undefined)[]>;
  holidaysInPeriod: string[];
  /** Elapsed hours across the whole period: not `days * 24` across a transition. */
  hours: number;
  periodStart: DateTime;
  /** Exclusive. */
  periodEnd: DateTime;
}

/**
 * Classifies every local day in the billing period, and builds the quarter-hour
 * TOU lookup.
 *
 * A day's length comes from luxon (`plus({ days: 1 })` is calendar arithmetic, so
 * it lands on the next local midnight regardless of a transition in between).
 * Elapsed hours are measured separately, which is what makes a 23- or 25-hour day
 * observable rather than assumed away.
 */
export function buildCalendar(
  tariff: Tariff,
  billingPeriod: { start: string; end: string; timezone: string },
  holidayCalendar: HolidayCalendar,
): Calendar {
  const zone = billingPeriod.timezone;
  const seasonTable = buildSeasonTable(tariff.seasons);
  const holidays = new Set(holidayCalendar.observedDates);

  const periodStart = localMidnight(billingPeriod.start, zone);
  const periodEnd = localMidnight(billingPeriod.end, zone);

  const days: DayClassification[] = [];
  const dayIndex = new Map<string, number>();
  const holidaysInPeriod: string[] = [];

  let cursor = periodStart;
  while (cursor < periodEnd) {
    const next = cursor.plus({ days: 1 });
    const date = cursor.toISODate();
    if (date === null) throw new RatingError('luxon produced an invalid local date');

    const ordinal = monthDayOrdinal({ month: cursor.month, day: cursor.day });
    const seasonId = seasonTable[ordinal];
    if (seasonId === undefined) {
      // Unreachable for a tariff that parsed, since seasons must tile the year.
      throw new RatingError(`no season covers ${date} in tariff "${tariff.id}"`);
    }

    const isHoliday = holidays.has(date);
    if (isHoliday) holidaysInPeriod.push(date);

    days.push({
      date,
      seasonId,
      dayType: isHoliday ? tariff.holidayTreatment.mapsToDayType : calendarDayType(cursor),
      isHoliday,
      // Measured, not assumed: 23 on spring-forward, 25 on fall-back.
      hours: next.diff(cursor, 'hours').hours,
    });
    dayIndex.set(date, days.length - 1);
    cursor = next;
  }

  return {
    zone,
    days,
    dayIndex,
    segments: buildSegments(days),
    touTable: buildTouTable(tariff),
    holidaysInPeriod,
    hours: periodEnd.diff(periodStart, 'hours').hours,
    periodStart,
    periodEnd,
  };
}

/** luxon weekday is 1 = Monday .. 7 = Sunday. */
function calendarDayType(dt: DateTime): DayType {
  const dayType = CALENDAR_DAY_TYPES[dt.weekday - 1];
  if (dayType === undefined) throw new RatingError(`unexpected weekday ${dt.weekday}`);
  return dayType;
}

/** Consecutive runs of days sharing a season. */
function buildSegments(days: readonly DayClassification[]): SeasonSegment[] {
  const segments: SeasonSegment[] = [];
  for (const day of days) {
    const last = segments[segments.length - 1];
    if (last !== undefined && last.seasonId === day.seasonId) {
      last.endDate = day.date;
      last.days += 1;
    } else {
      segments.push({ seasonId: day.seasonId, startDate: day.date, endDate: day.date, days: 1 });
    }
  }
  return segments;
}

/** `seasonId|dayType` -> 96 slots. Exhaustiveness was proven at parse time. */
function buildTouTable(tariff: Tariff): Map<string, (string | undefined)[]> {
  const table = new Map<string, (string | undefined)[]>();
  for (const rule of tariff.touRules) {
    const { start, end } = slotRange(rule.hours);
    for (const dayType of rule.dayTypes) {
      const key = `${rule.seasonId}|${dayType}`;
      let slots = table.get(key);
      if (slots === undefined) {
        slots = new Array<string | undefined>(SLOTS_PER_DAY);
        table.set(key, slots);
      }
      for (let slot = start; slot < end; slot += 1) slots[slot] = rule.periodId;
    }
  }
  return table;
}

export interface Placement {
  date: string;
  seasonId: string;
  dayType: DayType;
  periodId: string;
}

/**
 * Places an instant in the local calendar and the TOU table.
 *
 * The whole DST story lives in this function. The instant is converted to the
 * tariff's zone, its LOCAL date and LOCAL wall-clock time are read off, and those
 * index the season and the TOU table. On the fall-back day the two 01:30 instants
 * have different offsets but the same local hour, so both land in the period that
 * covers hour 1 — neither dropped nor double-counted. On the spring-forward day no
 * instant reads as 02:xx local, so the 02:00 slots are simply never consulted.
 *
 * Returns null when the instant falls outside the billing period.
 */
export function place(calendar: Calendar, instant: DateTime): Placement | null {
  const local = instant.setZone(calendar.zone);
  const date = local.toISODate();
  if (date === null) return null;

  const index = calendar.dayIndex.get(date);
  if (index === undefined) return null;
  const day = calendar.days[index];
  if (day === undefined) return null;

  const slots = calendar.touTable.get(`${day.seasonId}|${day.dayType}`);
  const periodId = slots?.[slotForLocalTime(local.hour, local.minute)];
  if (periodId === undefined) {
    throw new RatingError(
      `no TOU period for ${local.toISO()} (season "${day.seasonId}", day type "${day.dayType}")`,
    );
  }

  return { date, seasonId: day.seasonId, dayType: day.dayType, periodId };
}
