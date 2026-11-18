/**
 * Pure utilities for direct mobile/desktop quantity input normalization,
 * validation, fractional support, and invoice line calculations.
 */

const ARABIC_DIGIT_MAP: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٫': '.', ',': '.', '،': '.',
};

export function round2(val: number): number {
  return Math.round((Number(val || 0) + Number.EPSILON) * 100) / 100;
}

export function round3(val: number): number {
  return Math.round((Number(val || 0) + Number.EPSILON) * 1000) / 1000;
}

export function normalizeNumericText(raw: string): string {
  return String(raw ?? '')
    .split('')
    .map((ch) => ARABIC_DIGIT_MAP[ch] ?? ch)
    .join('');
}

export function sanitizeQuantityInput(
  raw: string,
  options: { allowDecimals?: boolean; maxDecimals?: number } = {}
): string {
  const { allowDecimals = true, maxDecimals = 3 } = options;
  const normalized = normalizeNumericText(raw).trim();
  if (!normalized) return '';

  let result = '';
  let hasDecimal = false;
  let decimalCount = 0;

  for (const ch of normalized) {
    if (ch >= '0' && ch <= '9') {
      if (hasDecimal) {
        if (decimalCount >= maxDecimals) continue;
        decimalCount += 1;
      }
      result += ch;
    } else if (ch === '.' && allowDecimals && !hasDecimal) {
      hasDecimal = true;
      result = result === '' ? '0.' : `${result}.`;
    }
  }

  return result;
}

export function parsePositiveQuantity(
  raw: string | number,
  options: { min?: number; max?: number; fallback?: number; allowDecimals?: boolean } = {}
): number {
  const { min = 0.001, max, fallback = 1, allowDecimals = true } = options;
  const numeric =
    typeof raw === 'number'
      ? raw
      : Number.parseFloat(sanitizeQuantityInput(String(raw ?? ''), { allowDecimals: true }));

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  let val = allowDecimals ? round3(numeric) : Math.floor(numeric);
  if (val < min) val = min;
  if (typeof max === 'number' && Number.isFinite(max) && val > max) {
    val = allowDecimals ? round3(max) : Math.floor(max);
  }
  return val;
}

export function computeLineTotal(qty: number, unitPrice: number, discount = 0): number {
  const safeQty = Number.isFinite(qty) && qty > 0 ? qty : 0;
  const safePrice = Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : 0;
  const safeDiscount = Number.isFinite(discount) && discount >= 0 ? discount : 0;
  return Math.max(0, round2(safeQty * safePrice - safeDiscount));
}

export function computeInvoiceSummary(
  items: Array<{ quantity: number; unitPrice: number; discount?: number; total?: number }>,
  discountTotal = 0,
  taxTotal = 0
): {
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  grandTotal: number;
} {
  const subtotal = round2(
    (items || []).reduce((sum, it) => {
      const lineTotal =
        typeof it.total === 'number' && Number.isFinite(it.total)
          ? it.total
          : computeLineTotal(it.quantity, it.unitPrice, it.discount || 0);
      return sum + lineTotal;
    }, 0)
  );
  const safeDiscount = Math.max(0, round2(Number(discountTotal || 0)));
  const safeTax = Math.max(0, round2(Number(taxTotal || 0)));
  const grandTotal = Math.max(0, round2(subtotal - safeDiscount + safeTax));
  return {
    subtotal,
    discountTotal: safeDiscount,
    taxTotal: safeTax,
    grandTotal,
  };
}
