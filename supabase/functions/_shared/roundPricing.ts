// IMPORTANT: This file is duplicated and MUST stay byte-identical across:
//   - src/lib/roundPricing.ts                    (frontend)
//   - supabase/functions/_shared/roundPricing.ts (edge functions)
// Frontend and edge-function copies must match. Mirrors the LOGO_URL /
// clientMemberColours duplication pattern documented in CLAUDE.md.
//
// Round pricing for client-side scene booking.
// Round 01 = design realisation (full modelling/rendering).
// Round 02+ = correction/revision rounds.

export const ROUND_01_FEE_GBP = 2500;
export const ROUND_02_PLUS_FEE_GBP = 500;
export const VAT_RATE = 0.20;

export const FULL_PAYMENT_DISCOUNT_RATE = 0.03; // 3% off when paying 100% upfront
export const DEPOSIT_FRACTION = 0.5; // 50% upfront for the deposit option

export type PaymentOption = "deposit_50" | "full_100_discount_3";

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

/**
 * Given a booking's net/VAT/gross, compute what to charge now for a payment
 * option. deposit_50 = 50% now, 50% on delivery (net 15). full_100_discount_3 =
 * pay everything now with a 3% discount on the gross.
 */
export function calculatePaymentOption(
  netTotal: number,
  vatAmount: number,
  grossTotal: number,
  option: PaymentOption,
): { amount_to_charge: number; amount_outstanding: number; discount: number; label: string } {
  if (option === "deposit_50") {
    return {
      amount_to_charge: grossTotal * DEPOSIT_FRACTION,
      amount_outstanding: grossTotal * (1 - DEPOSIT_FRACTION),
      discount: 0,
      label: "50% deposit now, 50% on delivery (net 15)",
    };
  }
  const discount = grossTotal * FULL_PAYMENT_DISCOUNT_RATE;
  return {
    amount_to_charge: grossTotal - discount,
    amount_outstanding: 0,
    discount,
    label: "Pay in full now (3% discount)",
  };
}
