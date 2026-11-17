export function toNonNegNum(value) {
  if (value === '' || value === null || value === undefined) return 0
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return parsed
}

export function toPositiveDensity(value, fallback = 1.0) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

export function computeCostPerUnit(packPrice, packQty) {
  const price = toNonNegNum(packPrice)
  const qty = toNonNegNum(packQty)
  if (qty <= 0) return 0
  return price / qty
}

/**
 * Converts a material's pack price into both EGP/g and EGP/ml using density (g/ml).
 * - If bought in 'g':  costPerGram = packPrice / packQty; costPerMl = costPerGram * density
 * - If bought in 'ml': costPerMl   = packPrice / packQty; costPerGram = costPerMl / density
 *   (e.g. Ethanol @ 0.10 EGP/ml and 0.79 g/ml -> 0.1266 EGP/g, since 1g occupies 1.2658ml)
 */
export function computeMaterialUnitCosts(material) {
  if (!material) {
    return { costPerPackUnit: 0, costPerGram: 0, costPerMl: 0, density: 1.0 }
  }
  const density = toPositiveDensity(material.density, 1.0)
  const costPerPackUnit = computeCostPerUnit(material.packPrice, material.packQty)
  if (material.unit === 'ml') {
    return {
      costPerPackUnit,
      costPerMl: costPerPackUnit,
      costPerGram: costPerPackUnit / density,
      density,
    }
  }
  return {
    costPerPackUnit,
    costPerGram: costPerPackUnit,
    costPerMl: costPerPackUnit * density,
    density,
  }
}

/**
 * Computes full COGS breakdown for a product whose formula is defined in % w/w.
 * - When sellUnit === 'g' (Body Butter): pieceSize is target mass in grams (W_base = pieceSize).
 * - When sellUnit === 'ml' (Body Splash): pieceSize is target bottle volume in ml (V_base = pieceSize).
 *   Because the formula is % w/w, 100g of active formula occupies sum(pct_i / density_i) ml,
 *   giving mixture density rho_mix = activePctSum / sum(pct_i / density_i) g/ml.
 *   The mass needed to fill V_base ml is W_base = V_base * rho_mix grams.
 */
export function calculateFormulaBreakdown(product, materialsById) {
  const sellUnit = product?.sellUnit === 'ml' ? 'ml' : 'g'
  const pieceSize = toNonNegNum(product?.pieceWeight)
  const unitsInBatch = Math.max(1, Math.round(toNonNegNum(product?.unitsInBatch) || 1))
  const packagingCost = toNonNegNum(product?.packagingCost)
  const stickersCost = toNonNegNum(product?.stickersCost)
  const sellingPrice = toNonNegNum(product?.sellingPrice)

  let activePctSum = 0
  let tracePctSum = 0
  let activeSpecificVolSum = 0

  const rawRows = product?.rows || []
  for (const row of rawRows) {
    const pct = toNonNegNum(row.pct)
    const material = materialsById.get(row.materialId) || null
    const density = toPositiveDensity(material?.density, 1.0)
    if (row.isTrace) {
      tracePctSum += pct
    } else {
      activePctSum += pct
      activeSpecificVolSum += pct / density
    }
  }

  // Mixture specific gravity (g/ml) of the active formulation
  const mixDensity =
    activePctSum > 0 && activeSpecificVolSum > 0 ? activePctSum / activeSpecificVolSum : 1.0

  // Base 100% w/w mass (in grams) corresponding to one finished piece:
  // - If sold in 'g':  pieceSize is already in grams.
  // - If sold in 'ml': if measuredFillWeight (g per bottle) is provided, use it directly
  //   (capturing real contraction); otherwise fall back to pieceSize * mixDensity.
  const measuredFillWeightRaw = product?.measuredFillWeight
  const measuredFillWeightNum = toNonNegNum(measuredFillWeightRaw)
  const isMeasuredFillActive =
    sellUnit === 'ml' &&
    measuredFillWeightRaw !== null &&
    measuredFillWeightRaw !== '' &&
    measuredFillWeightNum > 0

  const theoreticalMassGrams = sellUnit === 'ml' ? pieceSize * mixDensity : pieceSize
  const baseMassGrams = isMeasuredFillActive ? measuredFillWeightNum : theoreticalMassGrams
  const effectiveDensity =
    sellUnit === 'ml' && pieceSize > 0 ? baseMassGrams / pieceSize : mixDensity
  const baseVolumeMl = sellUnit === 'ml' ? pieceSize : mixDensity > 0 ? pieceSize / mixDensity : pieceSize

  let formulaCostPerPiece = 0
  let totalMassGramsPerPiece = 0
  let totalVolumeMlPerPiece = 0

  const rows = rawRows.map((row) => {
    const material = materialsById.get(row.materialId) || null
    const pct = toNonNegNum(row.pct)
    const { costPerPackUnit, costPerGram, costPerMl, density } = computeMaterialUnitCosts(material)

    // % w/w always defines mass in grams on the scale:
    const weightGramsPerPiece = baseMassGrams * (pct / 100)
    // Volume occupied/drawn for this ingredient (ml = g / (g/ml)):
    const volumeMlPerPiece = weightGramsPerPiece / density

    // Cost is identical whether computed as grams * costPerGram or ml * costPerMl:
    const rowCostPerPiece = weightGramsPerPiece * costPerGram

    const batchWeightGrams = weightGramsPerPiece * unitsInBatch
    const batchVolumeMl = volumeMlPerPiece * unitsInBatch
    const batchRowCost = rowCostPerPiece * unitsInBatch

    formulaCostPerPiece += rowCostPerPiece
    totalMassGramsPerPiece += weightGramsPerPiece
    totalVolumeMlPerPiece += volumeMlPerPiece

    return {
      ...row,
      material,
      pctNum: pct,
      density,
      unitCost: costPerPackUnit,
      costPerGram,
      costPerMl,
      qtyPerPiece: weightGramsPerPiece,
      weightGramsPerPiece,
      volumeMlPerPiece,
      rowCostPerPiece,
      batchQty: batchWeightGrams,
      batchWeightGrams,
      batchVolumeMl,
      batchRowCost,
    }
  })

  const totalPctSum = activePctSum + tracePctSum
  const isPctBalanced = Math.abs(activePctSum - 100) < 0.005
  const totalUnitCogs = formulaCostPerPiece + packagingCost + stickersCost

  const batchWeight = baseMassGrams * unitsInBatch
  const batchVolume = baseVolumeMl * unitsInBatch
  const batchTotalMassGrams = totalMassGramsPerPiece * unitsInBatch
  const batchTotalVolumeMl = totalVolumeMlPerPiece * unitsInBatch
  const batchFormulaCost = formulaCostPerPiece * unitsInBatch
  const batchTotalCogs = totalUnitCogs * unitsInBatch

  const hasSellingPrice = sellingPrice > 0
  const netProfit = hasSellingPrice ? sellingPrice - totalUnitCogs : 0
  const marginPct = hasSellingPrice ? (netProfit / sellingPrice) * 100 : 0

  return {
    rows,
    sellUnit,
    pieceWeight: pieceSize,
    pieceSize,
    mixDensity,
    effectiveDensity,
    isMeasuredFillActive,
    theoreticalMassGrams,
    baseMassGrams,
    baseVolumeMl,
    totalMassGramsPerPiece,
    totalVolumeMlPerPiece,
    unitsInBatch,
    activePctSum,
    tracePctSum,
    totalPctSum,
    isPctBalanced,
    formulaCostPerPiece,
    packagingCost,
    stickersCost,
    totalUnitCogs,
    batchWeight,
    batchVolume,
    batchTotalMassGrams,
    batchTotalVolumeMl,
    batchFormulaCost,
    batchTotalCogs,
    sellingPrice,
    hasSellingPrice,
    netProfit,
    marginPct,
  }
}

export function formatEgp(amount, decimals = 2) {
  const num = Number.isFinite(amount) ? amount : 0
  return `${num.toFixed(decimals)} EGP`
}
