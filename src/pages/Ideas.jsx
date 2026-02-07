import { useState, useEffect, useRef } from 'react'
import { Plus, Star, Calendar, Edit3, Trash2, X, Mic, Square, Play, Pause, Volume2 } from 'lucide-react'
import { useAudioRecorder } from '../hooks/useAudioRecorder'
import WaveformPlayer from '../components/WaveformPlayer'
import api from '../api'
import './Ideas.css'

// Color options for notes
const noteColors = [
  { id: 'yellow', bg: 'hsl(45 93% 75%)', text: 'hsl(45 60% 25%)' },
  { id: 'orange', bg: 'hsl(25 95% 70%)', text: 'hsl(25 60% 25%)' },
  { id: 'pink', bg: 'hsl(350 90% 80%)', text: 'hsl(350 60% 30%)' },
  { id: 'purple', bg: 'hsl(280 70% 80%)', text: 'hsl(280 50% 30%)' },
  { id: 'blue', bg: 'hsl(200 80% 75%)', text: 'hsl(200 60% 25%)' },
  { id: 'green', bg: 'hsl(150 60% 75%)', text: 'hsl(150 50% 25%)' },
  { id: 'cyan', bg: 'hsl(180 70% 70%)', text: 'hsl(180 60% 20%)' }
]

function Ideas() {
  // Notes data from API
  const [notes, setNotes] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingNote, setEditingNote] = useState(null)
  
  // Form state
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    color: 'yellow',
    noteType: 'text' // 'text' or 'voice'
  })
  
  // Filter state
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
  
  // Animation state for quick note creation
  const [animatingNote, setAnimatingNote] = useState(null)
  
  // Audio recorder hook
  const recorder = useAudioRecorder(120) // 2 minute max
  
  // Audio player for voice notes
  const [playingNoteId, setPlayingNoteId] = useState(null)
  const audioRefs = useRef({})

  // Fetch notes from API
  const fetchNotes = async () => {
    try {
      setIsLoading(true)
      const response = await api.get('/api/notes', {
        params: { favorites_only: showFavoritesOnly }
      })
      setNotes(response.data.data || [])
    } catch (error) {
      console.error('Failed to fetch notes:', error)
      // Fallback to localStorage if API fails
      const saved = localStorage.getItem('ideasNotesData')
      if (saved) {
        setNotes(JSON.parse(saved))
      }
    } finally {
      setIsLoading(false)
    }
  }

  // Fetch on mount and when filter changes
  useEffect(() => {
    fetchNotes()
  }, [showFavoritesOnly])

  const openAddModal = () => {
    setEditingNote(null)
    setFormData({ title: '', content: '', color: 'yellow', noteType: 'text' })
    recorder.clearRecording()
    setIsModalOpen(true)
  }

  const openEditModal = (note, e) => {
    e.stopPropagation()
    setEditingNote(note)
    setFormData({
      title: note.title,
      content: note.content || '',
      color: note.color,
      noteType: note.note_type || 'text'
    })
    recorder.clearRecording()
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingNote(null)
    recorder.clearRecording()
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!formData.title.trim()) return
    
    // For voice notes, must have recording
    if (formData.noteType === 'voice' && !recorder.hasRecording && !editingNote) {
      return
    }

    setIsSaving(true)
    
    try {
      let noteData = {
        title: formData.title,
        content: formData.content,
        color: formData.color,
        note_type: formData.noteType
      }
      
      // Add audio data for voice notes
      if (formData.noteType === 'voice' && recorder.hasRecording) {
        const base64Audio = await recorder.getBase64()
        noteData.audio_data = base64Audio
        noteData.audio_duration = recorder.duration
      }
      
      let response
      if (editingNote) {
        // Update existing note
        response = await api.put(`/api/notes/${editingNote.id}`, noteData)
        setNotes(prev => prev.map(note => 
          note.id === editingNote.id ? response.data : note
        ))
      } else {
        // Create new note
        response = await api.post('/api/notes', noteData)
        setNotes(prev => [response.data, ...prev])
      }
      
      closeModal()
    } catch (error) {
      console.error('Failed to save note:', error)
      alert('Failed to save note. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  const deleteNote = async (noteId, e) => {
    e.stopPropagation()
    if (!window.confirm('Are you sure you want to delete this note?')) return
    
    try {
      await api.delete(`/api/notes/${noteId}`)
      setNotes(prev => prev.filter(note => note.id !== noteId))
    } catch (error) {
      console.error('Failed to delete note:', error)
      alert('Failed to delete note. Please try again.')
    }
  }

  const toggleFavorite = async (noteId, e) => {
    e.stopPropagation()
    try {
      const response = await api.patch(`/api/notes/${noteId}/favorite`)
      setNotes(prev => prev.map(note => 
        note.id === noteId
          ? { ...note, is_favorite: response.data.is_favorite }
          : note
      ))
    } catch (error) {
      console.error('Failed to toggle favorite:', error)
    }
  }

  const exportToCalendar = async (note, e) => {
    e.stopPropagation()

    // Format today's date
    const today = new Date()
    const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

    try {
      await api.post('/api/content', {
        date: dateKey,
        title: note.title,
        type: 'video',
        platforms: ['TikTok'],
        status: 'To Shoot',
        visualIdea: note.content || ''
      })

      alert(`"${note.title}" exported to today's calendar!`)
    } catch (error) {
      console.error('Failed to export note to calendar:', error)
      alert(error.response?.data?.detail || 'Failed to export note to calendar. Please try again.')
    }
  }

  // Quick create note from color click
  const createQuickNote = async (colorId, e) => {
    const rect = e.target.getBoundingClientRect()
    
    try {
      const response = await api.post('/api/notes', {
        title: 'Untitled Note',
        content: '',
        color: colorId,
        note_type: 'text'
      })
      
      const newNote = {
        ...response.data,
        animOrigin: {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2
        }
      }
      
      setAnimatingNote(newNote)
      setNotes(prev => [newNote, ...prev])
      
      // Clear animation after it completes
      setTimeout(() => {
        setAnimatingNote(null)
      }, 600)
    } catch (error) {
      console.error('Failed to create note:', error)
    }
  }

  const formatDate = (dateString) => {
    if (!dateString) return ''
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const getColorStyle = (colorId) => {
    const color = noteColors.find(c => c.id === colorId) || noteColors[0]
    return {
      backgroundColor: color.bg,
      color: color.text
    }
  }

  // Format duration for display
  const formatDuration = (seconds) => {
    if (!seconds) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // Play/pause voice note
  const togglePlayVoiceNote = (note, e) => {
    e.stopPropagation()
    
    if (!note.audio_data) return
    
    // Create audio element if not exists
    if (!audioRefs.current[note.id]) {
      const audio = new Audio(`data:audio/webm;base64,${note.audio_data}`)
      audio.onended = () => setPlayingNoteId(null)
      audioRefs.current[note.id] = audio
    }
    
    const audio = audioRefs.current[note.id]
    
    if (playingNoteId === note.id) {
      audio.pause()
      setPlayingNoteId(null)
    } else {
      // Stop any currently playing
      Object.values(audioRefs.current).forEach(a => a.pause())
      audio.currentTime = 0
      audio.play()
      setPlayingNoteId(note.id)
    }
  }

  const filteredNotes = notes

  return (
    <div className="ideas-page">
      {/* Header */}
      <div className="ideas-header">
        <div className="header-left">
          <button className="add-note-btn" onClick={openAddModal}>
            <Plus size={20} />
          </button>
          <h1>Notes</h1>
        </div>
        <div className="header-right">
          <button 
            className={`filter-favorites-btn ${showFavoritesOnly ? 'active' : ''}`}
            onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
          >
            <Star size={16} fill={showFavoritesOnly ? 'currentColor' : 'none'} />
            {showFavoritesOnly ? 'All Notes' : 'Favorites'}
          </button>
        </div>
      </div>

      {/* Color Legend */}
      <div className="color-legend">
        {noteColors.map(color => (
          <button
            key={color.id} 
            className="color-dot"
            style={{ backgroundColor: color.bg }}
            title={`Create ${color.id} note`}
            onClick={(e) => createQuickNote(color.id, e)}
          />
        ))}
      </div>

      {/* Notes Grid */}
      <div className="notes-grid">
        {isLoading ? (
          <div className="empty-state">
            <p>Loading notes...</p>
          </div>
        ) : filteredNotes.length === 0 ? (
          <div className="empty-state">
            <p>{showFavoritesOnly ? 'No favorite notes yet.' : 'No notes yet. Click + to create one!'}</p>
          </div>
        ) : (
          filteredNotes.map(note => {
            const isAnimating = animatingNote?.id === note.id
            const isPlaying = playingNoteId === note.id
            return (
            <div 
              key={note.id} 
              className={`note-card ${isAnimating ? 'quick-create' : ''} ${note.note_type === 'voice' ? 'voice-note' : ''}`}
              style={{
                ...getColorStyle(note.color),
                ...(isAnimating && note.animOrigin ? {
                  '--origin-x': `${note.animOrigin.x}px`,
                  '--origin-y': `${note.animOrigin.y}px`
                } : {})
              }}
            >
              <div className="note-header">
                {note.note_type === 'voice' && (
                  <span className="voice-indicator">
                    <Volume2 size={14} />
                  </span>
                )}
                <button 
                  className={`favorite-btn ${note.is_favorite ? 'active' : ''}`}
                  onClick={(e) => toggleFavorite(note.id, e)}
                  title={note.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
                >
                  <Star size={16} fill={note.is_favorite ? 'currentColor' : 'none'} />
                </button>
              </div>
              
              <h3 className="note-title">{note.title}</h3>
              
              {note.note_type === 'voice' && note.audio_data ? (
                <WaveformPlayer 
                  audioData={note.audio_data}
                  duration={note.audio_duration}
                  noteId={note.id}
                />
              ) : note.content && (
                <p className="note-content">{note.content}</p>
              )}
              
              <div className="note-footer">
                <span className="note-date">{formatDate(note.created_at)}</span>
                <div className="note-actions">
                  <button 
                    className="action-btn"
                    onClick={(e) => exportToCalendar(note, e)}
                    title="Export to today's calendar"
                  >
                    <Calendar size={14} />
                  </button>
                  <button 
                    className="action-btn"
                    onClick={(e) => openEditModal(note, e)}
                    title="Edit note"
                  >
                    <Edit3 size={14} />
                  </button>
                  <button 
                    className="action-btn delete"
                    onClick={(e) => deleteNote(note.id, e)}
                    title="Delete note"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          )})
        )}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingNote ? 'Edit Note' : 'New Note'}</h2>
              <button className="close-btn" onClick={closeModal}>
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                {/* Note Type Toggle */}
                {!editingNote && (
                  <div className="form-group">
                    <label>Type</label>
                    <div className="note-type-toggle">
                      <button
                        type="button"
                        className={`type-btn ${formData.noteType === 'text' ? 'active' : ''}`}
                        onClick={() => {
                          setFormData(prev => ({ ...prev, noteType: 'text' }))
                          recorder.clearRecording()
                        }}
                      >
                        <Edit3 size={16} />
                        Text
                      </button>
                      <button
                        type="button"
                        className={`type-btn ${formData.noteType === 'voice' ? 'active' : ''}`}
                        onClick={() => setFormData(prev => ({ ...prev, noteType: 'voice' }))}
                      >
                        <Mic size={16} />
                        Voice
                      </button>
                    </div>
                  </div>
                )}
                
                <div className="form-group">
                  <label>Title</label>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Note title..."
                    autoFocus
                  />
                </div>
                
                {formData.noteType === 'text' ? (
                  <div className="form-group">
                    <label>Content</label>
                    <textarea
                      value={formData.content}
                      onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
                      placeholder="Write your ideas here..."
                      rows={5}
                    />
                  </div>
                ) : (
                  <div className="form-group">
                    <label>Voice Recording</label>
                    <div className="voice-recorder">
                      {recorder.error && (
                        <div className="recorder-error">
                          {recorder.error}
                        </div>
                      )}
                      
                      {!recorder.hasRecording ? (
                        <div className="recorder-controls">
                          {recorder.isRecording ? (
                            <>
                              <div className={`recording-indicator ${recorder.isPaused ? 'paused' : ''}`}>
                                <span className="recording-dot"></span>
                                <span className="recording-time">{recorder.formattedDuration}</span>
                              </div>
                              <button
                                type="button"
                                className="recorder-btn stop"
                                onClick={recorder.stopRecording}
                              >
                                <Square size={20} />
                                Stop
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="recorder-btn start"
                              onClick={recorder.startRecording}
                            >
                              <Mic size={20} />
                              Start Recording
                            </button>
                          )}
                          <span className="max-duration">Max 2 minutes</span>
                        </div>
                      ) : (
                        <div className="recorder-preview">
                          <audio 
                            src={recorder.audioUrl} 
                            controls 
                            className="audio-preview"
                          />
                          <div className="preview-info">
                            <span className="preview-duration">
                              Duration: {recorder.formattedDuration}
                            </span>
                            <button
                              type="button"
                              className="re-record-btn"
                              onClick={recorder.clearRecording}
                            >
                              Re-record
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                
                <div className="form-group">
                  <label>Color</label>
                  <div className="color-picker">
                    {noteColors.map(color => (
                      <button
                        key={color.id}
                        type="button"
                        className={`color-option ${formData.color === color.id ? 'selected' : ''}`}
                        style={{ backgroundColor: color.bg }}
                        onClick={() => setFormData(prev => ({ ...prev, color: color.id }))}
                      />
                    ))}
                  </div>
                </div>
              </div>
              
              <div className="modal-footer">
                <button type="button" className="btn-cancel" onClick={closeModal}>
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn-submit"
                  disabled={isSaving || (formData.noteType === 'voice' && !recorder.hasRecording && !editingNote)}
                >
                  {isSaving ? 'Saving...' : (editingNote ? 'Save Changes' : 'Create Note')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default Ideas
