/**
 * Tests for the AI credit pricing maths (utils/aiPricing).
 * Run via: pnpm --filter @85percent/api test:scripts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateQueryCost,
  INPUT_PRICE_PER_1M,
  OUTPUT_PRICE_PER_1M,
  MARGIN_MULTIPLIER,
} from '../utils/aiPricing.js'

test('zero tokens cost nothing', () => {
  assert.equal(calculateQueryCost(0, 0), 0)
})

test('input tokens are priced at the input rate + margin', () => {
  // Exactly 1M input tokens → input rate, then the 10% margin. The 6dp rounding
  // cleans up binary float drift (3.0 × 1.1 = 3.3000000000000003 → 3.3).
  assert.equal(calculateQueryCost(1_000_000, 0), 3.3)
  assert.equal(calculateQueryCost(1_000_000, 0), Math.round(INPUT_PRICE_PER_1M * MARGIN_MULTIPLIER * 1e6) / 1e6)
})

test('output tokens are priced at the (higher) output rate + margin', () => {
  assert.equal(calculateQueryCost(0, 1_000_000), 16.5)
  assert.equal(calculateQueryCost(0, 1_000_000), Math.round(OUTPUT_PRICE_PER_1M * MARGIN_MULTIPLIER * 1e6) / 1e6)
  // Output must be the more expensive side.
  assert.ok(calculateQueryCost(0, 1_000_000) > calculateQueryCost(1_000_000, 0))
})

test('a realistic mixed query: base cost × 1.10 margin', () => {
  // 2000 in + 500 out: (0.006 + 0.0075) × 1.1 = 0.01485
  const cost = calculateQueryCost(2000, 500)
  assert.equal(cost, 0.01485)
  // Always strictly greater than the raw cost (the margin is applied).
  const raw = 2000 / 1e6 * INPUT_PRICE_PER_1M + 500 / 1e6 * OUTPUT_PRICE_PER_1M
  assert.ok(cost > raw)
})

test('result is rounded to 6 dp (clean number for the NUMERIC column)', () => {
  const cost = calculateQueryCost(1, 1)
  assert.equal(cost, Math.round(cost * 1e6) / 1e6)
})

test('negative / non-finite token counts are treated as zero', () => {
  assert.equal(calculateQueryCost(-100, -100), 0)
  assert.equal(calculateQueryCost(Number.NaN, 500), calculateQueryCost(0, 500))
  assert.equal(calculateQueryCost(2000, Number.POSITIVE_INFINITY), calculateQueryCost(2000, 0))
})
