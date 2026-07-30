import { z } from 'zod';
import { Citation, Component, Identifier, Rate } from './primitives.js';

/** How a fixed charge scales. `per-meter-*` variants multiply by meter count. */
export const FixedChargeBasis = z.enum([
  'per-month',
  'per-day',
  'per-meter-per-month',
  'per-meter-per-day',
]);
export type FixedChargeBasis = z.infer<typeof FixedChargeBasis>;

export const FixedCharge = z
  .object({
    id: Identifier,
    label: z.string().min(1),
    basis: FixedChargeBasis,
    amount: Rate,
    component: Component,
    citation: Citation,
  })
  .strict();
export type FixedCharge = z.infer<typeof FixedCharge>;

/**
 * Charges that do not depend on metered quantities.
 *
 * Named slots rather than an array, because these three appear under fixed
 * headings on the sheet and a reader should be able to see at a glance whether a
 * schedule has a meter charge.
 *
 * `dailyMinimumCharge` is for a sheet that lists an ADDITIVE per-day amount in
 * its fixed-charge section. If your sheet's daily minimum is a FLOOR on the bill
 * rather than an amount added to it, model it as
 * `minimumBill: { kind: 'per-day', ... }` instead. The two produce different
 * bills for a low-usage month, so the distinction is not cosmetic and the field
 * is left null until the sheet is read.
 */
export const FixedCharges = z
  .object({
    customerCharge: FixedCharge.nullable(),
    meterCharge: FixedCharge.nullable(),
    dailyMinimumCharge: FixedCharge.nullable(),
  })
  .strict();
export type FixedCharges = z.infer<typeof FixedCharges>;

/** The fixed charges present, in bill order, with their slot names. */
export function presentFixedCharges(
  fixed: FixedCharges,
): { slot: keyof FixedCharges; charge: FixedCharge }[] {
  const slots: (keyof FixedCharges)[] = ['customerCharge', 'meterCharge', 'dailyMinimumCharge'];
  const present: { slot: keyof FixedCharges; charge: FixedCharge }[] = [];
  for (const slot of slots) {
    const charge = fixed[slot];
    if (charge !== null) present.push({ slot, charge });
  }
  return present;
}
