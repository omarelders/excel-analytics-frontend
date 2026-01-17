/**
 * Centralized constants for shipment statuses.
 * This provides a local fallback, but should be synced with the backend /statuses endpoint.
 */

// Statuses from which orders CAN be changed (source statuses)
export const CHANGEABLE_STATUSES = [
  'طلب الشحن',
  'طلب شحن',
  'تم الاستلام بالمخزن'
]

// Statuses that orders can be changed TO (target statuses)
export const TARGET_STATUSES = [
  'تم التسليم',
  'مرتجع',
  'تسليم جزئي',
  'قيد التوصيل'
]

// All possible statuses
export const ALL_STATUSES = [
  ...CHANGEABLE_STATUSES,
  ...TARGET_STATUSES,
  'ملغى',
  'قيد التوصيل'
]

// Status display colors
export const STATUS_COLORS = {
  'تم التسليم': 'success',
  'تم الاستلام بالمخزن': 'info',
  'طلب الشحن': 'pending',
  'طلب شحن': 'pending',
  'مرتجع': 'error',
  'ملغى': 'error',
  'قيد التوصيل': 'info',
  'تسليم جزئي': 'warning'
}

/**
 * Get the color class for a given status
 * @param {string} status - The status string
 * @returns {string} - Color class name
 */
export const getStatusColor = (status) => {
  if (!status) return 'default'
  
  // Check direct match first
  if (STATUS_COLORS[status]) {
    return STATUS_COLORS[status]
  }
  
  // Fallback pattern matching (for partial matches)
  if (status.includes('تم')) return 'success'
  if (status.includes('الاستلام')) return 'info'
  if (status.includes('ملغى')) return 'error'
  
  return 'default'
}

/**
 * Check if a status can be changed
 * @param {string} status - The current status
 * @returns {boolean}
 */
export const canChangeStatus = (status) => {
  return CHANGEABLE_STATUSES.includes(status)
}
