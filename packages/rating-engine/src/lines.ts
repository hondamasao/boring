import type { ChargeType, Component } from '@boring/tariff-schema';
import { roundToCents } from './money.js';
import type { BillLine, LineBasis } from './types.js';

export interface LineContext {
  tariffId: string;
  sheetRevision: string;
}

export interface LineDraft {
  id: string;
  chargeType: ChargeType;
  description: string;
  basis: LineBasis;
  quantity: number;
  unit: string;
  rate: number;
  /** Unrounded; rounded to cents on the way in. */
  amount: number;
  component: Component;
  stage: number;
  sourceId: string | null;
  /** JSON pointer into the tariff document. */
  path: string;
  seasonId?: string;
  periodId?: string;
  notes?: string[];
}

/**
 * Builds a bill line, rounding the amount to cents on the way in.
 *
 * Rounding here rather than at the end is deliberate: these are the numbers a
 * human sees on the paper bill, so they are what "each line item within $1" must
 * compare against. The total is then the sum of these, in integer cents.
 */
export function makeLine(context: LineContext, draft: LineDraft): BillLine {
  const line: BillLine = {
    id: draft.id,
    chargeType: draft.chargeType,
    description: draft.description,
    basis: draft.basis,
    quantity: draft.quantity,
    unit: draft.unit,
    rate: draft.rate,
    amount: roundToCents(draft.amount),
    component: draft.component,
    stage: draft.stage,
    sourceId: draft.sourceId,
    tariffRef: {
      tariffId: context.tariffId,
      sheetRevision: context.sheetRevision,
      path: draft.path,
    },
  };
  if (draft.seasonId !== undefined) line.seasonId = draft.seasonId;
  if (draft.periodId !== undefined) line.periodId = draft.periodId;
  if (draft.notes !== undefined && draft.notes.length > 0) line.notes = draft.notes;
  return line;
}
