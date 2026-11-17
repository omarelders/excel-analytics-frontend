import { useMemo, useState } from 'react'
import {
  CheckCircle2,
  AlertTriangle,
  Package,
  Tag,
  Plus,
  Trash2,
  RotateCcw,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  Search,
} from 'lucide-react'
import { useFormulaCogsState } from './useFormulaCogsState'
import { calculateFormulaBreakdown, computeCostPerUnit, formatEgp, toNonNegNum } from './cogsMath'
import './FormulaCogsCalculator.css'

const PRODUCT_ORDER = ['body_butter', 'body_splash']

const PHASE_OPTIONS = [
  'Water Phase',
  'Oil Phase',
  'Cool Down',
  'Phase A',
  'Phase B',
  'Active',
]

function FormulaCogsCalculator() {
  const {
    state,
    setActiveProductId,
    updateProductField,
    updateFormulaRow,
    addFormulaRow,
    removeFormulaRow,
    updateMaterial,
    addMaterial,
    removeMaterial,
    resetToDefaults,
  } = useFormulaCogsState()

  const [showInventory, setShowInventory] = useState(false)
  const [inventorySearch, setInventorySearch] = useState('')
  const [selectedAddMaterialId, setSelectedAddMaterialId] = useState('')
  const [selectedAddPhase, setSelectedAddPhase] = useState('Active')
  const [newMaterial, setNewMaterial] = useState({
    name: '',
    packQty: '100',
    unit: 'g',
    packPrice: '',
  })

  const materialsById = useMemo(
    () => new Map(state.materials.map((m) => [m.id, m])),
    [state.materials],
  )

  const usedMaterialIds = useMemo(() => {
    const used = new Set()
    for (const product of Object.values(state.products)) {
      for (const row of product.rows) {
        used.add(row.materialId)
      }
    }
    return used
  }, [state.products])

  const activeProduct = state.products[state.activeProductId] || state.products.body_butter
  const breakdown = useMemo(
    () => calculateFormulaBreakdown(activeProduct, materialsById),
    [activeProduct, materialsById],
  )

  const filteredMaterials = useMemo(() => {
    const query = inventorySearch.trim().toLowerCase()
    if (!query) return state.materials
    return state.materials.filter((m) => m.name.toLowerCase().includes(query))
  }, [state.materials, inventorySearch])

  const defaultAddMaterialId =
    selectedAddMaterialId && materialsById.has(selectedAddMaterialId)
      ? selectedAddMaterialId
      : state.materials[0]?.id || ''

  const handleTabKeyDown = (e, currentIndex) => {
    let nextIndex = null
    if (e.key === 'ArrowRight') nextIndex = (currentIndex + 1) % PRODUCT_ORDER.length
    if (e.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + PRODUCT_ORDER.length) % PRODUCT_ORDER.length
    if (nextIndex === null) return
    e.preventDefault()
    const nextId = PRODUCT_ORDER[nextIndex]
    setActiveProductId(nextId)
    document.getElementById(`fc-tab-${nextId}`)?.focus()
  }

  const handleNumChange = (setter) => (e) => {
    const raw = e.target.value
    if (raw === '') {
      setter('')
      return
    }
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed >= 0) {
      setter(parsed)
    }
  }

  const handleNumBlur = (currentVal, setter, fallback = 0) => () => {
    if (currentVal === '' || currentVal === null || currentVal === undefined) {
      setter(fallback)
    }
  }

  const handleAddRow = () => {
    if (!defaultAddMaterialId) return
    addFormulaRow(activeProduct.id, defaultAddMaterialId, selectedAddPhase)
  }

  const handleAddCustomMaterial = (e) => {
    e.preventDefault()
    const createdId = addMaterial({
      name: newMaterial.name,
      packQty: newMaterial.packQty,
      unit: newMaterial.unit,
      packPrice: newMaterial.packPrice,
    })
    if (createdId) {
      setSelectedAddMaterialId(createdId)
      setNewMaterial({ name: '', packQty: '100', unit: 'g', packPrice: '' })
    }
  }

  const handleReset = () => {
    if (window.confirm('Reset all material prices and both formulas back to their verified defaults?')) {
      resetToDefaults()
    }
  }

  const pctDiff = breakdown.activePctSum - 100
  const costPer100g =
    breakdown.pieceWeight > 0 ? (breakdown.formulaCostPerPiece / breakdown.pieceWeight) * 100 : 0

  return (
    <div className="fc-page">
      <header className="fc-header">
        <div>
          <h1 className="fc-title">Formula Pricing &amp; COGS</h1>
          <p className="fc-subtitle">
            Adjust ingredient percentages, piece weight, raw material prices, packaging, and stickers in EGP.
          </p>
        </div>

        <div className="fc-header-actions">
          <button
            type="button"
            className="btn btn-outline"
            aria-expanded={showInventory}
            aria-controls="fc-inventory-panel"
            onClick={() => setShowInventory((prev) => !prev)}
          >
            <SlidersHorizontal size={16} aria-hidden="true" />
            <span>Material Prices ({state.materials.length})</span>
            {showInventory ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
          </button>

          <button type="button" className="btn btn-outline fc-reset-btn" onClick={handleReset}>
            <RotateCcw size={16} aria-hidden="true" />
            <span>Reset Defaults</span>
          </button>
        </div>
      </header>

      {/* Product Switcher Tabs */}
      <div className="fc-toolbar">
        <div className="fc-tablist" role="tablist" aria-label="Product formula">
          {PRODUCT_ORDER.map((productId, idx) => {
            const prod = state.products[productId]
            const isSelected = activeProduct.id === productId
            return (
              <button
                key={productId}
                id={`fc-tab-${productId}`}
                type="button"
                role="tab"
                aria-selected={isSelected}
                tabIndex={isSelected ? 0 : -1}
                className="fc-tab"
                onClick={() => setActiveProductId(productId)}
                onKeyDown={(e) => handleTabKeyDown(e, idx)}
              >
                <span>{prod.name}</span>
                <span className="fc-tab-meta">{toNonNegNum(prod.pieceWeight)}g</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* KPI Summary Strip */}
      <section className="fc-kpi-grid" aria-label="Cost summary">
        <div className="fc-kpi-card fc-kpi-gold">
          <span className="fc-kpi-label">Total Unit COGS</span>
          <strong className="fc-kpi-value fc-gold-text">{formatEgp(breakdown.totalUnitCogs)}</strong>
          <span className="fc-kpi-sub">
            Formula {breakdown.formulaCostPerPiece.toFixed(2)} + Pkg {breakdown.packagingCost.toFixed(2)} + Stickers{' '}
            {breakdown.stickersCost.toFixed(2)}
          </span>
        </div>

        <div className="fc-kpi-card">
          <span className="fc-kpi-label">Formula Cost / Piece</span>
          <strong className="fc-kpi-value">{formatEgp(breakdown.formulaCostPerPiece)}</strong>
          <span className="fc-kpi-sub">
            {breakdown.pieceWeight}g piece ({costPer100g.toFixed(2)} EGP / 100g)
          </span>
        </div>

        <div className="fc-kpi-card">
          <span className="fc-kpi-label">
            Batch COGS ({breakdown.unitsInBatch} {breakdown.unitsInBatch === 1 ? 'pc' : 'pcs'})
          </span>
          <strong className="fc-kpi-value">{formatEgp(breakdown.batchTotalCogs)}</strong>
          <span className="fc-kpi-sub">
            Batch bulk: {breakdown.batchWeight.toFixed(0)}g ({formatEgp(breakdown.batchFormulaCost)} formula)
          </span>
        </div>

        <div className="fc-kpi-card">
          <span className="fc-kpi-label">Unit Profit &amp; Margin</span>
          <strong
            className={`fc-kpi-value ${
              breakdown.hasSellingPrice
                ? breakdown.netProfit >= 0
                  ? 'fc-positive-text'
                  : 'fc-negative-text'
                : ''
            }`}
          >
            {breakdown.hasSellingPrice ? formatEgp(breakdown.netProfit) : '—'}
          </strong>
          <span className="fc-kpi-sub">
            {breakdown.hasSellingPrice
              ? `${breakdown.marginPct.toFixed(1)}% gross margin at ${formatEgp(breakdown.sellingPrice, 0)}`
              : 'Set Selling Price below to view margin'}
          </span>
        </div>
      </section>

      {/* Weight, Batch, Packaging & Stickers Controls */}
      <section className="fc-controls-grid" aria-label="Piece settings and extra costs">
        <div className="fc-panel fc-config-card">
          <h2 className="fc-panel-title">Piece &amp; Batch Size</h2>
          <div className="fc-field-row">
            <div className="fc-field">
              <label htmlFor="fc-piece-weight">Final Piece Weight (g / ml)</label>
              <input
                id="fc-piece-weight"
                type="number"
                min="0"
                step="any"
                value={activeProduct.pieceWeight}
                onChange={handleNumChange((val) => updateProductField(activeProduct.id, 'pieceWeight', val))}
                onBlur={handleNumBlur(activeProduct.pieceWeight, (val) =>
                  updateProductField(activeProduct.id, 'pieceWeight', val),
                )}
              />
            </div>

            <div className="fc-field">
              <label htmlFor="fc-batch-units">Units / Batch</label>
              <input
                id="fc-batch-units"
                type="number"
                min="1"
                step="1"
                value={activeProduct.unitsInBatch}
                onChange={handleNumChange((val) => updateProductField(activeProduct.id, 'unitsInBatch', val))}
                onBlur={() => {
                  const clean = Math.max(1, Math.round(toNonNegNum(activeProduct.unitsInBatch) || 1))
                  updateProductField(activeProduct.id, 'unitsInBatch', clean)
                }}
              />
            </div>

            <div className="fc-field">
              <label htmlFor="fc-selling-price">Selling Price (EGP, optional)</label>
              <input
                id="fc-selling-price"
                type="number"
                min="0"
                step="any"
                value={activeProduct.sellingPrice}
                onChange={handleNumChange((val) => updateProductField(activeProduct.id, 'sellingPrice', val))}
                onBlur={handleNumBlur(activeProduct.sellingPrice, (val) =>
                  updateProductField(activeProduct.id, 'sellingPrice', val),
                )}
              />
            </div>
          </div>
        </div>

        <div className="fc-panel fc-cost-card">
          <h2 className="fc-panel-title">
            <Package size={17} aria-hidden="true" />
            <span>Packaging Price</span>
          </h2>
          <div className="fc-field-row fc-field-row-2">
            <div className="fc-field">
              <label htmlFor="fc-packaging-cost">Cost per Piece (EGP)</label>
              <input
                id="fc-packaging-cost"
                type="number"
                min="0"
                step="any"
                value={activeProduct.packagingCost}
                onChange={handleNumChange((val) => updateProductField(activeProduct.id, 'packagingCost', val))}
                onBlur={handleNumBlur(activeProduct.packagingCost, (val) =>
                  updateProductField(activeProduct.id, 'packagingCost', val),
                )}
              />
            </div>
            <div className="fc-field">
              <label htmlFor="fc-packaging-note">Item Note</label>
              <input
                id="fc-packaging-note"
                type="text"
                value={activeProduct.packagingNote || ''}
                onChange={(e) => updateProductField(activeProduct.id, 'packagingNote', e.target.value)}
                placeholder="e.g. Jar, Lid, Pump"
              />
            </div>
          </div>
        </div>

        <div className="fc-panel fc-cost-card">
          <h2 className="fc-panel-title">
            <Tag size={17} aria-hidden="true" />
            <span>Stickers Price</span>
          </h2>
          <div className="fc-field-row fc-field-row-2">
            <div className="fc-field">
              <label htmlFor="fc-stickers-cost">Cost per Piece (EGP)</label>
              <input
                id="fc-stickers-cost"
                type="number"
                min="0"
                step="any"
                value={activeProduct.stickersCost}
                onChange={handleNumChange((val) => updateProductField(activeProduct.id, 'stickersCost', val))}
                onBlur={handleNumBlur(activeProduct.stickersCost, (val) =>
                  updateProductField(activeProduct.id, 'stickersCost', val),
                )}
              />
            </div>
            <div className="fc-field">
              <label htmlFor="fc-stickers-note">Item Note</label>
              <input
                id="fc-stickers-note"
                type="text"
                value={activeProduct.stickersNote || ''}
                onChange={(e) => updateProductField(activeProduct.id, 'stickersNote', e.target.value)}
                placeholder="e.g. Front & Back"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Collapsible Material Inventory & Price Editor */}
      {showInventory && (
        <section id="fc-inventory-panel" className="fc-panel fc-inventory-panel" aria-label="Material inventory">
          <div className="fc-section-header">
            <div>
              <h2 className="fc-panel-title">Raw Material Prices (Shared Inventory)</h2>
              <p className="fc-muted-text">
                Editing Pack Price or Pack Qty updates unit costs across both Body Butter and Body Splash.
              </p>
            </div>
            <search className="fc-search-wrap">
              <label htmlFor="fc-inventory-search" className="visually-hidden">
                Filter materials
              </label>
              <Search size={15} aria-hidden="true" />
              <input
                id="fc-inventory-search"
                type="search"
                value={inventorySearch}
                onChange={(e) => setInventorySearch(e.target.value)}
                placeholder="Search materials..."
              />
            </search>
          </div>

          <form className="fc-add-material-form" onSubmit={handleAddCustomMaterial}>
            <div className="fc-field">
              <label htmlFor="fc-new-mat-name">New Material Name</label>
              <input
                id="fc-new-mat-name"
                type="text"
                required
                value={newMaterial.name}
                onChange={(e) => setNewMaterial((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. Rosehip Oil"
              />
            </div>
            <div className="fc-field">
              <label htmlFor="fc-new-mat-qty">Pack Qty</label>
              <input
                id="fc-new-mat-qty"
                type="number"
                min="0.01"
                step="any"
                required
                value={newMaterial.packQty}
                onChange={(e) => setNewMaterial((prev) => ({ ...prev, packQty: e.target.value }))}
              />
            </div>
            <div className="fc-field">
              <label htmlFor="fc-new-mat-unit">Unit</label>
              <select
                id="fc-new-mat-unit"
                value={newMaterial.unit}
                onChange={(e) => setNewMaterial((prev) => ({ ...prev, unit: e.target.value }))}
              >
                <option value="g">g</option>
                <option value="ml">ml</option>
              </select>
            </div>
            <div className="fc-field">
              <label htmlFor="fc-new-mat-price">Pack Price (EGP)</label>
              <input
                id="fc-new-mat-price"
                type="number"
                min="0"
                step="any"
                required
                value={newMaterial.packPrice}
                onChange={(e) => setNewMaterial((prev) => ({ ...prev, packPrice: e.target.value }))}
                placeholder="0.00"
              />
            </div>
            <button type="submit" className="btn btn-primary fc-add-mat-submit">
              <Plus size={16} aria-hidden="true" />
              <span>Add Material</span>
            </button>
          </form>

          <div
            tabIndex={0}
            role="region"
            aria-label="Raw materials price table"
            className="fc-table-wrapper fc-inventory-table-wrap"
          >
            <table className="fc-table fc-inventory-table">
              <caption className="visually-hidden">Editable raw material pack prices and unit costs</caption>
              <thead>
                <tr>
                  <th scope="col">Material</th>
                  <th scope="col">Pack Qty</th>
                  <th scope="col">Unit</th>
                  <th scope="col">Pack Price (EGP)</th>
                  <th scope="col">Cost / Unit</th>
                  <th scope="col">Remove</th>
                </tr>
              </thead>
              <tbody>
                {filteredMaterials.map((mat) => {
                  const isUsed = usedMaterialIds.has(mat.id)
                  const unitCost = computeCostPerUnit(mat.packPrice, mat.packQty)
                  return (
                    <tr key={mat.id}>
                      <td>
                        <input
                          type="text"
                          className="fc-cell-input fc-name-input"
                          aria-label={`Material name for ${mat.name}`}
                          value={mat.name}
                          onChange={(e) => updateMaterial(mat.id, { name: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          className="fc-cell-input fc-num-input"
                          aria-label={`Pack quantity for ${mat.name}`}
                          value={mat.packQty}
                          onChange={handleNumChange((val) => updateMaterial(mat.id, { packQty: val }))}
                          onBlur={handleNumBlur(
                            mat.packQty,
                            (val) => updateMaterial(mat.id, { packQty: val }),
                            100,
                          )}
                        />
                      </td>
                      <td>
                        <select
                          className="fc-cell-select"
                          aria-label={`Unit for ${mat.name}`}
                          value={mat.unit}
                          onChange={(e) => updateMaterial(mat.id, { unit: e.target.value })}
                        >
                          <option value="g">g</option>
                          <option value="ml">ml</option>
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          className="fc-cell-input fc-num-input"
                          aria-label={`Pack price in EGP for ${mat.name}`}
                          value={mat.packPrice}
                          onChange={handleNumChange((val) => updateMaterial(mat.id, { packPrice: val }))}
                          onBlur={handleNumBlur(mat.packPrice, (val) =>
                            updateMaterial(mat.id, { packPrice: val }),
                          )}
                        />
                      </td>
                      <td className="fc-mono">
                        {unitCost.toFixed(3)} / {mat.unit}
                      </td>
                      <td>
                        {isUsed ? (
                          <span className="fc-inuse-pill">In use</span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-danger btn-icon"
                            aria-label={`Delete ${mat.name} from inventory`}
                            onClick={() => removeMaterial(mat.id)}
                          >
                            <Trash2 size={15} aria-hidden="true" />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Active Formula Table */}
      <section className="fc-panel" aria-labelledby="fc-formula-title">
        <div className="fc-section-header">
          <div className="fc-formula-heading-wrap">
            <h2 id="fc-formula-title" className="fc-panel-title">
              {activeProduct.name} Formula
            </h2>
            <div className="fc-pct-badges" aria-live="polite">
              <span className={`badge ${breakdown.isPctBalanced ? 'badge-success' : 'badge-warning'}`}>
                {breakdown.isPctBalanced ? (
                  <CheckCircle2 size={14} aria-hidden="true" />
                ) : (
                  <AlertTriangle size={14} aria-hidden="true" />
                )}
                <span>
                  Active Sum: {breakdown.activePctSum.toFixed(2)}%
                  {!breakdown.isPctBalanced &&
                    ` (${pctDiff > 0 ? '+' : ''}${pctDiff.toFixed(2)}% from 100%)`}
                </span>
              </span>
              {breakdown.tracePctSum > 0 && (
                <span className="badge badge-default">
                  +{breakdown.tracePctSum.toFixed(2)}% trace (excluded from 100%)
                </span>
              )}
            </div>
          </div>

          <div className="fc-add-row-bar">
            <label htmlFor="fc-add-phase" className="visually-hidden">
              Phase for added material
            </label>
            <select
              id="fc-add-phase"
              className="fc-cell-select"
              value={selectedAddPhase}
              onChange={(e) => setSelectedAddPhase(e.target.value)}
            >
              {PHASE_OPTIONS.map((phase) => (
                <option key={phase} value={phase}>
                  {phase}
                </option>
              ))}
            </select>

            <label htmlFor="fc-add-material" className="visually-hidden">
              Choose material to add
            </label>
            <select
              id="fc-add-material"
              className="fc-cell-select fc-add-material-select"
              value={defaultAddMaterialId}
              onChange={(e) => setSelectedAddMaterialId(e.target.value)}
            >
              {state.materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({computeCostPerUnit(m.packPrice, m.packQty).toFixed(3)}/{m.unit})
                </option>
              ))}
            </select>

            <button type="button" className="btn btn-primary btn-sm" onClick={handleAddRow}>
              <Plus size={15} aria-hidden="true" />
              <span>Add to Formula</span>
            </button>
          </div>
        </div>

        <div tabIndex={0} role="region" aria-labelledby="fc-formula-title" className="fc-table-wrapper">
          <table className="fc-table fc-formula-table">
            <caption className="visually-hidden">
              {activeProduct.name} ingredient percentages, scaled weights, and unit costs
            </caption>
            <thead>
              <tr>
                <th scope="col">Phase</th>
                <th scope="col">Material</th>
                <th scope="col">% (w/w)</th>
                <th scope="col">Trace</th>
                <th scope="col">Qty / Piece</th>
                <th scope="col">Unit Cost</th>
                <th scope="col">Row Cost</th>
                <th scope="col">Remove</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.rows.map((row) => {
                const matName = row.material?.name || 'Missing material'
                const unitLabel = row.material?.unit || 'g'
                return (
                  <tr key={row.rowId} className={row.isTrace ? 'fc-row-trace' : ''}>
                    <td>
                      <select
                        className="fc-cell-select fc-phase-select"
                        aria-label={`Phase for ${matName}`}
                        value={row.phase || 'Active'}
                        onChange={(e) =>
                          updateFormulaRow(activeProduct.id, row.rowId, { phase: e.target.value })
                        }
                      >
                        {PHASE_OPTIONS.map((phase) => (
                          <option key={phase} value={phase}>
                            {phase}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <div className="fc-material-cell">
                        <select
                          className="fc-cell-select fc-material-select"
                          aria-label={`Select material for row ${matName}`}
                          value={row.materialId}
                          onChange={(e) =>
                            updateFormulaRow(activeProduct.id, row.rowId, { materialId: e.target.value })
                          }
                        >
                          {state.materials.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                        {row.note && <span className="fc-row-note">{row.note}</span>}
                      </div>
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        className="fc-cell-input fc-num-input"
                        aria-label={`Percentage for ${matName}`}
                        value={row.pct}
                        onChange={handleNumChange((val) =>
                          updateFormulaRow(activeProduct.id, row.rowId, { pct: val }),
                        )}
                        onBlur={handleNumBlur(row.pct, (val) =>
                          updateFormulaRow(activeProduct.id, row.rowId, { pct: val }),
                        )}
                      />
                    </td>
                    <td>
                      <label className="fc-trace-toggle">
                        <input
                          type="checkbox"
                          checked={Boolean(row.isTrace)}
                          aria-label={`Neglect ${matName} in 100% sum`}
                          onChange={(e) =>
                            updateFormulaRow(activeProduct.id, row.rowId, { isTrace: e.target.checked })
                          }
                        />
                        <span>Trace</span>
                      </label>
                    </td>
                    <td className="fc-mono">
                      <div>
                        {row.qtyPerPiece.toFixed(2)} {unitLabel}
                      </div>
                      {breakdown.unitsInBatch > 1 && (
                        <div className="fc-batch-sub">
                          Batch: {row.batchQty.toFixed(2)} {unitLabel}
                        </div>
                      )}
                    </td>
                    <td className="fc-mono">
                      {row.unitCost.toFixed(3)} / {unitLabel}
                    </td>
                    <td className="fc-mono fc-row-cost">{row.rowCostPerPiece.toFixed(2)} EGP</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-danger btn-icon"
                        aria-label={`Remove ${matName} from formula`}
                        onClick={() => removeFormulaRow(activeProduct.id, row.rowId)}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

export default FormulaCogsCalculator
