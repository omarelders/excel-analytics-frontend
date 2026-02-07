import { useState, useEffect } from 'react'
import api from '../api'
import { TrendingUp, Package, Clock, Users, MapPin, DollarSign, Loader2, AlertCircle, RefreshCw } from 'lucide-react'
import { STATUS_COLORS } from '../constants/statuses'
import './Dashboard.css'

// Map status color names to actual hex colors
const STATUS_HEX_COLORS = {
  success: '#10b981',
  info: '#3b82f6',
  warning: '#f59e0b',
  error: '#ef4444',
  pending: '#8b5cf6',
  default: '#6b7280'
}

function DashboardPage() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [recentShipments, setRecentShipments] = useState([])

  useEffect(() => {
    fetchDashboardData()
  }, [])

  const fetchDashboardData = async () => {
    setLoading(true)
    setError(null)
    try {
      // Fetch analytics for accurate stats (uses full dataset)
      const analyticsRes = await api.get('/api/analytics')
      const analytics = analyticsRes.data
      
      // Convert status_distribution array to statusCounts object
      const statusCounts = {}
      if (analytics.status_distribution) {
        analytics.status_distribution.forEach(item => {
          statusCounts[item.status] = item.count
        })
      }
      
      // Get unique cities count from top_cities
      const cityCount = analytics.top_cities?.length || 0
      
      setStats({
        totalShipments: analytics.summary?.total_shipments || 0,
        totalValue: analytics.summary?.total_value || 0,
        avgValue: analytics.summary?.total_shipments > 0 
          ? (analytics.summary?.total_value || 0) / analytics.summary.total_shipments 
          : 0,
        deliveryRate: analytics.summary?.delivery_rate || 0,
        clientCount: analytics.summary?.top_client ? 1 : 0, // We have top client info
        topClient: analytics.summary?.top_client,
        topClientCount: analytics.summary?.top_client_count || 0,
        cityCount: cityCount,
        statusCounts
      })
      
      // Fetch recent shipments separately (just for the list, limit is fine here)
      const recentRes = await api.get('/shipments', { params: { limit: 5 } })
      setRecentShipments(recentRes.data.data || [])
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err)
      setError(err.response?.data?.detail || 'Failed to load dashboard data')
    } finally {
      setLoading(false)
    }
  }

  // Use centralized status colors
  const getStatusColor = (status) => {
    if (!status) return STATUS_HEX_COLORS.default
    const colorName = STATUS_COLORS[status] || 'default'
    return STATUS_HEX_COLORS[colorName] || STATUS_HEX_COLORS.default
  }

  if (loading) {
    return (
      <div className="dashboard-page">
        <div className="loading-container">
          <Loader2 size={32} className="spin" />
          <p>Loading dashboard...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="dashboard-page">
        <div className="error-container">
          <AlertCircle size={32} />
          <p>{error}</p>
          <button onClick={fetchDashboardData} className="retry-btn">
            <RefreshCw size={16} />
            <span>Retry</span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <h1>Dashboard</h1>
        <button onClick={fetchDashboardData} className="refresh-btn">
          <RefreshCw size={16} />
          <span>Refresh</span>
        </button>
      </div>
      
      {/* Stats Cards */}
      <div className="stats-grid">
        <div className="stat-card primary">
          <div className="stat-icon">
            <Package size={24} />
          </div>
          <div className="stat-info">
            <span className="stat-value">{stats?.totalShipments?.toLocaleString() || 0}</span>
            <span className="stat-label">Total Shipments</span>
          </div>
        </div>
        
        <div className="stat-card success">
          <div className="stat-icon">
            <DollarSign size={24} />
          </div>
          <div className="stat-info">
            <span className="stat-value">{(stats?.totalValue || 0).toLocaleString()} EGP</span>
            <span className="stat-label">Total Value</span>
          </div>
        </div>
        
        <div className="stat-card info">
          <div className="stat-icon">
            <Users size={24} />
          </div>
          <div className="stat-info">
            <span className="stat-value">{stats?.clientCount || 0}</span>
            <span className="stat-label">Unique Clients</span>
          </div>
        </div>
        
        <div className="stat-card warning">
          <div className="stat-icon">
            <MapPin size={24} />
          </div>
          <div className="stat-info">
            <span className="stat-value">{stats?.cityCount || 0}</span>
            <span className="stat-label">Cities Covered</span>
          </div>
        </div>
      </div>

      {/* Status Breakdown */}
      {stats?.statusCounts && Object.keys(stats.statusCounts).length > 0 && (
        <div className="status-section">
          <h2>Status Breakdown</h2>
          <div className="status-grid">
            {Object.entries(stats.statusCounts).map(([status, count]) => (
              <div key={status} className="status-item">
                <div 
                  className="status-indicator" 
                  style={{ backgroundColor: getStatusColor(status) }}
                />
                <span className="status-name">{status}</span>
                <span className="status-count">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Shipments */}
      <div className="recent-section">
        <h2>Recent Shipments</h2>
        {recentShipments.length === 0 ? (
          <p className="no-data">No shipments yet</p>
        ) : (
          <div className="recent-list">
            {recentShipments.map((shipment) => (
              <div key={shipment['الكود'] || Math.random()} className="recent-item">
                <div className="recent-code">{shipment['الكود']}</div>
                <div className="recent-details">
                  <span className="recent-client">{shipment['العميل']}</span>
                  <span className="recent-city">{shipment['مدينة المستلم']}</span>
                </div>
                <div className="recent-amount">{shipment['قيمة الطرد']} EGP</div>
                <div 
                  className="recent-status"
                  style={{ color: getStatusColor(shipment['الحالة']) }}
                >
                  {shipment['الحالة']}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default DashboardPage
