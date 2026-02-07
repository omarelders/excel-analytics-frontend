import React from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';

const Offline = () => {
  return (
    <div className="offline-container" style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      padding: '2rem',
      textAlign: 'center',
      color: 'var(--text-primary)'
    }}>
      <WifiOff size={64} style={{ marginBottom: '1.5rem', opacity: 0.7 }} />
      <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>You are offline</h1>
      <p style={{ marginBottom: '2rem', maxWidth: '400px', opacity: 0.8 }}>
        It seems you've lost your internet connection. Some features may be unavailable until you're back online.
      </p>
      <button 
        onClick={() => window.location.reload()}
        className="btn-primary"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.75rem 1.5rem',
          borderRadius: '0.5rem',
          border: 'none',
          cursor: 'pointer',
          background: 'var(--primary)',
          color: 'white',
          fontSize: '1rem'
        }}
      >
        <RefreshCw size={18} />
        Try Again
      </button>
    </div>
  );
};

export default Offline;
