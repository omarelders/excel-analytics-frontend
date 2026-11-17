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
  Search,
  ArrowLeft,
  Pencil,
  X,
} from 'lucide-react'
import { useFormulaCogsState } from './useFormulaCogsState'
import {
  calculateFormulaBreakdown,
  computeMaterialUnitCosts,
  formatEgp,
  toNonNegNum,
  toPositiveDensity,
} from './cogsMath'
import './FormulaCogsCalculator.css'

const TAB_ORDER = ['body_butter', 'body_splash', 'materials']

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

  // activeView is either 'body_butter', 'body_splash', or 'materials'
  const [activeView, setActiveView] = useState(state.activeProductId || 'body_butter')
  const [showVolumes, setShowVolumes] = useState(false)
  const [inventorySearch, setInventorySearch] = useState('')
  const [inventoryFilter, setInventoryFilter] = useState('all') // 'all' | 'in_use' | 'ml' | 'zero'
  const [showAddMaterialForm, setShowAddMaterialForm] = useState(false)
  const [highlightedMaterialId, setHighlightedMaterialId] = useState(null)

  const [selectedAddMaterialId, setSelectedAddMaterialId] = useState('')
  const [selectedAddPhase, setSelectedAddPhase] = useState('Active')
  const [newMaterial, setNewMaterial] = useState({
    name: '',
    packQty: '100',
    unit: 'g',
    density: '1.00',
    packPrice: '',
  })

  const materialsById = useMemo(
    () => new Map(state.materials.map((m) => [m.id, m])),
    [state.materials],
  )

  // Map each materialId -> array of product names using it
  const materialUsageMap = useMemo(() => {
    const map = new Map()
    for (const product of Object.values(state.products)) {
      for (const row of product.rows) {
        const list = map.get(row.materialId) || []
        if (!list.includes(product.name)) {
          list.push(product.name)
        }
        map.set(row.materialId, list)
      }
    }
    return map
  }, [state.products])

  const activeProduct = state.products[state.activeProductId] || state.products.body_butter
  const breakdown = useMemo(
    () => calculateFormulaBreakdown(activeProduct, materialsById),
    [activeProduct, materialsById],
  )

  const filteredMaterials = useMemo(() => {
    const query = inventorySearch.trim().toLowerCase()
    return state.materials.filter((m) => {
      if (query && !m.name.toLowerCase().includes(query)) return false
      if (inventoryFilter === 'in_use') return materialUsageMap.has(m.id)
      if (inventoryFilter === 'ml') return m.unit === 'ml'
      if (inventoryFilter === 'zero') return toNonNegNum(m.packPrice) === 0
      return true
    })
  }, [state.materials, inventorySearch, inventoryFilter, materialUsageMap])

  const defaultAddMaterialId =
    selectedAddMaterialId && materialsById.has(selectedAddMaterialId)
      ? selectedAddMaterialId
      : state.materials[0]?.id || ''

  const selectTab = (viewId) => {
    setActiveView(viewId)
    if (viewId === 'body_butter' || viewId === 'body_splash') {
      setActiveProductId(viewId)
      setHighlightedMaterialId(null)
    }
  }

  const jumpToMaterialPrice = (materialId) => {
    setInventoryFilter('all')
    setInventorySearch('')
    setHighlightedMaterialId(materialId)
    setActiveView('materials')
    setTimeout(() => {
      const input = document.getElementById(`fc-price-input-${materialId}`)
      if (input) {
        input.scrollIntoView({ behavior: 'smooth', block: 'center' })
        input.focus()
        input.select?.()
      }
    }, 40)
  }

  const handleTabKeyDown = (e, currentIndex) => {
    let nextIndex = null
    if (e.key === 'ArrowRight') nextIndex = (currentIndex + 1) % TAB_ORDER.length
    if (e.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length
    if (nextIndex === null) return
    e.preventDefault()
    const nextId = TAB_ORDER[nextIndex]
    selectTab(nextId)
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
      density: newMaterial.unit === 'ml' ? newMaterial.density : 1.0,
      packPrice: newMaterial.packPrice,
    })
    if (createdId) {
      setSelectedAddMaterialId(createdId)
      setNewMaterial({ name: '', packQty: '100', unit: 'g', density: '1.00', packPrice: '' })
      setShowAddMaterialForm(false)
      setHighlightedMaterialId(createdId)
    }
  }

  const handleReset = () => {
    if (window.confirm('Reset all material prices, densities, and both formulas back to defaults?')) {
      resetToDefaults()
    }
  }

  const isMaterialsView = activeView === 'materials'
  const isMlProduct = breakdown.sellUnit === 'ml'
  const showVolumeColumn = isMlProduct && showVolumes
  const pctDiff = breakdown.activePctSum - 100
  const costPer100g =
    breakdown.baseMassGrams > 0 ? (breakdown.formulaCostPerPiece / breakdown.baseMassGrams) * 100 : 0

  return (
    <div className="fc-page">
      <header className="fc-header">
        <div>
          <h1 className="fc-title">Formula Pricing &amp; COGS</h1>
          <p className="fc-subtitle">
            {isMaterialsView
              ? 'Edit raw material pack prices, quantities, and densities — changes update both formulas automatically.'
              : 'Density-calibrated % w/w formulation calculator — Body Butter sold in g, Body Splash sold in ml.'}
          </p>
        </div>

        <div className="fc-header-actions">
          <button type="button" className="btn btn-outline fc-reset-btn" onClick={handleReset}>
            <RotateCcw size={16} aria-hidden="true" />
            <span>Reset Defaults</span>
          </button>
        </div>
      </header>

      {/* Main View Switcher Tabs: Body Butter | Body Splash | Raw Material Prices */}
      <div className="fc-toolbar">
        <div className="fc-tablist" role="tablist" aria-label="Calculator view">
          {(['body_butter', 'body_splash']).map((productId, idx) => {
            const prod = state.products[productId]
            const isSelected = activeView === productId
            const unitSuffix = prod.sellUnit === 'ml' ? 'ml' : 'g'
            return (
              <button
                key={productId}
                id={`fc-tab-${productId}`}
                type="button"
                role="tab"
                aria-selected={isSelected}
                tabIndex={isSelected ? 0 : -1}
                className="fc-tab"
                onClick={() => selectTab(productId)}
                onKeyDown={(e) => handleTabKeyDown(e, idx)}
              >
                <span>{prod.name}</span>
                <span className="fc-tab-meta">
                  {toNonNegNum(prod.pieceWeight)}
                  {unitSuffix}
                </span>
              </button>
            )
          })}

          <button
            id="fc-tab-materials"
            type="button"
            role="tab"
            aria-selected={isMaterialsView}
            tabIndex={isMaterialsView ? 0 : -1}
            className="fc-tab fc-tab-materials"
            onClick={() => selectTab('materials')}
            onKeyDown={(e) => handleTabKeyDown(e, 2)}
          >
            <SlidersHorizontal size={15} aria-hidden="true" />
            <span>Material Prices</span>
            <span className="fc-tab-meta">{state.materials.length}</span>
          </button>
        </div>
      </div>

      {isMaterialsView ? (
        /* ==================== DEDICATED MATERIAL PRICES WORKSPACE ==================== */
        <section id="fc-inventory-panel" className="fc-panel fc-inventory-panel" aria-label="Material inventory">
          <div className="fc-inventory-topbar">
            <button
              type="button"
              className="btn btn-outline btn-sm fc-back-btn"
              onClick={() => selectTab(activeProduct.id)}
            >
              <ArrowLeft size={15} aria-hidden="true" />
              <span>Back to {activeProduct.name}</span>
            </button>

            <div className="fc-inventory-controls">
              <div className="fc-filter-pills" role="group" aria-label="Filter materials by type">
                {[
                  { id: 'all', label: `All (${state.materials.length})` },
                  { id: 'in_use', label: 'Used in Formulas' },
                  { id: 'ml', label: 'Priced in ml' },
                  { id: 'zero', label: '0 EGP Items' },
                ].map((pill) => (
                  <button
                    key={pill.id}
                    type="button"
                    className={`fc-filter-pill ${inventoryFilter === pill.id ? 'active' : ''}`}
                    aria-pressed={inventoryFilter === pill.id}
                    onClick={() => setInventoryFilter(pill.id)}
                  >
                    {pill.label}
                  </button>
                ))}
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
                  placeholder="Search material name..."
                />
                {inventorySearch && (
                  <button
                    type="button"
                    className="fc-clear-search"
                    aria-label="Clear search"
                    onClick={() => setInventorySearch('')}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                )}
              </search>

              <button
                type="button"
                className="btn btn-primary btn-sm"
                aria-expanded={showAddMaterialForm}
                onClick={() => setShowAddMaterialForm((prev) => !prev)}
              >
                {showAddMaterialForm ? <X size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
                <span>{showAddMaterialForm ? 'Cancel' : 'New Material'}</span>
              </button>
            </div>
          </div>

          {showAddMaterialForm && (
            <form
              className={`fc-add-material-form ${newMaterial.unit === 'ml' ? 'fc-with-density' : ''}`}
              onSubmit={handleAddCustomMaterial}
            >
              <div className="fc-field">
                <label htmlFor="fc-new-mat-name">Material Name</label>
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
                <label htmlFor="fc-new-mat-qty">Pack Size</label>
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
                <label htmlFor="fc-new-mat-unit">Buy Unit</label>
                <select
                  id="fc-new-mat-unit"
                  value={newMaterial.unit}
                  onChange={(e) => setNewMaterial((prev) => ({ ...prev, unit: e.target.value }))}
                >
                  <option value="g">g (Weight)</option>
                  <option value="ml">ml (Volume)</option>
                </select>
              </div>
              {newMaterial.unit === 'ml' && (
                <div className="fc-field">
                  <label htmlFor="fc-new-mat-density">Density (g/ml)</label>
                  <input
                    id="fc-new-mat-density"
                    type="number"
                    min="0.01"
                    step="any"
                    required
                    value={newMaterial.density}
                    onChange={(e) => setNewMaterial((prev) => ({ ...prev, density: e.target.value }))}
                  />
                </div>
              )}
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
                <span>Save Material</span>
              </button>
            </form>
          )}

          <div
            tabIndex={0}
            role="region"
            aria-label="Raw materials price table"
            className="fc-table-wrapper"
          >
            <table className="fc-table fc-inventory-table">
              <caption className="visually-hidden">Editable raw material pack prices, densities, and unit costs</caption>
              <thead>
                <tr>
                  <th scope="col">Material &amp; Usage</th>
                  <th scope="col">Pack Size &amp; Unit</th>
                  <th scope="col">Pack Price (EGP)</th>
                  <th scope="col">Density (g/ml)</th>
                  <th scope="col">Effective Cost / g</th>
                  <th scope="col">Remove</th>
                </tr>
              </thead>
              <tbody>
                {filteredMaterials.map((mat) => {
                  const usedIn = materialUsageMap.get(mat.id) || []
                  const isUsed = usedIn.length > 0
                  const { costPerPackUnit, costPerGram } = computeMaterialUnitCosts(mat)
                  const isHighlighted = highlightedMaterialId === mat.id
                  return (
                    <tr
                      key={mat.id}
                      className={isHighlighted ? 'fc-row-highlighted' : ''}
                      onClick={() => setHighlightedMaterialId(mat.id)}
                    >
                      <td>
                        <div className="fc-inv-name-cell">
                          <input
                            type="text"
                            className="fc-cell-input fc-name-input"
                            aria-label={`Material name for ${mat.name}`}
                            value={mat.name}
                            onChange={(e) => updateMaterial(mat.id, { name: e.target.value })}
                          />
                          {isUsed && (
                            <div className="fc-usage-tags">
                              {usedIn.map((prodName) => (
                                <span key={prodName} className="fc-usage-tag">
                                  {prodName}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="fc-inline-pack-group">
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
                          <select
                            className="fc-cell-select fc-unit-mini-select"
                            aria-label={`Purchase unit for ${mat.name}`}
                            value={mat.unit}
                            onChange={(e) => updateMaterial(mat.id, { unit: e.target.value })}
                          >
                            <option value="g">g</option>
                            <option value="ml">ml</option>
                          </select>
                        </div>
                      </td>
                      <td>
                        <div className="fc-price-edit-wrap">
                          <input
                            id={`fc-price-input-${mat.id}`}
                            type="number"
                            min="0"
                            step="any"
                            className="fc-cell-input fc-num-input fc-price-highlight-input"
                            aria-label={`Pack price in EGP for ${mat.name}`}
                            value={mat.packPrice}
                            onChange={handleNumChange((val) => updateMaterial(mat.id, { packPrice: val }))}
                            onBlur={handleNumBlur(mat.packPrice, (val) =>
                              updateMaterial(mat.id, { packPrice: val }),
                            )}
                          />
                          <span className="fc-Input-suffix">EGP</span>
                        </div>
                      </td>
                      <td>
                        {mat.unit === 'ml' ? (
                          <div className="fc-price-edit-wrap">
                            <input
                              type="number"
                              min="0.01"
                              step="any"
                              className="fc-cell-input fc-num-input"
                              aria-label={`Density in g/ml for ${mat.name}`}
                              value={mat.density ?? 1.0}
                              onChange={handleNumChange((val) => updateMaterial(mat.id, { density: val }))}
                              onBlur={() => {
                                const clean = toPositiveDensity(mat.density, 1.0)
                                updateMaterial(mat.id, { density: clean })
                              }}
                            />
                            <span className="fc-Input-suffix">g/ml</span>
                          </div>
                        ) : (
                          <span className="fc-muted-dash" aria-label="Not applicable for gram-bought material">
                            —
                          </span>
                        )}
                      </td>
                      <td className="fc-mono">
                        <strong className="fc-gold-text">{costPerGram.toFixed(3)} EGP/g</strong>
                        {mat.unit === 'ml' && (
                          <div className="fc-batch-sub">({costPerPackUnit.toFixed(3)} EGP/ml)</div>
                        )}
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
      ) : (
        /* ==================== PRODUCT FORMULA & COGS WORKSPACE ==================== */
        <>
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
                {isMlProduct
                  ? `${breakdown.pieceSize}ml bottle = ${breakdown.baseMassGrams.toFixed(1)}g scale (${
                      breakdown.isMeasuredFillActive ? 'measured ' : ''
                    }${breakdown.effectiveDensity.toFixed(3)} g/ml)`
                  : `${breakdown.pieceSize}g piece (${costPer100g.toFixed(2)} EGP / 100g)`}
              </span>
            </div>

            <div className="fc-kpi-card">
              <span className="fc-kpi-label">
                Batch COGS ({breakdown.unitsInBatch} {breakdown.unitsInBatch === 1 ? 'pc' : 'pcs'})
              </span>
              <strong className="fc-kpi-value">{formatEgp(breakdown.batchTotalCogs)}</strong>
              <span className="fc-kpi-sub">
                {isMlProduct
                  ? `Scale: ${breakdown.batchTotalMassGrams.toFixed(1)}g · Target: ${
                      breakdown.pieceSize * breakdown.unitsInBatch
                    }ml`
                  : `Batch scale: ${breakdown.batchTotalMassGrams.toFixed(1)} g`}
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
              <h2 className="fc-panel-title">Piece Size &amp; Batch</h2>
              <div className={`fc-field-row ${isMlProduct ? 'fc-field-row-ml' : ''}`}>
                <div className="fc-field">
                  <label htmlFor="fc-piece-weight">
                    {isMlProduct ? 'Bottle Fill Volume (ml)' : 'Final Piece Weight (g)'}
                  </label>
                  <div className="fc-inline-input-group">
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
                    <select
                      aria-label="Piece measurement unit"
                      className="fc-unit-select"
                      value={breakdown.sellUnit}
                      onChange={(e) => updateProductField(activeProduct.id, 'sellUnit', e.target.value)}
                    >
                      <option value="g">g</option>
                      <option value="ml">ml</option>
                    </select>
                  </div>
                  {isMlProduct && (
                    <span className="fc-field-hint">
                      {breakdown.isMeasuredFillActive
                        ? `Measured override (${breakdown.effectiveDensity.toFixed(3)} g/ml)`
                        : `Auto scale: ${breakdown.theoreticalMassGrams.toFixed(2)} g (${breakdown.mixDensity.toFixed(3)} g/ml)`}
                    </span>
                  )}
                </div>

                {isMlProduct && (
                  <div className="fc-field">
                    <label htmlFor="fc-measured-fill-weight">Measured fill weight (g per bottle)</label>
                    <div className="fc-inline-input-group">
                      <input
                        id="fc-measured-fill-weight"
                        type="number"
                        min="0"
                        step="any"
                        placeholder={`${breakdown.theoreticalMassGrams.toFixed(1)} (auto)`}
                        value={activeProduct.measuredFillWeight ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value
                          if (raw === '') {
                            updateProductField(activeProduct.id, 'measuredFillWeight', null)
                            return
                          }
                          const parsed = Number(raw)
                          if (Number.isFinite(parsed) && parsed >= 0) {
                            updateProductField(activeProduct.id, 'measuredFillWeight', parsed)
                          }
                        }}
                        onBlur={() => {
                          const val = activeProduct.measuredFillWeight
                          if (val === '' || val === 0) {
                            updateProductField(activeProduct.id, 'measuredFillWeight', null)
                          }
                        }}
                      />
                      {activeProduct.measuredFillWeight !== null && activeProduct.measuredFillWeight !== '' && (
                        <button
                          type="button"
                          className="btn btn-outline btn-icon fc-clear-measured-btn"
                          aria-label="Clear measured fill weight and use auto mix density"
                          onClick={() => updateProductField(activeProduct.id, 'measuredFillWeight', null)}
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    <span className="fc-field-hint">
                      {breakdown.isMeasuredFillActive
                        ? `Overrides auto ${breakdown.theoreticalMassGrams.toFixed(2)} g`
                        : `Optional: weigh 1 filled ${breakdown.pieceSize}ml bottle once`}
                    </span>
                  </div>
                )}

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
                {isMlProduct && (
                  <label className="fc-show-volumes-toggle">
                    <input
                      type="checkbox"
                      checked={showVolumes}
                      onChange={(e) => setShowVolumes(e.target.checked)}
                    />
                    <span>Show volumes</span>
                  </label>
                )}

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
                  {state.materials.map((m) => {
                    const { costPerGram } = computeMaterialUnitCosts(m)
                    return (
                      <option key={m.id} value={m.id}>
                        {m.name} ({costPerGram.toFixed(3)} EGP/g)
                      </option>
                    )
                  })}
                </select>

                <button type="button" className="btn btn-primary btn-sm" onClick={handleAddRow}>
                  <Plus size={15} aria-hidden="true" />
                  <span>Add to Formula</span>
                </button>
              </div>
            </div>

            <div tabIndex={0} role="region" aria-labelledby="fc-formula-title" className="fc-table-wrapper">
              <table className={`fc-table fc-formula-table ${showVolumeColumn ? 'fc-with-volumes' : ''}`}>
                <caption className="visually-hidden">
                  {activeProduct.name} ingredient percentages, scale weights in grams
                  {showVolumeColumn ? ', volumes in ml,' : ''} and costs
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Phase</th>
                    <th scope="col">Material</th>
                    <th scope="col">% (w/w)</th>
                    <th scope="col">Trace</th>
                    <th scope="col">Scale Wt (g)</th>
                    {showVolumeColumn && <th scope="col">Volume (ml)</th>}
                    <th scope="col">Cost / g</th>
                    <th scope="col">Row Cost</th>
                    <th scope="col">Remove</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.rows.map((row) => {
                    const matName = row.material?.name || 'Missing material'
                    const boughtInMl = row.material?.unit === 'ml'
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
                          <div>{row.weightGramsPerPiece.toFixed(2)} g</div>
                          {breakdown.unitsInBatch > 1 && (
                            <div className="fc-batch-sub">Batch: {row.batchWeightGrams.toFixed(2)} g</div>
                          )}
                        </td>
                        {showVolumeColumn && (
                          <td className="fc-mono">
                            <div>{row.volumeMlPerPiece.toFixed(2)} ml</div>
                            {breakdown.unitsInBatch > 1 && (
                              <div className="fc-batch-sub">Batch: {row.batchVolumeMl.toFixed(2)} ml</div>
                            )}
                          </td>
                        )}
                        <td className="fc-mono">
                          <button
                            type="button"
                            className="fc-cost-jump-btn"
                            aria-label={`Edit price for ${matName}`}
                            onClick={() => jumpToMaterialPrice(row.materialId)}
                          >
                            <span>{row.costPerGram.toFixed(3)} / g</span>
                            <Pencil size={12} aria-hidden="true" />
                          </button>
                          {boughtInMl && (
                            <div className="fc-batch-sub">
                              {row.costPerMl.toFixed(3)}/ml @ {row.density}g/ml
                            </div>
                          )}
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
                <tfoot>
                  <tr className="fc-tfoot-row">
                    <td colSpan={2}>
                      <strong>Piece Totals</strong>
                    </td>
                    <td className="fc-mono">
                      <strong>{breakdown.activePctSum.toFixed(2)}%</strong>
                      {breakdown.tracePctSum > 0 && (
                        <div className="fc-batch-sub">+{breakdown.tracePctSum.toFixed(2)}% trace</div>
                      )}
                    </td>
                    <td />
                    <td className="fc-mono">
                      <strong>{breakdown.totalMassGramsPerPiece.toFixed(2)} g</strong>
                    </td>
                    {showVolumeColumn && (
                      <td className="fc-mono">
                        <strong>{breakdown.totalVolumeMlPerPiece.toFixed(2)} ml</strong>
                      </td>
                    )}
                    <td className="fc-mono">
                      {isMlProduct && (
                        <span className="fc-batch-sub">
                          {breakdown.isMeasuredFillActive ? 'Measured ' : ''}ρ ={' '}
                          {breakdown.effectiveDensity.toFixed(3)} g/ml
                        </span>
                      )}
                    </td>
                    <td className="fc-mono fc-gold-text">
                      <strong>{breakdown.formulaCostPerPiece.toFixed(2)} EGP</strong>
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

export default FormulaCogsCalculator
