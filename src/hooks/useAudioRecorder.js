import { useState, useRef, useCallback, useEffect } from 'react'

/**
 * Custom hook for audio recording using MediaRecorder API
 * Supports recording, playback, and conversion to Base64
 */
export function useAudioRecorder(maxDurationSeconds = 120) {
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [duration, setDuration] = useState(0)
  const [audioBlob, setAudioBlob] = useState(null)
  const [audioUrl, setAudioUrl] = useState(null)
  const [error, setError] = useState(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const timerRef = useRef(null)
  const startTimeRef = useRef(null)
  const elapsedBeforePauseRef = useRef(0)

  // Stop recording
  const stopRecording = useCallback(() => {
    const mediaRecorder = mediaRecorderRef.current
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop()
    }

    setIsRecording(false)
    setIsPaused(false)

    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const startTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
    }
    startTimeRef.current = Date.now()
    timerRef.current = setInterval(() => {
      const totalElapsedMs = elapsedBeforePauseRef.current + (Date.now() - startTimeRef.current)
      const elapsed = Math.floor(totalElapsedMs / 1000)
      setDuration(elapsed)

      // Auto-stop at max duration
      if (elapsed >= maxDurationSeconds) {
        stopRecording()
      }
    }, 100)
  }, [maxDurationSeconds, stopRecording])

  // Start recording
  const startRecording = useCallback(async () => {
    try {
      setError(null)
      setPermissionDenied(false)
      
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100
        }
      })
      
      streamRef.current = stream
      chunksRef.current = []
      
      // Create MediaRecorder with best available format
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4'
      
      const mediaRecorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = mediaRecorder
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }
      
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType })
        setAudioBlob(blob)
        
        // Create URL for playback
        if (audioUrl) {
          URL.revokeObjectURL(audioUrl)
        }
        setAudioUrl(URL.createObjectURL(blob))
        
        // Stop all tracks
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop())
        }
      }
      
      // Start recording
      mediaRecorder.start(100) // Collect data every 100ms
      setIsRecording(true)
      setIsPaused(false)
      setDuration(0)
      elapsedBeforePauseRef.current = 0
      startTimer()
      
    } catch (err) {
      console.error('Recording error:', err)
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setPermissionDenied(true)
        setError('Microphone access denied. Please allow microphone access to record voice notes.')
      } else {
        setError(`Recording failed: ${err.message}`)
      }
    }
  }, [audioUrl, startTimer])

  // Pause recording
  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording && !isPaused) {
      mediaRecorderRef.current.pause()
      if (startTimeRef.current) {
        elapsedBeforePauseRef.current += Date.now() - startTimeRef.current
        startTimeRef.current = null
      }
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      setIsPaused(true)
    }
  }, [isRecording, isPaused])

  // Resume recording
  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording && isPaused) {
      mediaRecorderRef.current.resume()
      setIsPaused(false)
      startTimer()
    }
  }, [isRecording, isPaused, startTimer])

  // Clear recording
  const clearRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.onstop = null
      mediaRecorderRef.current.stop()
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl)
    }
    setIsRecording(false)
    setIsPaused(false)
    setAudioBlob(null)
    setAudioUrl(null)
    setDuration(0)
    setError(null)
    chunksRef.current = []
    elapsedBeforePauseRef.current = 0
    startTimeRef.current = null
  }, [audioUrl])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.onstop = null
        mediaRecorderRef.current.stop()
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
        streamRef.current = null
      }
    }
  }, [])

  // Convert blob to Base64
  const getBase64 = useCallback(async () => {
    if (!audioBlob) return null
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        // Remove the data URL prefix to get just the base64 string
        const base64 = reader.result.split(',')[1]
        resolve(base64)
      }
      reader.onerror = reject
      reader.readAsDataURL(audioBlob)
    })
  }, [audioBlob])

  // Format duration as MM:SS
  const formatDuration = useCallback((seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }, [])

  return {
    // State
    isRecording,
    isPaused,
    duration,
    formattedDuration: formatDuration(duration),
    audioBlob,
    audioUrl,
    error,
    permissionDenied,
    hasRecording: !!audioBlob,
    
    // Actions
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    clearRecording,
    getBase64,
    formatDuration
  }
}

export default useAudioRecorder
