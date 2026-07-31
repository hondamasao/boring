/**
 * Re-derives headline numbers directly from the committed PDF, at test-run
 * time, and fails loudly if they ever drift from what's hardcoded in the
 * tariff JSON. This is the ongoing counterpart to the one-time independent
 * re-transcription done by hand — that caught mistakes once; this catches
 * them on every future change to either the PDF or the JSON.
 *
 * Deliberately does NOT re-derive the whole tariff (that would just be a
 * second, equally fallible transcription baked into test code, plus a
 * maintenance burden every time a real rate changes). It re-derives a small,
 * high-value set of numbers by parsing the PDF's own text directly with
 * regexes anchored on stable structural landmarks (sheet boundaries, rate-table
 * row labels) — not by trusting a cached extraction, and not by trusting this
 * file's own memory of what the PDF said.
 *
 * Uses the `pdftotext` CLI (from poppler-utils) rather than a pure-JS PDF
 * parser: a pure-JS attempt (pdf-parse) was tried first and abandoned — its
 * default text extraction concatenates adjacent table-cell numbers with no
 * delimiter (e.g. "0.005910.000000.001000.05674" for four consecutive cells),
 * which is fine for grep-by-eye but not safely machine-parseable. `pdftotext
 * -layout` preserves the column whitespace that makes the numbers
 * distinguishable. If poppler-utils isn't installed, every test here is
 * SKIPPED (not failed, not silently passed) with a clear message — this
 * check is a bonus for environments that have it, not a hard requirement to
 * run the rest of the suite.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { Tariff } from '@boring/tariff-schema';

const pdfPath = fileURLToPath(
  new URL('../../../fixtures/tariff-sheets/ELECTRIC_SCHEDULES_TOU-GS-2.pdf', import.meta.url),
);

function loadTariff(relPath: string) {
  return Tariff.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../tariffs/${relPath}`, import.meta.url)), 'utf8')));
}

let pdftotextAvailable = true;
let pdfText = '';
try {
  pdfText = execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
} catch (err) {
  pdftotextAvailable = false;
  // eslint-disable-next-line no-console
  console.warn(
    `pdf-self-check.test.ts: SKIPPED — \`pdftotext\` (poppler-utils) is not available in this environment (${String(err instanceof Error ? err.message : err)}). Install poppler-utils to run this check. The rest of the suite is unaffected.`,
  );
}

/** Slices the extracted text between two literal markers, each expected to
 * appear exactly once in the searched range. Throws if either is missing —
 * a missing landmark means the PDF's structure changed and this test needs
 * a human to look at it, not a silent skip. */
function sliceBetween(text: string, startMarker: string, endMarker: string, fromIndex = 0): string {
  const start = text.indexOf(startMarker, fromIndex);
  if (start === -1) throw new Error(`landmark not found: "${startMarker}"`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (end === -1) throw new Error(`landmark not found after "${startMarker}": "${endMarker}"`);
  return text.slice(start, end);
}

/** The single line containing the first match of `labelPattern` within `section`. */
function lineContaining(section: string, labelPattern: RegExp): string {
  const idx = section.search(labelPattern);
  if (idx === -1) throw new Error(`no line matches ${labelPattern} in this section`);
  const rest = section.slice(idx);
  const end = rest.indexOf('\n');
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * A rate table cell: a number, optionally followed by a "(R)" or "(I)" tag
 * marking that this particular figure changed in this filing (an unchanged
 * figure — including a long-standing $0.00 — carries no tag at all, as seen
 * on Option E's zero-rate TRD row). The tag is therefore optional everywhere,
 * not a reliable landmark.
 */
const CELL = String.raw`([\d.]+)(?:\s*\([RI]\))?`;

/** Parses "Total  UG  0.00000" at the end of an energy row — Total, then UG,
 * then DWREC (always 0.00000 in this document) anchors the end of the line. */
function parseEnergyRow(line: string): { total: number; generation: number } {
  const m = line.match(new RegExp(`${CELL}\\s+${CELL}\\s+0\\.00000\\s*$`));
  if (!m) throw new Error(`could not parse energy row: "${line}"`);
  return { total: Number(m[1]), generation: Number(m[2]) };
}

/** Parses a Facilities Related Demand row: "Trans   Distrbtn   Total". */
function parseFrdRow(line: string): { transmission: number; distribution: number; total: number } {
  const m = line.match(new RegExp(`${CELL}\\s+${CELL}\\s+${CELL}\\s*$`));
  if (!m) throw new Error(`could not parse FRD row: "${line}"`);
  return { transmission: Number(m[1]), distribution: Number(m[2]), total: Number(m[3]) };
}

/** Parses a Time Related Demand row: "Distrbtn   Total   UG". */
function parseTrdRow(line: string): { total: number; generation: number } {
  const m = line.match(new RegExp(`${CELL}\\s+${CELL}\\s+${CELL}\\s*$`));
  if (!m) throw new Error(`could not parse TRD row: "${line}"`);
  return { total: Number(m[2]), generation: Number(m[3]) };
}

describe.skipIf(!pdftotextAvailable)('PDF self-check: headline numbers re-derived from the PDF at test time', () => {
  let optionDSection: string;
  let optionESection: string;
  let optionD: ReturnType<typeof loadTariff>;
  let optionE: ReturnType<typeof loadTariff>;

  beforeAll(() => {
    // Sheet 4 = Option D's rate table, Sheet 5 = Option E's, Sheet 6 = Option B's
    // — used only as slice boundaries, not asserted on directly.
    optionDSection = sliceBetween(pdfText, 'Schedule TOU-GS-2', 'Sheet 5');
    optionESection = sliceBetween(pdfText, 'Sheet 5', 'Sheet 6');
    optionD = loadTariff('sce/tou-gs-2/option-d/2026-06-01.json');
    optionE = loadTariff('sce/tou-gs-2/option-e/2026-06-01.json');
  });

  it('Option D: Summer On-Peak energy rate matches the PDF', () => {
    const row = parseEnergyRow(lineContaining(optionDSection, /Summer Season - On-Peak/));
    const delivery = optionD.energyCharges.find((c) => c.id === 'energy-summer-on-peak-delivery');
    const generation = optionD.energyCharges.find((c) => c.id === 'energy-summer-on-peak-generation');
    expect(delivery?.pricing).toMatchObject({ kind: 'flat', ratePerKwh: row.total });
    expect(generation?.pricing).toMatchObject({ kind: 'flat', ratePerKwh: row.generation });
  });

  it('Option D: Facilities Related Demand rate matches the PDF', () => {
    const row = parseFrdRow(lineContaining(optionDSection, /Facilit\s*ies\s*Relat\s*ed\s*Demand\s*Charge/));
    const transmission = optionD.demandCharges.facilities.find((c) => c.id === 'frd-transmission');
    const distribution = optionD.demandCharges.facilities.find((c) => c.id === 'frd-distribution');
    expect(transmission?.ratePerKw).toBe(row.transmission);
    expect(distribution?.ratePerKw).toBe(row.distribution);
    expect((transmission?.ratePerKw ?? 0) + (distribution?.ratePerKw ?? 0)).toBeCloseTo(row.total, 6);
  });

  it('Option D: Summer On-Peak time-related demand rate matches the PDF', () => {
    const trdSection = optionDSection.slice(optionDSection.search(/Time Relat\s*ed\s*Demand\s*Charge/));
    const row = parseTrdRow(lineContaining(trdSection, /^\s*On-Peak/m));
    const delivery = optionD.demandCharges.timeRelated.find((c) => c.id === 'trd-summer-on-peak-delivery');
    const generation = optionD.demandCharges.timeRelated.find((c) => c.id === 'trd-summer-on-peak-generation');
    expect(delivery?.ratePerKw).toBe(row.total);
    expect(generation?.ratePerKw).toBe(row.generation);
  });

  // Same three checks for Option E, since it's the same amount of work and
  // doubles the safety net — and Option E is exactly where the earlier
  // secondary-source-based assumption turned out to be wrong.
  it('Option E: Summer On-Peak energy rate matches the PDF', () => {
    const row = parseEnergyRow(lineContaining(optionESection, /Summer - On-Peak/));
    const delivery = optionE.energyCharges.find((c) => c.id === 'energy-summer-on-peak-delivery');
    const generation = optionE.energyCharges.find((c) => c.id === 'energy-summer-on-peak-generation');
    expect(delivery?.pricing).toMatchObject({ kind: 'flat', ratePerKwh: row.total });
    expect(generation?.pricing).toMatchObject({ kind: 'flat', ratePerKwh: row.generation });
  });

  it('Option E: Facilities Related Demand rate matches the PDF', () => {
    const row = parseFrdRow(lineContaining(optionESection, /Facilit\s*ies\s*Relat\s*ed\s*Demand\s*Charge/));
    const transmission = optionE.demandCharges.facilities.find((c) => c.id === 'frd-transmission');
    const distribution = optionE.demandCharges.facilities.find((c) => c.id === 'frd-distribution');
    expect(transmission?.ratePerKw).toBe(row.transmission);
    expect(distribution?.ratePerKw).toBe(row.distribution);
  });

  it('Option E: Summer On-Peak time-related demand — delivery is genuinely zero, generation is not', () => {
    const trdSection = optionESection.slice(optionESection.search(/Time Relat\s*ed\s*Demand\s*Charge/));
    const row = parseTrdRow(lineContaining(trdSection, /^\s*On-Peak/m));
    // This is the exact number the earlier secondary-source-based assumption
    // got wrong — pinned here so it can never silently regress.
    expect(row.total).toBe(0);
    expect(row.generation).toBe(5.65);
    expect(optionE.demandCharges.timeRelated.some((c) => c.id === 'trd-summer-on-peak-delivery')).toBe(false);
    const generation = optionE.demandCharges.timeRelated.find((c) => c.id === 'trd-summer-on-peak-generation');
    expect(generation?.ratePerKw).toBe(row.generation);
  });
});
