/**
 * Bill amounts (EP02 consolidated). Money is an exact decimal string with at most two
 * fraction digits ("1250", "1250.5", "1250.50"), stored as DECIMAL(14,2). No floating-point
 * arithmetic is used anywhere for persisted money. Payment status is user-reported only —
 * FLOW never verifies a bank transfer and never processes payments.
 */
import { z } from 'zod';

export const BILL_CURRENCIES = ['THB'] as const;
export type BillCurrency = (typeof BILL_CURRENCIES)[number];
export const AMOUNT_MAX_INTEGER_DIGITS = 12;

const AMOUNT_RE = /^(0|[1-9]\d{0,11})(\.\d{1,2})?$/;

/** Normalizes "1,250.5" / " 1250.50 " → "1250.50"; returns null when not a valid amount. */
export function normalizeAmount(input: string): string | null {
  const s = input.trim().replace(/,/g, '');
  if (!AMOUNT_RE.test(s)) return null;
  const [int, frac = ''] = s.split('.') as [string, string?];
  return `${int}.${(frac + '00').slice(0, 2)}`;
}

export const amountSchema = z
  .string()
  .max(20)
  .transform((s, ctx) => {
    const n = normalizeAmount(s);
    if (n === null) {
      ctx.addIssue({ code: 'custom', message: 'invalid amount' });
      return z.NEVER;
    }
    return n;
  });

/** "1250.50" → "1,250.50" (grouping by string, never via Number). */
export function formatAmount(amount: string): string {
  const n = normalizeAmount(amount);
  if (n === null) return amount;
  const [int, frac] = n.split('.') as [string, string];
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`;
}

export function formatMoneyThai(amount: string | null, currency: BillCurrency = 'THB'): string {
  if (amount === null) return 'ไม่ระบุจำนวนเงิน';
  return `${formatAmount(amount)} ${currency === 'THB' ? 'บาท' : currency}`;
}

export const PAYMENT_STATUSES = ['UNPAID', 'PAID'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
