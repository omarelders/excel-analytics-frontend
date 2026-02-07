import { useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Calendar, ListChecks, Lightbulb, Video, Image as ImageIcon, Film, Grid3x3, Plus, X, Trash2, Edit3, Loader2 } from 'lucide-react'
import api from '../api'
import './ContentCalendar.css'

const filterTabs = [
  { id: 'all', label: 'Calendar - ALL', icon: Calendar },
  { id: 'progress', label: 'All in Progress', icon: ListChecks },
  { id: 'gallery', label: 'Gallery', icon: Grid3x3 }
]

const statusOptions = ['To Shoot', 'To Edit', 'Write Caption', 'Ready to Publish', 'Published']
const platformOptions = ['TikTok', 'Insta']
const typeOptions = ['video', 'photo']

const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function ContentCalendar() {
  // Initialize with current date
  const [currentDate, setCurrentDate] = useState(new Date())
  const [activeFilter, setActiveFilter] = useState('all')
  
  // Content data from API
  const [contentData, setContentData] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedDate, setSelectedDate] = useState(null)
  const [editingContent, setEditingContent] = useState(null)
  
  // Form state
  const [formData, setFormData] = useState({
    title: '',
    type: 'video',
    platforms: [],
    status: 'To Shoot',
    visualIdea: ''
  })
  
  // Drag and drop state
  const [draggedContent, setDraggedContent] = useState(null)
  const [dragOverDate, setDragOverDate] = useState(null)
  const [dragOverTrash, setDragOverTrash] = useState(false)

  // Fetch content from API
  const fetchContent = async () => {
    try {
      setIsLoading(true)
      const response = await api.get('/api/content')
      setContentData(response.data.data || [])
    } catch (error) {
      console.error('Failed to fetch content:', error)
      // Fallback to localStorage if API fails (for offline/first load)
      const saved = localStorage.getItem('contentCalendarData')
      if (saved) {
        setContentData(JSON.parse(saved))
      }
    } finally {
      setIsLoading(false)
    }
  }

  // Fetch on mount
  useEffect(() => {
    fetchContent()
  }, [])

  // Also keep localStorage as backup (will sync when API works)
  useEffect(() => {
    if (contentData.length > 0) {
      localStorage.setItem('contentCalendarData', JSON.stringify(contentData))
    }
  }, [contentData])

  const getMonthDays = (date) => {
    const year = date.getFullYear()
    const month = date.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const daysInMonth = lastDay.getDate()
    const startingDay = firstDay.getDay()
    
    const days = []
    
    // Previous month days
    const prevMonthLastDay = new Date(year, month, 0).getDate()
    for (let i = startingDay - 1; i >= 0; i--) {
      days.push({
        day: prevMonthLastDay - i,
        isCurrentMonth: false,
        date: new Date(year, month - 1, prevMonthLastDay - i)
      })
    }
    
    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({
        day: i,
        isCurrentMonth: true,
        date: new Date(year, month, i)
      })
    }
    
    // Next month days
    const remainingSlots = 42 - days.length
    for (let i = 1; i <= remainingSlots; i++) {
      days.push({
        day: i,
        isCurrentMonth: false,
        date: new Date(year, month + 1, i)
      })
    }
    
    return days
  }

  const formatDateKey = (date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  const getContentForDate = (date) => {
    const dateKey = formatDateKey(date)
    return contentData.filter(content => content.date === dateKey)
  }

  const filterContent = (content) => {
    if (activeFilter === 'all') return true
    if (activeFilter === 'progress') {
      return ['To Edit', 'To Shoot', 'Write Caption'].includes(content.status)
    }
    if (activeFilter === 'tiktok') return content.platforms.includes('TikTok')
    if (activeFilter === 'insta') return content.platforms.includes('Insta')
    return true
  }

  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))
  }

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))
  }

  const goToToday = () => {
    setCurrentDate(new Date())
  }

  const getStatusClass = (status) => {
    switch (status) {
      case 'Published': return 'status-published'
      case 'Ready to Publish': return 'status-ready'
      case 'To Edit': return 'status-edit'
      case 'To Shoot': return 'status-shoot'
      case 'Write Caption': return 'status-caption'
      default: return 'status-default'
    }
  }

  const getPlatformClass = (platform) => {
    switch (platform) {
      case 'TikTok': return 'platform-tiktok'
      case 'Insta': return 'platform-insta'
      default: return 'platform-default'
    }
  }

  // Modal handlers
  const openAddModal = (date) => {
    setSelectedDate(date)
    setEditingContent(null)
    setFormData({
      title: '',
      type: 'video',
      platforms: [],
      status: 'To Shoot',
      visualIdea: ''
    })
    setIsModalOpen(true)
  }

  const openEditModal = (content, e) => {
    e.stopPropagation()
    setEditingContent(content)
    setSelectedDate(new Date(content.date))
    setFormData({
      title: content.title,
      type: content.type,
      platforms: [...content.platforms],
      status: content.status,
      visualIdea: content.visualIdea || ''
    })
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingContent(null)
    setSelectedDate(null)
  }

  const handleFormChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const togglePlatform = (platform) => {
    setFormData(prev => ({
      ...prev,
      platforms: prev.platforms.includes(platform)
        ? prev.platforms.filter(p => p !== platform)
        : [...prev.platforms, platform]
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!formData.title.trim()) return
    
    setIsSaving(true)
    
    try {
      const itemData = {
        date: formatDateKey(selectedDate),
        title: formData.title,
        type: formData.type,
        platforms: formData.platforms,
        status: formData.status,
        visualIdea: formData.visualIdea
      }
      
      if (editingContent) {
        // Update existing content via API
        const response = await api.put(`/api/content/${editingContent.id}`, itemData)
        setContentData(prev => prev.map(item => 
          item.id === editingContent.id ? response.data : item
        ))
      } else {
        // Create new content via API
        const response = await api.post('/api/content', itemData)
        setContentData(prev => [...prev, response.data])
      }
      
      closeModal()
    } catch (error) {
      console.error('Failed to save content:', error)
      const errorMsg = error.response?.data?.detail || error.message || 'Unknown error'
      alert(`Failed to save content: ${errorMsg}`)
    } finally {
      setIsSaving(false)
    }
  }

  const deleteContent = async (contentId, e) => {
    e.stopPropagation()
    if (!window.confirm('Are you sure you want to delete this content?')) return
    
    try {
      await api.delete(`/api/content/${contentId}`)
      setContentData(prev => prev.filter(item => item.id !== contentId))
    } catch (error) {
      console.error('Failed to delete content:', error)
      alert('Failed to delete content. Please try again.')
    }
  }

  const isToday = (date) => {
    const today = new Date()
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear()
  }

  // Drag and drop handlers
  const handleDragStart = (e, content) => {
    setDraggedContent(content)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', content.id.toString())
    setTimeout(() => {
      e.target.classList.add('dragging')
    }, 0)
  }

  const handleDragEnd = (e) => {
    e.target.classList.remove('dragging')
    setDraggedContent(null)
    setDragOverDate(null)
  }

  const handleDragOver = (e, date) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const dateKey = formatDateKey(date)
    if (dragOverDate !== dateKey) {
      setDragOverDate(dateKey)
    }
  }

  const handleDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOverDate(null)
    }
  }

  const handleDrop = async (e, targetDate) => {
    e.preventDefault()
    const contentId = parseInt(e.dataTransfer.getData('text/plain'))
    const newDateKey = formatDateKey(targetDate)
    
    // Optimistic update
    setContentData(prev => prev.map(item => 
      item.id === contentId ? { ...item, date: newDateKey } : item
    ))
    
    // Update via API
    try {
      await api.patch(`/api/content/${contentId}/move`, null, {
        params: { new_date: newDateKey }
      })
    } catch (error) {
      console.error('Failed to move content:', error)
      // Revert on error
      fetchContent()
    }
    
    setDraggedContent(null)
    setDragOverDate(null)
  }

  // Trash Drop Handlers
  const handleTrashDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverTrash(true)
  }

  const handleTrashLeave = (e) => {
    e.preventDefault()
    setDragOverTrash(false)
  }

  const handleTrashDrop = async (e) => {
    e.preventDefault()
    const contentId = parseInt(e.dataTransfer.getData('text/plain'))
    
    if (contentId && window.confirm('Are you sure you want to delete this content?')) {
      try {
        await api.delete(`/api/content/${contentId}`)
        setContentData(prev => prev.filter(item => item.id !== contentId))
      } catch (error) {
        console.error('Failed to delete content:', error)
      }
    }
    
    setDragOverTrash(false)
    setDraggedContent(null)
  }

  const days = getMonthDays(currentDate)
  const monthName = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })

  return (
    <div className="content-calendar-page">
      {/* Header */}
      <div className="calendar-header">
        <div className="calendar-title">
          <Calendar className="calendar-icon" size={28} />
          <h1>Social Media Content Calendar</h1>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="filter-tabs">
        {filterTabs.map(tab => (
          <button
            key={tab.id}
            className={`filter-tab ${activeFilter === tab.id ? 'active' : ''}`}
            onClick={() => setActiveFilter(tab.id)}
          >
            <tab.icon className="tab-icon" size={14} />
            <span className="tab-label">{tab.label}</span>
          </button>
        ))}
        <div className="filter-spacer" />
        
        {/* Trash Drop Zone */}
        <div 
          className={`trash-drop-zone ${dragOverTrash ? 'drag-over' : ''} ${draggedContent ? 'visible' : ''}`}
          onDragOver={handleTrashDragOver}
          onDragLeave={handleTrashLeave}
          onDrop={handleTrashDrop}
          title="Drag content here to delete"
        >
          <Trash2 size={18} />
          <span className="trash-label">Drop to Delete</span>
        </div>

        <button className="today-btn" onClick={goToToday}>Today</button>
      </div>

      {/* Month Header with Navigation */}
      <div className="month-header">
        <button className="nav-btn" onClick={prevMonth}>
          <ChevronLeft size={20} />
        </button>
        <h2>{monthName}</h2>
        <button className="nav-btn" onClick={nextMonth}>
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="calendar-loading">
          <Loader2 className="spin" size={32} />
          <p>Loading calendar...</p>
        </div>
      )}

      {/* Calendar Grid */}
      {!isLoading && (
        <div className="calendar-grid">
          {/* Week Day Headers */}
          {weekDays.map(day => (
            <div key={day} className="weekday-header">{day}</div>
          ))}
          
          {/* Calendar Days */}
          {days.map((dayInfo, index) => {
            const dayContent = getContentForDate(dayInfo.date).filter(filterContent)
            const isTodayDate = isToday(dayInfo.date)
            
            return (
              <div 
                key={index} 
                className={`calendar-day ${!dayInfo.isCurrentMonth ? 'other-month' : ''} ${isTodayDate ? 'today' : ''} ${dragOverDate === formatDateKey(dayInfo.date) ? 'drag-over' : ''}`}
                onClick={() => openAddModal(dayInfo.date)}
                onDragOver={(e) => handleDragOver(e, dayInfo.date)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, dayInfo.date)}
              >
                <div className="day-header">
                  <div className="day-number">{dayInfo.day}</div>
                  <button 
                    className="add-content-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      openAddModal(dayInfo.date)
                    }}
                    title="Add content"
                  >
                    <Plus size={12} />
                  </button>
                </div>
                <div className="day-content">
                  {dayContent.map(content => (
                    <div 
                      key={content.id} 
                      className={`content-card ${draggedContent?.id === content.id ? 'dragging' : ''}`}
                      draggable
                      onDragStart={(e) => handleDragStart(e, content)}
                      onDragEnd={handleDragEnd}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="content-header">
                        {content.type === 'video' ? (
                          <Video className="content-type-icon" size={14} />
                        ) : (
                          <ImageIcon className="content-type-icon" size={14} />
                        )}
                        <span className="content-title">{content.title}</span>
                        <div className="content-actions">
                          <button 
                            className="action-btn edit-btn" 
                            onClick={(e) => openEditModal(content, e)}
                            title="Edit"
                          >
                            <Edit3 size={12} />
                          </button>
                          <button 
                            className="action-btn delete-btn" 
                            onClick={(e) => deleteContent(content.id, e)}
                            title="Delete"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                      <div className="content-type-badge">
                        <span className={`type-tag ${content.type}`}>
                          {content.type === 'video' ? 'Video' : 'Photo'}
                        </span>
                      </div>
                      <div className={`content-status ${getStatusClass(content.status)}`}>
                        <span className="status-dot" />
                        <span>{content.status}</span>
                      </div>
                      <div className="content-platforms">
                        {content.platforms.map(platform => (
                          <span 
                            key={platform} 
                            className={`platform-badge ${getPlatformClass(platform)}`}
                          >
                            {platform}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add/Edit Modal */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingContent ? 'Edit Content' : 'Add New Content'}</h3>
              <button className="modal-close" onClick={closeModal}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Date</label>
                  <input 
                    type="date" 
                    value={formatDateKey(selectedDate)} 
                    onChange={(e) => setSelectedDate(new Date(e.target.value + 'T00:00:00'))}
                  />
                </div>
                
                <div className="form-group">
                  <label>Title</label>
                  <input 
                    type="text" 
                    value={formData.title} 
                    onChange={(e) => handleFormChange('title', e.target.value)}
                    placeholder="Enter content title"
                    required
                  />
                </div>
                
                <div className="form-group">
                  <label>Type</label>
                  <div className="radio-group">
                    {typeOptions.map(type => (
                      <label key={type} className="radio-label">
                        <input 
                          type="radio" 
                          name="type" 
                          value={type}
                          checked={formData.type === type}
                          onChange={(e) => handleFormChange('type', e.target.value)}
                        />
                        <span className="radio-text">{type === 'video' ? 'Video' : 'Photo'}</span>
                      </label>
                    ))}
                  </div>
                </div>
                
                <div className="form-group">
                  <label>Platforms</label>
                  <div className="checkbox-group">
                    {platformOptions.map(platform => (
                      <label key={platform} className="checkbox-label">
                        <input 
                          type="checkbox" 
                          checked={formData.platforms.includes(platform)}
                          onChange={() => togglePlatform(platform)}
                        />
                        <span className="checkbox-text">{platform}</span>
                      </label>
                    ))}
                  </div>
                </div>
                
                <div className="form-group">
                  <label>Status</label>
                  <select 
                    value={formData.status}
                    onChange={(e) => handleFormChange('status', e.target.value)}
                  >
                    {statusOptions.map(status => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </div>
                
                <div className="form-group">
                  <label>Visual Idea</label>
                  <textarea 
                    value={formData.visualIdea}
                    onChange={(e) => handleFormChange('visualIdea', e.target.value)}
                    placeholder="Describe the visual concept..."
                    rows={3}
                  />
                </div>
              </div>
              
              <div className="modal-footer">
                <button type="button" className="btn-cancel" onClick={closeModal}>
                  Cancel
                </button>
                <button type="submit" className="btn-submit" disabled={isSaving}>
                  {isSaving ? 'Saving...' : (editingContent ? 'Save Changes' : 'Add Content')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default ContentCalendar
