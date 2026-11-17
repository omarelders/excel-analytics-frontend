import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_MATERIALS, createInitialState } from '../src/features/formulaCogs/formulaDefaults.js'
import {
  calculateFormulaBreakdown,
  computeCostPerUnit,
  computeMaterialUnitCosts,
} from '../src/features/formulaCogs/cogsMath.js'

test('all 27 default materials match packPrice / packQty === costPerUnit and convert ml prices via density', () => {
  assert.equal(DEFAULT_MATERIALS.length, 27)
  for (const mat of DEFAULT_MATERIALS) {
    const computed = computeCostPerUnit(mat.packPrice, mat.packQty)
    assert.ok(
      Math.abs(computed - mat.costPerUnit) < 1e-9,
      `${mat.id}: expected ${mat.costPerUnit}, got ${computed}`,
    )
    assert.ok(mat.density > 0, `${mat.id} must have positive density`)
  }

  // Ethanol (0.79 g/ml) bought at 500 EGP / 5000 ml = 0.10 EGP/ml
  // True cost per gram = 0.10 / 0.79 = 0.126582278... EGP/g (naive 0.10 understated cost/g by 21%)
  const ethanol5l = DEFAULT_MATERIALS.find((m) => m.id === 'alc_mawardy_5l')
  const ethCosts = computeMaterialUnitCosts(ethanol5l)
  assert.ok(Math.abs(ethCosts.costPerMl - 0.1) < 1e-9)
  assert.ok(Math.abs(ethCosts.costPerGram - 0.1 / 0.79) < 1e-9)
  assert.ok(Math.abs((ethCosts.costPerGram - ethCosts.costPerMl) / ethCosts.costPerGram - 0.21) < 1e-9)

  // Jojoba oil (0.865 g/ml) bought at 412 EGP / 500 ml = 0.824 EGP/ml -> 0.952601 EGP/g
  const jojoba = DEFAULT_MATERIALS.find((m) => m.id === 'jojoba_oil')
  const jojobaCosts = computeMaterialUnitCosts(jojoba)
  assert.ok(Math.abs(jojobaCosts.costPerGram - 0.824 / 0.865) < 1e-9)
})

test('Body Butter (sold in g) and Body Splash (sold in ml) calibrate % w/w mass, volume, and COGS accurately', () => {
  const state = createInitialState()
  const materialsById = new Map(state.materials.map((m) => [m.id, m]))

  // 1. Body Butter: sold in 'g' (250 g jar)
  const bb = calculateFormulaBreakdown(state.products.body_butter, materialsById)
  assert.equal(bb.sellUnit, 'g')
  assert.equal(bb.isPctBalanced, true)
  assert.ok(Math.abs(bb.activePctSum - 100) < 1e-9)
  assert.ok(Math.abs(bb.tracePctSum - 1.15) < 1e-9)
  assert.ok(Math.abs(bb.baseMassGrams - 250) < 1e-9)

  // Jojoba row in 250g Body Butter: 4% w/w = 10.0g on scale, occupies 10.0 / 0.865 = 11.5607 ml
  // Cost = 10.0g * (0.824 / 0.865) EGP/g = 9.5260 EGP
  const jojobaRow = bb.rows.find((r) => r.materialId === 'jojoba_oil')
  assert.ok(Math.abs(jojobaRow.weightGramsPerPiece - 10) < 1e-9)
  assert.ok(Math.abs(jojobaRow.volumeMlPerPiece - 10 / 0.865) < 1e-9)
  assert.ok(Math.abs(jojobaRow.rowCostPerPiece - 10 * (0.824 / 0.865)) < 1e-9)

  // 2. Body Splash: sold in 'ml' (200 ml bottle)
  const bs = calculateFormulaBreakdown(state.products.body_splash, materialsById)
  assert.equal(bs.sellUnit, 'ml')
  assert.equal(bs.isPctBalanced, true)
  assert.ok(Math.abs(bs.activePctSum - 100) < 1e-9)
  assert.ok(Math.abs(bs.tracePctSum - 0.1) < 1e-9)

  // Mixture density of Body Splash (~0.8934 g/ml) means a 200 ml bottle holds ~178.67 g of active formula
  assert.ok(bs.mixDensity > 0.88 && bs.mixDensity < 0.91)
  assert.ok(Math.abs(bs.baseMassGrams - 200 * bs.mixDensity) < 1e-9)

  // Sum of active ingredient volumes in a 200 ml bottle equals 200.00 ml
  const activeVolSum = bs.rows
    .filter((r) => !r.isTrace)
    .reduce((sum, r) => sum + r.volumeMlPerPiece, 0)
  assert.ok(Math.abs(activeVolSum - 200) < 1e-9)

  // Ethanol row in 100 ml Body Splash: mass * costPerGram === volume * costPerMl
  const ethRow = bs.rows.find((r) => r.materialId === 'alc_mawardy_5l')
  assert.ok(
    Math.abs(
      ethRow.weightGramsPerPiece * ethRow.costPerGram -
        ethRow.volumeMlPerPiece * ethRow.costPerMl,
    ) < 1e-9,
  )
})

test('changing piece size, material price, packaging, stickers, batch, and selling price scales COGS accurately', () => {
  const state = createInitialState()
  const materialsById = new Map(
    state.materials.map((m) =>
      m.id === 'frag_vanilla28' ? [m.id, { ...m, packPrice: 890 }] : [m.id, m],
    ),
  )

  // Test in 'g' mode (200 g batch)
  const customSplashGrams = {
    ...state.products.body_splash,
    sellUnit: 'g',
    pieceWeight: 200,
    unitsInBatch: 5,
    packagingCost: 15,
    stickersCost: 5,
    sellingPrice: 250,
  }

  const res = calculateFormulaBreakdown(customSplashGrams, materialsById)
  const fragRow = res.rows.find((r) => r.materialId === 'frag_vanilla28')
  assert.ok(Math.abs(fragRow.weightGramsPerPiece - 20) < 1e-9)
  assert.ok(Math.abs(fragRow.rowCostPerPiece - 178) < 1e-9)
  assert.ok(Math.abs(res.totalUnitCogs - (res.formulaCostPerPiece + 20)) < 1e-9)
  assert.ok(Math.abs(res.batchTotalCogs - res.totalUnitCogs * 5) < 1e-9)
  assert.equal(res.batchWeight, 1000)
  assert.ok(Math.abs(res.netProfit - (250 - res.totalUnitCogs)) < 1e-9)
  assert.ok(Math.abs(res.marginPct - (res.netProfit / 250) * 100) < 1e-9)
})

test('zero packQty, invalid density, and missing material are guarded without NaN or Infinity', () => {
  assert.equal(computeCostPerUnit(100, 0), 0)
  assert.equal(computeCostPerUnit(-50, 100), 0)
  const badDensityMat = computeMaterialUnitCosts({ packPrice: 100, packQty: 100, unit: 'ml', density: 0 })
  assert.equal(badDensityMat.density, 1.0)
  assert.equal(badDensityMat.costPerGram, 1.0)

  const res = calculateFormulaBreakdown(
    {
      sellUnit: 'ml',
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
