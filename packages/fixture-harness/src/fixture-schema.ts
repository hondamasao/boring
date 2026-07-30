import { z } from 'zod';
import { DemandHistory, Identifier, IsoDate, IsoInstant, NonNegativeRate, Rate, ServiceAttributes } from '@boring/tariff-schema';

/** Version of the fixture format, independent of the tariff schema's version. */
export const FIXTURE_SCHEMA_VERSION = '1.0.0';

/** Default tolerances, from CLAUDE.md invariant #2. */
export const DEFAULT_TOLERANCES = { totalPercent: 0.5, lineDollars: 1.0 } as const;

/**
 * One line as transcribed from a paper bill.
 *
 * `description` is the bill's own wording, which is how a line is matched to an
 * engine line — the engine's ids mean nothing to SCE. `quantity` and `rate` are
 * optional because some bills print only an amount.
 */
export const ExpectedLine = z
  .object({
    description: z.string().min(1),
    /** The engine charge type this line should map to, when known. */
    chargeType: z
      .enum([
        'energy',
        'facilities-demand',
        'time-related-demand',
        'customer-charge',
        'meter-charge',
        'daily-minimum-charge',
        'rider',
        'power-factor-adjustment',
        'minimum-bill-adjustment',
      ])
      .nullable(),
    /** Id of the tariff node expected to produce this line. The strongest match. */
    sourceId: Identifier.nullable(),
    quantity: Rate.nullable(),
    unit: z.string().nullable(),
    rate: Rate.nullable(),
    amount: Rate,
  })
  .strict();
export type ExpectedLine = z.infer<typeof ExpectedLine>;

/**
 * A hand-transcribed bill plus everything needed to reproduce it.
 *
 * CLAUDE.md invariant #2: for any real bill here, rating the customer's actual
 * interval data against their actual schedule must match — total within 0.5%,
 * every line item within $1. A fixture is GROUND TRUTH. Never adjust one to make
 * a test pass; fix the engine or flag the tariff.
 */
export const BillFixture = z
  .object({
    fixtureSchemaVersion: z.literal(FIXTURE_SCHEMA_VERSION),

    /**
     * Required, with no default. A suite that is green on synthetic fixtures
     * alone proves the engine is self-consistent, not that it is correct, and the
     * harness must be able to say which it is.
     */
    synthetic: z.boolean(),

    /** Required when synthetic: how the numbers were fabricated. */
    syntheticNotes: z.string().min(1).optional(),

    id: Identifier,
    label: z.string().min(1),

    source: z
      .object({
        utility: z.literal('SCE'),
        /** Never a real account number — a local reference only. */
        accountRef: z.string().nullable(),
        transcribedBy: z.string().min(1),
        transcribedAt: IsoInstant,
        /** Path under fixtures/bills/ to the scanned PDF, when kept. */
        billPdfRef: z.string().nullable(),
        notes: z.string().optional(),
      })
      .strict(),

    /** Path, relative to the fixtures root, of the tariff record to rate against. */
    tariffRef: z.string().min(1),
    /** Asserted against the loaded tariff, so a fixture cannot drift onto another record. */
    tariffId: Identifier,

    /** Path, relative to the fixtures root, of the interval data. */
    intervalsRef: z.string().min(1),
    /** Path, relative to the fixtures root, of the holiday calendar. */
    holidayCalendarRef: z.string().min(1),

    billingPeriod: z
      .object({
        start: IsoDate,
        /** Exclusive. */
        end: IsoDate,
        timezone: z.string().min(1),
        meterCount: z.number().int().positive(),
      })
      .strict(),

    demandHistory: DemandHistory.optional(),
    serviceAttributes: ServiceAttributes.optional(),

    expected: z
      .object({
        total: Rate,
        lines: z.array(ExpectedLine),
        /** Demands as printed on the bill, keyed by charge id. */
        reportedDemandsKw: z.record(Identifier, NonNegativeRate).optional(),
        totalKwh: NonNegativeRate.optional(),
      })
      .strict(),

    tolerances: z
      .object({
        totalPercent: z.number().positive(),
        lineDollars: z.number().positive(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((fixture, ctx) => {
    if (fixture.synthetic && fixture.syntheticNotes === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a synthetic fixture must explain how its numbers were fabricated',
        path: ['syntheticNotes'],
      });
    }
    if (!fixture.synthetic && fixture.syntheticNotes !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'syntheticNotes on a fixture marked real is contradictory',
        path: ['syntheticNotes'],
      });
    }
    // Tolerances looser than the invariant would quietly lower the bar.
    const tolerances = fixture.tolerances;
    if (tolerances !== undefined) {
      if (tolerances.totalPercent > DEFAULT_TOLERANCES.totalPercent) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `totalPercent ${tolerances.totalPercent} is looser than the ${DEFAULT_TOLERANCES.totalPercent}% invariant in CLAUDE.md`,
          path: ['tolerances', 'totalPercent'],
        });
      }
      if (tolerances.lineDollars > DEFAULT_TOLERANCES.lineDollars) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `lineDollars ${tolerances.lineDollars} is looser than the $${DEFAULT_TOLERANCES.lineDollars} invariant in CLAUDE.md`,
          path: ['tolerances', 'lineDollars'],
        });
      }
    }
  });
export type BillFixture = z.infer<typeof BillFixture>;

/**
 * Interval data as stored on disk, alongside the meter's own metadata.
 *
 * `synthetic` mirrors `BillFixture.synthetic` exactly, same reasoning: required
 * with no default, so a fabricated load profile can never be mistaken for a real
 * Green Button export by omission. A file generated to *look like* real usage
 * (e.g. a modeled restaurant load) is still synthetic — synthetic describes
 * where the numbers came from, not how plausible they look.
 */
export const IntervalFile = z
  .object({
    meterId: z.string().min(1).optional(),
    timezone: z.string().min(1),
    intervalMinutes: z.number().int().positive(),
    /** How this file was produced: a Green Button export, or fabricated. */
    provenance: z.string().min(1),
    synthetic: z.boolean(),
    /** Required when synthetic: exactly how the numbers were generated. */
    syntheticNotes: z.string().min(1).optional(),
    readings: z.array(
      z
        .object({
          start: IsoInstant,
          kwh: Rate,
          kvarh: Rate.optional(),
          kva: NonNegativeRate.optional(),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((file, ctx) => {
    if (file.synthetic && file.syntheticNotes === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a synthetic interval file must explain how its numbers were generated',
        path: ['syntheticNotes'],
      });
    }
    if (!file.synthetic && file.syntheticNotes !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'syntheticNotes on an interval file marked non-synthetic (a real Green Button export) is contradictory',
        path: ['syntheticNotes'],
      });
    }
  });
export type IntervalFile = z.infer<typeof IntervalFile>;
