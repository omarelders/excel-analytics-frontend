import { useState, useEffect, useCallback } from 'react'
import { STORAGE_KEY, DEFAULT_MATERIALS, createInitialState } from './formulaDefaults'
import { computeCostPerUnit, toNonNegNum, toPositiveDensity } from './cogsMath'

function loadPersistedState() {
  const fallback = createInitialState()
  const defaultMatById = new Map(DEFAULT_MATERIALS.map((m) => [m.id, m]))
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    if (
      !parsed ||
      !Array.isArray(parsed.materials) ||
      !parsed.products?.body_butter ||
      !parsed.products?.body_splash
    ) {
      return fallback
    }
    const hydratedMaterials = parsed.materials.map((m) => {
      const def = defaultMatById.get(m.id)
      const density = toPositiveDensity(m.density ?? def?.density, 1.0)
      return {
        ...def,
        ...m,
        density,
        costPerUnit: computeCostPerUnit(m.packPrice, m.packQty),
      }
    })
    return {
      activeProductId: parsed.activeProductId === 'body_splash' ? 'body_splash' : 'body_butter',
      materials: hydratedMaterials,
      products: {
        body_butter: {
          ...fallback.products.body_butter,
          ...parsed.products.body_butter,
          sellUnit: parsed.products.body_butter.sellUnit || 'g',
          measuredFillWeight: parsed.products.body_butter.measuredFillWeight ?? null,
        },
        body_splash: {
          ...fallback.products.body_splash,
          ...parsed.products.body_splash,
          sellUnit: parsed.products.body_splash.sellUnit || 'ml',
          measuredFillWeight: parsed.products.body_splash.measuredFillWeight ?? null,
        },
      },
    }
  } catch {
    return fallback
  }
}

function makeSlugId(name, existingIds) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'material'
  let candidate = base
  let suffix = 2
  while (existingIds.has(candidate)) {
    candidate = `${base}_${suffix}`
    suffix += 1
  }
  return candidate
}

export function useFormulaCogsState() {
  const [state, setState] = useState(loadPersistedState)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // Ignore storage quota errors cleanly
    }
  }, [state])

  const setActiveProductId = useCallback((productId) => {
    setState((prev) => ({
      ...prev,
      activeProductId: productId === 'body_splash' ? 'body_splash' : 'body_butter',
    }))
  }, [])

  const updateProductField = useCallback((productId, field, value) => {
    setState((prev) => {
      const product = prev.products[productId]
      if (!product) return prev
      return {
        ...prev,
        products: {
          ...prev.products,
          [productId]: {
            ...product,
            [field]: value,
          },
        },
      }
    })
  }, [])

  const updateFormulaRow = useCallback((productId, rowId, patch) => {
    setState((prev) => {
      const product = prev.products[productId]
      if (!product) return prev
      return {
        ...prev,
        products: {
          ...prev.products,
          [productId]: {
            ...product,
            rows: product.rows.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)),
          },
        },
      }
    })
  }, [])

  const addFormulaRow = useCallback((productId, materialId, phase = 'Active') => {
    if (!materialId) return
    setState((prev) => {
      const product = prev.products[productId]
      if (!product) return prev
      const rowId = `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const newRow = {
        rowId,
        materialId,
        phase,
        pct: 0,
        note: '',
        isTrace: false,
      }
      return {
        ...prev,
        products: {
          ...prev.products,
          [productId]: {
            ...product,
            rows: [...product.rows, newRow],
          },
        },
      }
    })
  }, [])

  const removeFormulaRow = useCallback((productId, rowId) => {
    setState((prev) => {
      const product = prev.products[productId]
      if (!product) return prev
      return {
        ...prev,
        products: {
          ...prev.products,
          [productId]: {
            ...product,
            rows: product.rows.filter((row) => row.rowId !== rowId),
          },
        },
      }
    })
  }, [])

  const updateMaterial = useCallback((materialId, patch) => {
    setState((prev) => ({
      ...prev,
      materials: prev.materials.map((mat) => {
        if (mat.id !== materialId) return mat
        const next = { ...mat, ...patch }
        const packPrice = next.packPrice === '' ? 0 : toNonNegNum(next.packPrice)
        const packQty = next.packQty === '' ? 0 : toNonNegNum(next.packQty)
        return {
          ...next,
          costPerUnit: computeCostPerUnit(packPrice, packQty),
        }
      }),
    }))
  }, [])

  const addMaterial = useCallback(
    ({ name, packQty, unit, density, packPrice }) => {
      const trimmedName = String(name || '').trim()
      if (!trimmedName) return null
      const cleanQty = toNonNegNum(packQty) || 100
      const cleanPrice = toNonNegNum(packPrice)
      const cleanUnit = unit === 'ml' ? 'ml' : 'g'
      const cleanDensity = toPositiveDensity(density, 1.0)
      const existingIds = new Set(state.materials.map((m) => m.id))
      const createdId = makeSlugId(trimmedName, existingIds)
      const created = {
        id: createdId,
        name: trimmedName,
        packQty: cleanQty,
        unit: cleanUnit,
        density: cleanDensity,
        packPrice: cleanPrice,
        costPerUnit: computeCostPerUnit(cleanPrice, cleanQty),
      }
      setState((prev) => ({
        ...prev,
        materials: [...prev.materials, created],
      }))
      return createdId
    },
    [state.materials],
  )

  const removeMaterial = useCallback((materialId) => {
    setState((prev) => {
      const isUsed = Object.values(prev.products).some((p) =>
        p.rows.some((r) => r.materialId === materialId),
      )
      if (isUsed) return prev
      return {
        ...prev,
        materials: prev.materials.filter((m) => m.id !== materialId),
      }
    })
  }, [])

  const resetToDefaults = useCallback(() => {
    const fresh = createInitialState()
    setState((prev) => ({
      ...fresh,
      activeProductId: prev.activeProductId,
    }))
  }, [])

  return {
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
  }
}
