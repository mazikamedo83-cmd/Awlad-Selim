const ARABIC_INDIC_DIGITS: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
  '٫': '.',
  '،': '.',
};

export function normalizeNumericText(raw: string): string {
  return String(raw ?? '')
    .replace(/[٠-٩۰-۹٫،]/g, (ch) => ARABIC_INDIC_DIGITS[ch] ?? ch)
    .replace(/,/g, '.')
    .trim();
}

export function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function round3(value: number): number {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

export function parseQuantity(raw: string | number, allowDecimals = true, fallback = 0): number {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return fallback;
    return allowDecimals ? round3(raw) : Math.round(raw);
  }
  const normalized = normalizeNumericText(raw);
  if (!normalized || normalized === '.' || normalized === '-') return fallback;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return fallback;
  return allowDecimals ? round3(parsed) : Math.round(parsed);
}

export function clampQuantity(value: number, min?: number, max?: number, allowDecimals = true): number {
  let next = Number.isFinite(value) ? value : min ?? 0;
  if (min !== undefined && next < min) next = min;
  if (max !== undefined && next > max) next = max;
  return allowDecimals ? round3(next) : Math.round(next);
}

export function computeLineTotal(quantity: number, unitPrice: number, discount = 0): number {
  const gross = (Number(quantity) || 0) * (Number(unitPrice) || 0);
  return Math.max(0, round2(gross - (Number(discount) || 0)));
}

export function formatQuantity(value: number): string {
  const num = round3(Number(value) || 0);
  return Number.isInteger(num) ? String(num) : String(num);
}
