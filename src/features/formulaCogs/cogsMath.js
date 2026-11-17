export function toNonNegNum(value) {
  if (value === '' || value === null || value === undefined) return 0
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return parsed
}

export function computeCostPerUnit(packPrice, packQty) {
  const price = toNonNegNum(packPrice)
  const qty = toNonNegNum(packQty)
  if (qty <= 0) return 0
  return price / qty
}

export function calculateFormulaBreakdown(product, materialsById) {
  const pieceWeight = toNonNegNum(product?.pieceWeight)
  const unitsInBatch = Math.max(1, Math.round(toNonNegNum(product?.unitsInBatch) || 1))
  const packagingCost = toNonNegNum(product?.packagingCost)
  const stickersCost = toNonNegNum(product?.stickersCost)
  const sellingPrice = toNonNegNum(product?.sellingPrice)

  let activePctSum = 0
  let tracePctSum = 0
  let formulaCostPerPiece = 0

  const rows = (product?.rows || []).map((row) => {
    const material = materialsById.get(row.materialId) || null
    const pct = toNonNegNum(row.pct)
    const unitCost = material ? computeCostPerUnit(material.packPrice, material.packQty) : 0
    const qtyPerPiece = pieceWeight * (pct / 100)
    const rowCostPerPiece = qtyPerPiece * unitCost
    const batchQty = qtyPerPiece * unitsInBatch
    const batchRowCost = rowCostPerPiece * unitsInBatch

    if (row.isTrace) {
      tracePctSum += pct
    } else {
      activePctSum += pct
    }
    formulaCostPerPiece += rowCostPerPiece

    return {
      ...row,
      material,
      pctNum: pct,
      unitCost,
      qtyPerPiece,
      rowCostPerPiece,
      batchQty,
      batchRowCost,
    }
  })

  const totalPctSum = activePctSum + tracePctSum
  const isPctBalanced = Math.abs(activePctSum - 100) < 0.005
  const totalUnitCogs = formulaCostPerPiece + packagingCost + stickersCost
  const batchWeight = pieceWeight * unitsInBatch
  const batchFormulaCost = formulaCostPerPiece * unitsInBatch
  const batchTotalCogs = totalUnitCogs * unitsInBatch

  const hasSellingPrice = sellingPrice > 0
  const netProfit = hasSellingPrice ? sellingPrice - totalUnitCogs : 0
  const marginPct = hasSellingPrice ? (netProfit / sellingPrice) * 100 : 0

  return {
    rows,
    pieceWeight,
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
