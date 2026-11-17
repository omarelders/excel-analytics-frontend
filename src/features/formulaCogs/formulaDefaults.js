export const STORAGE_KEY = 'goldroad_formula_cogs_v2'

// Density (specific gravity in g/ml at 20-25°C) bridges % w/w formulation
// with materials purchased by volume (ml) and products sold by volume (ml).
export const DEFAULT_MATERIALS = [
  { id: 'peg40', name: 'PEG-40 Hydrogenated Castor Oil (كريموفور ٤٠)', packQty: 250, unit: 'g', density: 1.05, packPrice: 125.0, costPerUnit: 0.5 },
  { id: 'ewax', name: 'Emulsifying Wax (شمع استحلاب)', packQty: 250, unit: 'g', density: 0.97, packPrice: 45.0, costPerUnit: 0.18 },
  { id: 'glycerin', name: 'Vegetable Glycerin (جلسرين)', packQty: 500, unit: 'g', density: 1.26, packPrice: 70.0, costPerUnit: 0.14 },
  { id: 'dpg', name: 'Dipropylene Glycol - DPG (داي بروبلين جليكول)', packQty: 250, unit: 'g', density: 1.02, packPrice: 100.0, costPerUnit: 0.4 },
  { id: 'mpg', name: 'Mono Propylene Glycol - MPG (مونو بروبلين جليكول)', packQty: 250, unit: 'g', density: 1.036, packPrice: 75.0, costPerUnit: 0.3 },
  { id: 'benzophenone4', name: 'Benzophenone-4 (بينزوفينون ٤)', packQty: 20, unit: 'g', density: 1.0, packPrice: 80.0, costPerUnit: 4.0 },
  { id: 'dimethicone', name: 'Dimethicone (دايميثيكون)', packQty: 250, unit: 'g', density: 0.965, packPrice: 175.0, costPerUnit: 0.7 },
  { id: 'vit_e', name: 'Vitamin E (فيتامين E)', packQty: 20, unit: 'g', density: 0.95, packPrice: 100.0, costPerUnit: 5.0 },
  { id: 'cetyl_alc', name: 'Cetyl Alcohol', packQty: 800, unit: 'g', density: 0.81, packPrice: 192.0, costPerUnit: 0.24 },
  { id: 'preservative_tgp', name: 'Total Guard Phoenix (Phenoxyethanol & EHG)', packQty: 250, unit: 'g', density: 1.06, packPrice: 265.0, costPerUnit: 1.06 },
  { id: 'cct', name: 'Caprylic/Capric Triglyceride (CCT)', packQty: 250, unit: 'g', density: 0.945, packPrice: 150.0, costPerUnit: 0.6 },
  { id: 'frag_vanilla28', name: 'Kayali Vanilla 28 Fragrance Oil', packQty: 100, unit: 'g', density: 0.98, packPrice: 445.0, costPerUnit: 4.45 },
  { id: 'almond_oil', name: 'Sweet Almond Oil', packQty: 500, unit: 'ml', density: 0.915, packPrice: 330.0, costPerUnit: 0.66 },
  { id: 'jojoba_oil', name: 'Jojoba Oil', packQty: 500, unit: 'ml', density: 0.865, packPrice: 412.0, costPerUnit: 0.824 },
  { id: 'shea_zein', name: 'Refined Shea Butter (Zein)', packQty: 250, unit: 'g', density: 0.91, packPrice: 192.5, costPerUnit: 0.77 },
  { id: 'cocoa_zein', name: 'Refined Cocoa Butter (Zein)', packQty: 250, unit: 'g', density: 0.96, packPrice: 375.0, costPerUnit: 1.5 },
  { id: 'shea_basf', name: 'Shea Butter (BASF Pharma Log)', packQty: 250, unit: 'g', density: 0.91, packPrice: 175.0, costPerUnit: 0.7 },
  { id: 'water', name: 'Distilled Water (Aqua)', packQty: 5000, unit: 'ml', density: 1.0, packPrice: 65.0, costPerUnit: 0.013 },
  { id: 'alc_euro_1l', name: 'Alcohol Denat. - Europharm (1L)', packQty: 1000, unit: 'ml', density: 0.79, packPrice: 130.0, costPerUnit: 0.13 },
  { id: 'alc_euro_5l', name: 'Alcohol Denat. - Europharm (5L)', packQty: 5000, unit: 'ml', density: 0.79, packPrice: 550.0, costPerUnit: 0.11 },
  { id: 'alc_mawardy_1l', name: 'Alcohol Denat. - El-Mawardy (1L)', packQty: 1000, unit: 'ml', density: 0.79, packPrice: 150.0, costPerUnit: 0.15 },
  { id: 'alc_mawardy_5l', name: 'Alcohol Denat. - El-Mawardy (5L)', packQty: 5000, unit: 'ml', density: 0.79, packPrice: 500.0, costPerUnit: 0.1 },
  { id: 'bht', name: 'BHT Antioxidant', packQty: 100, unit: 'g', density: 1.05, packPrice: 0.0, costPerUnit: 0.0 },
  { id: 'aroma_correct', name: 'Aroma Correct', packQty: 100, unit: 'g', density: 1.0, packPrice: 0.0, costPerUnit: 0.0 },
  { id: 'edta', name: 'Disodium EDTA', packQty: 100, unit: 'g', density: 1.0, packPrice: 0.0, costPerUnit: 0.0 },
  { id: 'aloe_juice', name: 'Aloe Barbadensis Leaf Juice', packQty: 1000, unit: 'g', density: 1.0, packPrice: 0.0, costPerUnit: 0.0 },
  { id: 'glycerin_ipm', name: 'Glycerin + 0.5% IPM Blend', packQty: 500, unit: 'g', density: 1.25, packPrice: 70.0, costPerUnit: 0.14 },
]

export const DEFAULT_PRODUCTS = {
  body_butter: {
    id: 'body_butter',
    name: 'Body Butter',
    sellUnit: 'g',
    pieceWeight: 250,
    measuredFillWeight: null,
    unitsInBatch: 1,
    packagingCost: 0,
    packagingNote: 'Jar & Lid',
    stickersCost: 0,
    stickersNote: 'Front & Back Labels',
    sellingPrice: 0,
    rows: [
      { rowId: 'bb-1', materialId: 'water', phase: 'Water Phase', pct: 58.5, note: 'Solvent', isTrace: false },
      { rowId: 'bb-2', materialId: 'glycerin', phase: 'Water Phase', pct: 4.0, note: 'Humectant', isTrace: false },
      { rowId: 'bb-3', materialId: 'vit_e', phase: 'Water Phase', pct: 0.5, note: 'Antioxidant', isTrace: false },
      { rowId: 'bb-4', materialId: 'edta', phase: 'Water Phase', pct: 0.0, note: 'Chelating Agent', isTrace: true },
      { rowId: 'bb-5', materialId: 'shea_zein', phase: 'Oil Phase', pct: 5.0, note: 'Butter Blend', isTrace: false },
      { rowId: 'bb-6', materialId: 'cocoa_zein', phase: 'Oil Phase', pct: 5.0, note: 'Butter Blend', isTrace: false },
      { rowId: 'bb-7', materialId: 'jojoba_oil', phase: 'Oil Phase', pct: 4.0, note: 'Emollient Oil', isTrace: false },
      { rowId: 'bb-8', materialId: 'almond_oil', phase: 'Oil Phase', pct: 4.0, note: 'Emollient Oil', isTrace: false },
      { rowId: 'bb-9', materialId: 'cct', phase: 'Oil Phase', pct: 3.0, note: 'Light Esters', isTrace: false },
      { rowId: 'bb-10', materialId: 'ewax', phase: 'Oil Phase', pct: 8.0, note: 'Primary O/W Emulsifier', isTrace: false },
      { rowId: 'bb-11', materialId: 'cetyl_alc', phase: 'Oil Phase', pct: 3.0, note: 'Co-emulsifier & Thickener', isTrace: false },
      { rowId: 'bb-12', materialId: 'dimethicone', phase: 'Oil Phase', pct: 2.0, note: 'Silky Slip / Anti-soaping', isTrace: false },
      { rowId: 'bb-13', materialId: 'frag_vanilla28', phase: 'Oil Phase', pct: 3.0, note: 'Active Scent Profile', isTrace: false },
      { rowId: 'bb-14', materialId: 'bht', phase: 'Oil Phase', pct: 0.05, note: 'Oil Antioxidant', isTrace: true },
      { rowId: 'bb-15', materialId: 'aroma_correct', phase: 'Oil Phase', pct: 0.1, note: 'Base Odor Masking', isTrace: true },
      { rowId: 'bb-16', materialId: 'preservative_tgp', phase: 'Cool Down', pct: 1.0, note: 'Broad-Spectrum Preservative (<40°C)', isTrace: true },
    ],
  },
  body_splash: {
    id: 'body_splash',
    name: 'Body Splash',
    sellUnit: 'ml',
    pieceWeight: 200,
    measuredFillWeight: null,
    unitsInBatch: 1,
    packagingCost: 0,
    packagingNote: 'Bottle & Mist Atomizer',
    stickersCost: 0,
    stickersNote: 'Body Label',
    sellingPrice: 0,
    rows: [
      { rowId: 'bs-1', materialId: 'alc_mawardy_5l', phase: 'Phase A', pct: 45.0, note: 'Primary Solvent / Bloom Carrier', isTrace: false },
      { rowId: 'bs-2', materialId: 'frag_vanilla28', phase: 'Phase A', pct: 10.0, note: 'Active Scent Profile', isTrace: false },
      { rowId: 'bs-3', materialId: 'dpg', phase: 'Phase A', pct: 2.0, note: 'Scent Fixative & Carrier Modulator', isTrace: false },
      { rowId: 'bs-4', materialId: 'bht', phase: 'Phase A', pct: 0.1, note: 'Antioxidant / Inhibits Acetaldehyde', isTrace: true },
      { rowId: 'bs-5', materialId: 'peg40', phase: 'Phase B', pct: 4.0, note: 'Non-Ionic Solubilizer', isTrace: false },
      { rowId: 'bs-6', materialId: 'glycerin_ipm', phase: 'Phase B', pct: 0.0, note: 'Skin Humectant & Evaporation Smoother', isTrace: false },
      { rowId: 'bs-7', materialId: 'aloe_juice', phase: 'Phase B', pct: 1.0, note: 'Botanical Skin Conditioner', isTrace: false },
      { rowId: 'bs-8', materialId: 'water', phase: 'Phase B', pct: 38.0, note: 'Diluent & Solvent Balance', isTrace: false },
    ],
  },
}

export function createInitialState() {
  return {
    activeProductId: 'body_butter',
    materials: DEFAULT_MATERIALS.map((m) => ({ ...m })),
    products: {
      body_butter: {
        ...DEFAULT_PRODUCTS.body_butter,
        rows: DEFAULT_PRODUCTS.body_butter.rows.map((r) => ({ ...r })),
      },
      body_splash: {
        ...DEFAULT_PRODUCTS.body_splash,
        rows: DEFAULT_PRODUCTS.body_splash.rows.map((r) => ({ ...r })),
      },
    },
  }
}
