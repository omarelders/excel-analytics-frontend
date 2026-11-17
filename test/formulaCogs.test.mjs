import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_MATERIALS, createInitialState } from '../src/features/formulaCogs/formulaDefaults.js'
import { calculateFormulaBreakdown, computeCostPerUnit } from '../src/features/formulaCogs/cogsMath.js'

test('all 27 default materials match packPrice / packQty === costPerUnit', () => {
  assert.equal(DEFAULT_MATERIALS.length, 27)
  for (const mat of DEFAULT_MATERIALS) {
    const computed = computeCostPerUnit(mat.packPrice, mat.packQty)
    assert.ok(
      Math.abs(computed - mat.costPerUnit) < 1e-9,
      `${mat.id}: expected ${mat.costPerUnit}, got ${computed}`,
    )
  }
})

test('default Body Butter and Body Splash formulas have 100.00% active sums', () => {
  const state = createInitialState()
  const materialsById = new Map(state.materials.map((m) => [m.id, m]))

  const bb = calculateFormulaBreakdown(state.products.body_butter, materialsById)
  assert.equal(bb.isPctBalanced, true)
  assert.ok(Math.abs(bb.activePctSum - 100) < 1e-9)
  assert.ok(Math.abs(bb.tracePctSum - 1.15) < 1e-9)

  // Verify 200g Body Butter default formula cost math
  // water: 117g * 0.013 = 1.521
  // frag_vanilla28: 6g * 4.45 = 26.70
  const fragRow = bb.rows.find((r) => r.materialId === 'frag_vanilla28')
  assert.ok(Math.abs(fragRow.qtyPerPiece - 6) < 1e-9)
  assert.ok(Math.abs(fragRow.rowCostPerPiece - 26.7) < 1e-9)

  const bs = calculateFormulaBreakdown(state.products.body_splash, materialsById)
  assert.equal(bs.isPctBalanced, true)
  assert.ok(Math.abs(bs.activePctSum - 100) < 1e-9)
  assert.ok(Math.abs(bs.tracePctSum - 0.1) < 1e-9)
})

test('changing piece weight, material price, packaging, stickers, batch, and selling price scales COGS accurately', () => {
  const state = createInitialState()
  // Double frag_vanilla28 packPrice from 445 to 890 (unit cost 4.45 -> 8.90)
  const materialsById = new Map(
    state.materials.map((m) =>
      m.id === 'frag_vanilla28' ? [m.id, { ...m, packPrice: 890 }] : [m.id, m],
    ),
  )

  const customSplash = {
    ...state.products.body_splash,
    pieceWeight: 200,
    unitsInBatch: 5,
    packagingCost: 15,
    stickersCost: 5,
    sellingPrice: 250,
  }

  const res = calculateFormulaBreakdown(customSplash, materialsById)
  const fragRow = res.rows.find((r) => r.materialId === 'frag_vanilla28')
  // 10% of 200g = 20g; 20g * 8.90 = 178 EGP
  assert.ok(Math.abs(fragRow.qtyPerPiece - 20) < 1e-9)
  assert.ok(Math.abs(fragRow.rowCostPerPiece - 178) < 1e-9)

  assert.ok(Math.abs(res.totalUnitCogs - (res.formulaCostPerPiece + 20)) < 1e-9)
  assert.ok(Math.abs(res.batchTotalCogs - res.totalUnitCogs * 5) < 1e-9)
  assert.equal(res.batchWeight, 1000)
  assert.ok(Math.abs(res.netProfit - (250 - res.totalUnitCogs)) < 1e-9)
  assert.ok(Math.abs(res.marginPct - ((res.netProfit / 250) * 100)) < 1e-9)
})

test('zero packQty and missing material are guarded without NaN or Infinity', () => {
  assert.equal(computeCostPerUnit(100, 0), 0)
  assert.equal(computeCostPerUnit(-50, 100), 0)

  const res = calculateFormulaBreakdown(
    {
      pieceWeight: 100,
      unitsInBatch: 0,
      packagingCost: '',
      stickersCost: -5,
      sellingPrice: 0,
      rows: [{ rowId: 'x', materialId: 'nonexistent', pct: 50, isTrace: false }],
    },
    new Map(),
  )
  assert.equal(res.unitsInBatch, 1)
  assert.equal(res.formulaCostPerPiece, 0)
  assert.equal(res.totalUnitCogs, 0)
  assert.equal(res.isPctBalanced, false)
})
