import { useState, useEffect, useMemo } from 'react'
import api from '../api'
import { Search, ChevronLeft, ChevronRight, ChevronFirst, ChevronLast, Package, DollarSign, Filter, X, Loader2, AlertCircle, RefreshCw, Check, Calendar } from 'lucide-react'
import { CHANGEABLE_STATUSES, TARGET_STATUSES, canChangeStatus, getStatusColor } from '../constants/statuses'
import './AllOrders.css'

const PAGE_SIZE = 100

function AllOrdersPage() {
  const [shipments, setShipments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [currentPage, setCurrentPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchInput, setSearchInput] = useState('')
  
  // Filter states
  const [priceTypeFilter, setPriceTypeFilter] = useState('')
  const [amountMin, setAmountMin] = useState('')
  const [amountMax, setAmountMax] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  
  // Date filter states
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  
  // Stats
  const [stats, setStats] = useState({ totalOrders: 0, totalPrice: 0 })
  
  // Get unique price types for filter dropdown
  const [priceTypes, setPriceTypes] = useState([])
  
  // Status update state
  const [updatingStatus, setUpdatingStatus] = useState(null)
  const [statusMessage, setStatusMessage] = useState(null)

  const fetchShipments = async (page = 0, search = '', dateFromVal = '', dateToVal = '') => {
    setLoading(true)
    setError(null)
    try {
      const params = { limit: PAGE_SIZE, offset: page * PAGE_SIZE }
      if (search) params.search = search
      if (dateFromVal) params.date_from = dateFromVal
      if (dateToVal) params.date_to = dateToVal
      
      const response = await api.get('/shipments', { params })
      setShipments(response.data.data || [])
      setTotalCount(response.data.total || 0)
      
      // Extract unique price types
      const types = [...new Set(response.data.data.map(s => s['نوع السعر']).filter(Boolean))]
      setPriceTypes(prev => {
        const combined = [...new Set([...prev, ...types])]
        return combined
      })
    } catch (err) {
      console.error('Failed to fetch shipments:', err)
      setError(err.response?.data?.detail || 'Failed to load orders')
      setShipments([])
    } finally {
      setLoading(false)
    }
  }

  // Fetch stats (total orders and total price) - now respects date filters
  const fetchStats = async (dateFromVal = '', dateToVal = '') => {
    try {
      const params = { limit: 1 }
      if (dateFromVal) params.date_from = dateFromVal
      if (dateToVal) params.date_to = dateToVal
      
      // Get filtered shipments count
      const response = await api.get('/shipments', { params })
      setStats(prev => ({ ...prev, totalOrders: response.data.total || 0 }))
      
      // For total price, fetch more data with same filters
      const allParams = { limit: 1000 }
      if (dateFromVal) allParams.date_from = dateFromVal
      if (dateToVal) allParams.date_to = dateToVal
      
      const allData = await api.get('/shipments', { params: allParams })
      const total = allData.data.data.reduce((sum, s) => sum + (s['قيمة الطرد'] || 0), 0)
      setStats(prev => ({ ...prev, totalPrice: total }))
    } catch (err) {
      console.error('Failed to fetch stats:', err)
    }
  }

  // Update shipment status
  const updateStatus = async (shipmentCode, newStatus) => {
    setUpdatingStatus(shipmentCode)
    setStatusMessage(null)
    try {
      await api.patch(`/shipments/${encodeURIComponent(shipmentCode)}/status?new_status=${encodeURIComponent(newStatus)}`)
      
      // Update local state
      setShipments(prev => prev.map(s => 
        s['الكود'] === shipmentCode ? { ...s, 'الحالة': newStatus } : s
      ))
      
      setStatusMessage({ type: 'success', text: `Status updated to "${newStatus}"` })
      setTimeout(() => setStatusMessage(null), 3000)
    } catch (err) {
      console.error('Failed to update status:', err)
      setStatusMessage({ 
        type: 'error', 
        text: err.response?.data?.detail || 'Failed to update status' 
      })
    } finally {
      setUpdatingStatus(null)
    }
  }

  useEffect(() => {
    fetchShipments(currentPage, searchTerm, dateFrom, dateTo)
  }, [currentPage, searchTerm, dateFrom, dateTo])

  useEffect(() => {
    fetchStats(dateFrom, dateTo)
  }, [dateFrom, dateTo])

  const handleSearch = (e) => {
    e.preventDefault()
    setSearchTerm(searchInput)
    setCurrentPage(0)
  }

  const clearFilters = () => {
    setPriceTypeFilter('')
    setAmountMin('')
    setAmountMax('')
    setDateFrom('')
    setDateTo('')
  }

  // canChangeStatus is now imported from '../constants/statuses'

  // Apply client-side filters
  const filteredShipments = useMemo(() => {
    return shipments.filter(s => {
      // Price type filter
      if (priceTypeFilter && s['نوع السعر'] !== priceTypeFilter) {
        return false
      }
      // Amount range filter
      const amount = s['قيمة الطرد'] || 0
      if (amountMin && amount < parseFloat(amountMin)) {
        return false
      }
      if (amountMax && amount > parseFloat(amountMax)) {
        return false
      }
      return true
    })
  }, [shipments, priceTypeFilter, amountMin, amountMax])

  const hasActiveFilters = priceTypeFilter || amountMin || amountMax || dateFrom || dateTo

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  return (
    <div className="all-orders-page">
      {/* Status Message Toast */}
      {statusMessage && (
        <div className={`status-toast ${statusMessage.type}`}>
          {statusMessage.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Stats Bar */}
      <div className="stats-bar">
        <div className="stat-item">
          <Package size={20} />
          <div className="stat-info">
            <span className="stat-label">Total Orders</span>
            <span className="stat-value">{stats.totalOrders.toLocaleString()}</span>
          </div>
        </div>
        <div className="stat-item">
          <DollarSign size={20} />
          <div className="stat-info">
            <span className="stat-label">Total Value</span>
            <span className="stat-value">{stats.totalPrice.toLocaleString()} EGP</span>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="controls-bar">
        <form className="search-form" onSubmit={handleSearch}>
          <Search size={16} />
          <input
            type="text"
            placeholder="Search orders..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          {searchTerm && (
            <button 
              type="button" 
              className="clear-btn" 
              onClick={() => { setSearchInput(''); setSearchTerm(''); setCurrentPage(0); }}
            >
              <X size={14} />
            </button>
          )}
          <button type="submit" className="search-btn">Search</button>
        </form>

        <button 
          className={`filter-toggle ${showFilters ? 'active' : ''}`}
          onClick={() => setShowFilters(!showFilters)}
        >
          <Filter size={16} />
          <span>Filters</span>
          {hasActiveFilters && <span className="filter-badge">•</span>}
        </button>

        <button 
          className="refresh-btn" 
          onClick={() => { fetchShipments(currentPage, searchTerm, dateFrom, dateTo); fetchStats(dateFrom, dateTo); }}
          disabled={loading}
        >
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <div className="filter-panel">
          <div className="filter-group">
            <label>نوع السعر (Price Type)</label>
            <select 
              value={priceTypeFilter} 
              onChange={(e) => setPriceTypeFilter(e.target.value)}
            >
              <option value="">All</option>
              {priceTypes.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label>قيمة الطرد (Amount Range)</label>
            <div className="range-inputs">
              <input
                type="number"
                placeholder="Min"
                value={amountMin}
                onChange={(e) => setAmountMin(e.target.value)}
              />
              <span>-</span>
              <input
                type="number"
                placeholder="Max"
                value={amountMax}
                onChange={(e) => setAmountMax(e.target.value)}
              />
            </div>
          </div>

          {/* Date Filter */}
          <div className="filter-group date-filter-group">
            <label>
              <Calendar size={14} />
              التاريخ (Date Filter)
            </label>
            <div className="date-inputs">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                title="From date"
              />
              <span>to</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                title="To date"
                min={dateFrom}
              />
            </div>
          </div>

          {hasActiveFilters && (
            <button className="clear-filters-btn" onClick={clearFilters}>
              <X size={14} />
              Clear Filters
            </button>
          )}
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="error-message">
          <AlertCircle size={16} />
          <span>{error}</span>
          <button onClick={() => fetchShipments(currentPage, searchTerm, dateFrom, dateTo)}>Retry</button>
        </div>
      )}

      {/* Table */}
      <div className="table-card">
        {loading ? (
          <div className="loading-state">
            <Loader2 size={24} className="spin" />
            <span>Loading orders...</span>
          </div>
        ) : filteredShipments.length === 0 ? (
          <div className="empty-state">
            <Package size={48} />
            <p>{hasActiveFilters ? 'No orders match your filters' : 'No orders found'}</p>
          </div>
        ) : (
          <>
            <div className="table-wrapper">
              <table className="orders-table">
                <thead>
                  <tr>
                    <th>الكود</th>
                    <th>التاريخ</th>
                    <th>العميل</th>
                    <th>الوصف</th>
                    <th>الحالة</th>
                    <th>تغيير الحالة</th>
                    <th>المستلم</th>
                    <th>المدينة</th>
                    <th>قيمة الطرد</th>
                    <th>نوع السعر</th>
                    <th>الوزن</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredShipments.map((shipment) => (
                    <tr key={shipment['الكود'] || Math.random()}>
                      <td><span className="code">{shipment['الكود']}</span></td>
                      <td className="date-cell">{shipment['التاريخ']}</td>
                      <td className="client-cell">{shipment['العميل']}</td>
                      <td>{shipment['الوصف']}</td>
                      <td><span className={`badge badge-${getStatusColor(shipment['الحالة'])}`}>{shipment['الحالة']}</span></td>
                      <td className="status-action-cell">
                        {canChangeStatus(shipment['الحالة']) ? (
                          <div className="status-actions">
                            {updatingStatus === shipment['الكود'] ? (
                              <Loader2 size={16} className="spin" />
                            ) : (
                              <>
                                <button 
                                  className="status-btn delivered"
                                  onClick={() => updateStatus(shipment['الكود'], 'تم التسليم')}
                                  title="تم التسليم"
                                >
                                  تسليم
                                </button>
                                <button 
                                  className="status-btn returned"
                                  onClick={() => updateStatus(shipment['الكود'], 'مرتجع')}
                                  title="مرتجع"
                                >
                                  مرتجع
                                </button>
                              </>
                            )}
                          </div>
                        ) : (
                          <span className="no-action">—</span>
                        )}
                      </td>
                      <td>{shipment['المستلم']}</td>
                      <td>{shipment['مدينة المستلم']}</td>
                      <td className="amount-cell">{shipment['قيمة الطرد']}</td>
                      <td>{shipment['نوع السعر']}</td>
                      <td className="weight-cell">{shipment['الوزن']}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="table-footer">
              <div className="pagination">
                <button 
                  className="pagination-btn"
                  onClick={() => setCurrentPage(0)}
                  disabled={currentPage === 0}
                >
                  <ChevronFirst size={18} strokeWidth={2} color="#ffffff" />
                </button>
                <button 
                  className="pagination-btn"
                  onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                  disabled={currentPage === 0}
                >
                  <ChevronLeft size={18} strokeWidth={2} color="#ffffff" />
                </button>
                <span className="page-info">
                  Page {currentPage + 1} of {totalPages}
                </span>
                <button 
                  className="pagination-btn"
                  onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={currentPage >= totalPages - 1}
                >
                  <ChevronRight size={18} strokeWidth={2} color="#ffffff" />
                </button>
                <button 
                  className="pagination-btn"
                  onClick={() => setCurrentPage(totalPages - 1)}
                  disabled={currentPage >= totalPages - 1}
                >
                  <ChevronLast size={18} strokeWidth={2} color="#ffffff" />
                </button>
              </div>
              <span className="results-info">
                {currentPage * PAGE_SIZE + 1}-{Math.min((currentPage + 1) * PAGE_SIZE, totalCount)} of {totalCount}
                {hasActiveFilters && ` (${filteredShipments.length} shown after filters)`}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default AllOrdersPage
