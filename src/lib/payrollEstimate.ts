// UK employer-cost + take-home estimator.
//
// This is a FORECAST for provisioning, not payroll. The exact figures come from
// the monthly payslip (see Debts → Salaries). The estimate assumes a standard
// tax code (full personal allowance), NI category A, auto-enrolment pension on
// qualifying earnings, no student loan, and no Employment Allowance offset
// (conservative — provisions the full employer NI). Real payroll can differ for
// non-standard tax codes, salary sacrifice, the Employment Allowance, bonuses,
// or mid-year rate changes.
//
// ── Update this table every April when HMRC publishes new thresholds. ──
export const TAX_YEAR = "2025/26";

const RATES = {
  // Income Tax (England / NI, standard code → full personal allowance)
  personalAllowance: 12_570,
  basicRateLimit: 50_270, // taxable income up to here at 20%
  higherRateLimit: 125_140, // up to here at 40%, above at 45%
  basicRate: 0.2,
  higherRate: 0.4,
  additionalRate: 0.45,
  // Employee National Insurance (Class 1, category A)
  niPrimaryThreshold: 12_570,
  niUpperEarningsLimit: 50_270,
  employeeNiMain: 0.08, // between PT and UEL
  employeeNiUpper: 0.02, // above UEL
  // Employer National Insurance (from April 2025: 15% above a £5,000 threshold)
  niSecondaryThreshold: 5_000,
  employerNiRate: 0.15,
  // Auto-enrolment pension (NEST minimums) on qualifying earnings band
  pensionLower: 6_240,
  pensionUpper: 50_270,
  employeePension: 0.05,
  employerPension: 0.03,
} as const;

export interface PayrollEstimate {
  gross: number;
  incomeTax: number;
  employeeNi: number;
  employeePension: number;
  net: number; // employee take-home
  employerNi: number;
  employerPension: number;
  employerCost: number; // total cost to the studio (gross + employer NI + employer pension)
  taxYear: string;
}

const clampBand = (amount: number, lower: number, upper: number) =>
  Math.max(0, Math.min(amount, upper) - lower);

/**
 * Estimate a single MONTHLY period's employer on-costs (NI + pension) from that
 * period's gross — used to fill a payslip's employer figures when the document
 * itself doesn't show them. Annualises the period, estimates, divides back.
 */
export function estimateMonthlyEmployerOnCosts(periodGross: number): { employerNi: number; employerPension: number } {
  const e = estimatePayroll(Math.max(0, periodGross || 0) * 12);
  return { employerNi: e.employerNi / 12, employerPension: e.employerPension / 12 };
}

function incomeTaxOn(gross: number): number {
  const taxable = Math.max(0, gross - RATES.personalAllowance);
  if (taxable <= 0) return 0;
  // Band widths measured on taxable income (allowance already removed).
  const basicWidth = RATES.basicRateLimit - RATES.personalAllowance;
  const higherWidth = RATES.higherRateLimit - RATES.basicRateLimit;
  const basic = Math.min(taxable, basicWidth) * RATES.basicRate;
  const higher = Math.min(Math.max(0, taxable - basicWidth), higherWidth) * RATES.higherRate;
  const additional = Math.max(0, taxable - basicWidth - higherWidth) * RATES.additionalRate;
  return basic + higher + additional;
}

/** Estimate take-home and true employer cost from a gross annual salary. */
export function estimatePayroll(grossAnnual: number): PayrollEstimate {
  const gross = Math.max(0, grossAnnual || 0);
  const incomeTax = incomeTaxOn(gross);
  const employeeNi =
    clampBand(gross, RATES.niPrimaryThreshold, RATES.niUpperEarningsLimit) * RATES.employeeNiMain +
    Math.max(0, gross - RATES.niUpperEarningsLimit) * RATES.employeeNiUpper;
  const qualifying = clampBand(gross, RATES.pensionLower, RATES.pensionUpper);
  const employeePension = qualifying * RATES.employeePension;
  const employerPension = qualifying * RATES.employerPension;
  const employerNi = Math.max(0, gross - RATES.niSecondaryThreshold) * RATES.employerNiRate;
  const net = gross - incomeTax - employeeNi - employeePension;
  return {
    gross,
    incomeTax,
    employeeNi,
    employeePension,
    net,
    employerNi,
    employerPension,
    employerCost: gross + employerNi + employerPension,
    taxYear: TAX_YEAR,
  };
}
