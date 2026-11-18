import assert from 'node:assert/strict';
import {
  normalizeNumericText,
  sanitizeQuantityInput,
  parsePositiveQuantity,
  computeLineTotal,
  computeInvoiceSummary,
  round2,
  round3,
} from '../../src/utils/quantity.ts';

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(err);
    throw err;
  }
}

console.log('\n=== Quantity & Invoice Line Calculation Unit Tests ===');

test('1. normalizeNumericText converts Arabic-Indic, Persian digits, and Arabic decimal separators', () => {
  assert.equal(normalizeNumericText('٢٠'), '20');
  assert.equal(normalizeNumericText('٢٥٫٥'), '25.5');
  assert.equal(normalizeNumericText('۱۲۳,۴۵'), '123.45');
  assert.equal(normalizeNumericText('١٥،٧٥٠'), '15.750');
  assert.equal(normalizeNumericText('20.5'), '20.5');
});

test('2. sanitizeQuantityInput handles clearing, direct typing, decimals, and rejects text/negatives/double dots', () => {
  assert.equal(sanitizeQuantityInput(''), '');
  assert.equal(sanitizeQuantityInput('   '), '');
  assert.equal(sanitizeQuantityInput('abc'), '');
  assert.equal(sanitizeQuantityInput('20'), '20');
  assert.equal(sanitizeQuantityInput('٢٠'), '20');
  assert.equal(sanitizeQuantityInput('٢٥٫٥'), '25.5');
  assert.equal(sanitizeQuantityInput('2.'), '2.');
  assert.equal(sanitizeQuantityInput('.5'), '0.5');
  assert.equal(sanitizeQuantityInput('12.34.56'), '12.345');
  assert.equal(sanitizeQuantityInput('-15'), '15');
  assert.equal(sanitizeQuantityInput('20abc5'), '205');
  assert.equal(sanitizeQuantityInput('2.56789', { allowDecimals: true, maxDecimals: 3 }), '2.567');
  assert.equal(sanitizeQuantityInput('2.5', { allowDecimals: false }), '25');
});

test('3. parsePositiveQuantity enforces bounds, decimals, and fallback cleanly', () => {
  assert.equal(parsePositiveQuantity(''), 1);
  assert.equal(parsePositiveQuantity('', { fallback: 0 }), 0);
  assert.equal(parsePositiveQuantity('abc', { fallback: 2 }), 2);
  assert.equal(parsePositiveQuantity('20'), 20);
  assert.equal(parsePositiveQuantity('٢٫٧٥'), 2.75);
  assert.equal(parsePositiveQuantity('0', { min: 0.001 }), 0.001);
  assert.equal(parsePositiveQuantity('500', { max: 100 }), 100);
  assert.equal(parsePositiveQuantity('7.9', { allowDecimals: false }), 7);
});

test('4. computeLineTotal & computeInvoiceSummary calculate line totals, discounts, and taxes accurately', () => {
  assert.equal(round2(12.345), 12.35);
  assert.equal(round3(1.2346), 1.235);

  assert.equal(computeLineTotal(20, 15.5), 310);
  assert.equal(computeLineTotal(2.5, 10, 3), 22);
  assert.equal(computeLineTotal(0, 50), 0);
  assert.equal(computeLineTotal(1, 10, 50), 0);

  const summary = computeInvoiceSummary(
    [
      { quantity: 20, unitPrice: 12.5 }, // 250
      { quantity: 2.5, unitPrice: 40, discount: 10 }, // 90
    ],
    15, // invoice discount
    25 // tax
  );
  assert.deepEqual(summary, {
    subtotal: 340,
    discountTotal: 15,
    taxTotal: 25,
    grandTotal: 350,
  });
});

console.log(`\nQUANTITY UNIT TESTS PASSED (${passed}/${passed})`);
