// Round pricing for client-side scene booking.
// Keep in sync with the studio's quotation pricing model.
// Round 01 = design realisation (full modelling/rendering).
// Round 02+ = correction/revision rounds.

export const ROUND_01_FEE_GBP = 2500;
export const ROUND_02_PLUS_FEE_GBP = 500;
export const VAT_RATE = 0.20;

export function calculateRoundFee(roundNumber: number): number {
  return roundNumber === 1 ? ROUND_01_FEE_GBP : ROUND_02_PLUS_FEE_GBP;
}

export function calculateBookingTotals(numRounds: number): {
  netTotal: number;
  vatAmount: number;
  grossTotal: number;
  breakdown: { roundNumber: number; fee: number }[];
} {
  const breakdown = Array.from({ length: numRounds }, (_, i) => ({
    roundNumber: i + 1,
    fee: calculateRoundFee(i + 1),
  }));
  const netTotal = breakdown.reduce((sum, b) => sum + b.fee, 0);
  const vatAmount = netTotal * VAT_RATE;
  const grossTotal = netTotal + vatAmount;
  return { netTotal, vatAmount, grossTotal, breakdown };
}

/**
 * Totals for an arbitrary list of round numbers (used when booking "more
 * rounds" on a scene that already has rounds — e.g. booking Round 03 + 04).
 */
export function calculateTotalsForRounds(roundNumbers: number[]): {
  netTotal: number;
  vatAmount: number;
  grossTotal: number;
  breakdown: { roundNumber: number; fee: number }[];
} {
  const breakdown = roundNumbers.map((roundNumber) => ({
    roundNumber,
    fee: calculateRoundFee(roundNumber),
  }));
  const netTotal = breakdown.reduce((sum, b) => sum + b.fee, 0);
  const vatAmount = netTotal * VAT_RATE;
  const grossTotal = netTotal + vatAmount;
  return { netTotal, vatAmount, grossTotal, breakdown };
}
