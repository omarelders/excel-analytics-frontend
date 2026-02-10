import './Loading.css'

export default function Loading() {
  return (
    <div className="loading-container">
      <div className="loading-content">
        <div className="loading-logo">
          <span className="logo-text">Gold</span>
          <span className="logo-text-accent">Road</span>
        </div>
        <div className="loading-spinner">
          <div className="spinner-dot"></div>
          <div className="spinner-dot"></div>
          <div className="spinner-dot"></div>
        </div>
      </div>
    </div>
  )
}
