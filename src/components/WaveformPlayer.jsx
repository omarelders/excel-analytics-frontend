import { useState, useRef, useEffect } from 'react'
import { Play, Pause } from 'lucide-react'
import './WaveformPlayer.css'

/**
 * Generates pseudo-random waveform bars based on note ID
 */
const generateWaveformBars = (count = 35, seed = 12345) => {
  const bars = []
  let x = seed
  for (let i = 0; i < count; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff
    const height = 25 + (x % 55)
    bars.push(height)
  }
  return bars
}

function WaveformPlayer({ audioData, duration, noteId }) {
  const audioRef = useRef(null)
  const waveformRef = useRef(null)
  const animationRef = useRef(null)
  
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [totalDuration, setTotalDuration] = useState(duration || 0)
  const [waveformBars] = useState(() => generateWaveformBars(35, noteId || 12345))
  const [isReady, setIsReady] = useState(false)
  
  // Create audio element once
  useEffect(() => {
    if (!audioData) return
    
    const audio = new Audio()
    audioRef.current = audio
    
    // Set up event listeners BEFORE setting src
    const handleLoadedData = () => {
      console.log('Audio loaded, duration:', audio.duration)
      if (audio.duration && !isNaN(audio.duration) && audio.duration !== Infinity) {
        setTotalDuration(audio.duration)
      } else if (duration) {
        setTotalDuration(duration)
      }
      setIsReady(true)
    }
    
    const handleEnded = () => {
      setIsPlaying(false)
      setCurrentTime(0)
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
    
    const handleError = (e) => {
      console.error('Audio error:', e)
    }
    
    audio.addEventListener('loadeddata', handleLoadedData)
    audio.addEventListener('canplaythrough', handleLoadedData)
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('error', handleError)
    
    // Now set the source
    audio.src = `data:audio/webm;base64,${audioData}`
    audio.load()
    
    return () => {
      audio.removeEventListener('loadeddata', handleLoadedData)
      audio.removeEventListener('canplaythrough', handleLoadedData)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('error', handleError)
      audio.pause()
      audio.src = ''
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [audioData, duration])
  
  // Use requestAnimationFrame for smooth progress updates
  useEffect(() => {
    const updateProgress = () => {
      if (audioRef.current && isPlaying) {
        setCurrentTime(audioRef.current.currentTime)
        animationRef.current = requestAnimationFrame(updateProgress)
      }
    }
    
    if (isPlaying) {
      animationRef.current = requestAnimationFrame(updateProgress)
    }
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [isPlaying])

  const togglePlay = (e) => {
    e.stopPropagation()
    e.preventDefault()
    
    if (!audioRef.current || !isReady) return
    
    if (isPlaying) {
      audioRef.current.pause()
      setIsPlaying(false)
    } else {
      audioRef.current.play().then(() => {
        setIsPlaying(true)
      }).catch(err => {
        console.error('Play failed:', err)
      })
    }
  }

  // Handle click on waveform to seek
  const handleWaveformClick = (e) => {
    e.stopPropagation()
    e.preventDefault()
    
    if (!audioRef.current || !waveformRef.current || totalDuration <= 0) return
    
    const rect = waveformRef.current.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const percentage = Math.max(0, Math.min(1, clickX / rect.width))
    const newTime = percentage * totalDuration
    
    console.log('Seeking to:', newTime, 'of', totalDuration)
    
    audioRef.current.currentTime = newTime
    setCurrentTime(newTime)
  }

  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // Calculate progress percentage
  const progress = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0

  return (
    <div 
      className={`waveform-player ${isPlaying ? 'playing' : ''}`} 
      onClick={(e) => e.stopPropagation()}
    >
      {/* Play/Pause Button */}
      <button 
        className="waveform-play-btn" 
        onClick={togglePlay}
        disabled={!isReady}
      >
        {isPlaying ? <Pause size={16} /> : <Play size={16} />}
      </button>

      {/* Waveform Bar - Click to seek */}
      <div 
        className="waveform-track"
        ref={waveformRef}
        onClick={handleWaveformClick}
      >
        <div className="waveform-bars">
          {waveformBars.map((height, index) => {
            const barPosition = ((index + 0.5) / waveformBars.length) * 100
            const isPlayed = barPosition <= progress
            return (
              <div
                key={index}
                className={`waveform-bar ${isPlayed ? 'played' : ''}`}
                style={{ height: `${height}%` }}
              />
            )
          })}
        </div>
        
        {/* Playhead indicator */}
        <div 
          className="waveform-playhead" 
          style={{ left: `${Math.min(100, progress)}%` }}
        />
      </div>

      {/* Time Display */}
      <div className="waveform-time">
        {formatTime(currentTime)} / {formatTime(totalDuration)}
      </div>
    </div>
  )
}

export default WaveformPlayer
