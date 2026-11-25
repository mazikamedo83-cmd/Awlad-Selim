const ARABIC_DIGITS_MAP: Record<string, string> = {
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
  ',': '.',
};

export function round2(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

export function round3(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 1000) / 1000;
}

export function normalizeNumericText(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/[٠-٩۰-۹٫،,]/g, (ch) => ARABIC_DIGITS_MAP[ch] ?? ch)
    .replace(/\s+/g, '');
}

export function parseQuantity(raw: string | number, allowDecimals = true, fallback = 0): number {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return fallback;
    return allowDecimals ? round3(raw) : Math.round(raw);
  }
  const normalized = normalizeNumericText(String(raw ?? ''));
  if (!normalized || normalized === '.') return fallback;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return fallback;
  return allowDecimals ? round3(parsed) : Math.round(parsed);
}

export function clampQuantity(
  value: number,
  min = 0,
  max?: number,
  allowDecimals = true
): number {
  const safeMin = Number.isFinite(min) ? min : 0;
  let next = Number.isFinite(value) ? value : safeMin;
  if (next < safeMin) next = safeMin;
  if (max !== undefined && Number.isFinite(max) && next > max) {
    next = max;
  }
  return allowDecimals ? round3(next) : Math.round(next);
}

export function formatQuantity(value: unknown): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  const rounded = round3(num);
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

export function computeLineTotal(
  quantity: number,
  unitPrice: number,
  discount = 0
): number {
  const q = Number(quantity) || 0;
  const p = Number(unitPrice) || 0;
  const d = Number(discount) || 0;
  return Math.max(0, round2(q * p - d));
}
