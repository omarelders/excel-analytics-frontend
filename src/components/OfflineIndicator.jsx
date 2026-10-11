import React, { useEffect, useSyncExternalStore } from 'react';
import { AlertTriangle, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import {
  attachSyncEngine,
  describeQueuedRequest,
  flushSyncQueue,
  getSyncState,
  retryFailedSyncQueue,
  subscribeSyncState,
  syncFailureNotice,
} from '../utils/syncQueue';

const OfflineIndicator = () => {
  const { online, pending, failures, isSyncing } = useSyncExternalStore(
    subscribeSyncState,
    getSyncState,
    // The same store on the server and in the browser, so hydration agrees.
    getSyncState
  );

  // The engine owns the listeners, the queue counts and the auto-sync on reconnect;
  // this component renders the state it publishes.
  useEffect(() => attachSyncEngine(), []);

  if (online && pending === 0 && failures.length === 0) return null;

  return (
    <div className="offline-indicator" style={{
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      zIndex: 9999,
      backgroundColor: online ? 'rgba(16, 185, 129, 0.9)' : 'rgba(239, 68, 68, 0.9)',
      color: 'white',
      padding: '10px 16px',
      borderRadius: '8px',
      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: '10px',
      backdropFilter: 'blur(4px)',
      transition: 'all 0.3s ease'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {online ? <Wifi size={18} /> : <WifiOff size={18} />}
        <span>{online ? 'Online' : 'Offline'}</span>
        {!online && pending > 0 && (
          <span style={{ 
            background: 'rgba(0,0,0,0.2)', 
            padding: '2px 6px', 
            borderRadius: '4px', 
            fontSize: '0.8em' 
          }}>
            {pending} pending
          </span>
        )}
        {online && pending > 0 && (
          <button
            onClick={() => flushSyncQueue()}
            disabled={isSyncing}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              color: 'white',
              padding: '4px 8px',
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              marginLeft: '8px'
            }}
          >
            <RefreshCw size={14} className={isSyncing ? 'spin' : ''} />
            {isSyncing ? 'Syncing...' : `Sync (${pending})`}
          </button>
        )}
      </div>
      {failures.length > 0 && (
        <div style={{ 
          display: 'flex', 
          alignItems: 'flex-start', 
          gap: '8px', 
          background: 'rgba(0,0,0,0.25)', 
          padding: '8px 10px', 
          borderRadius: '6px',
          maxWidth: '320px' 
        }}>
          <AlertTriangle size={16} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '0.85em', lineHeight: 1.4 }}>{syncFailureNotice(failures)}</span>
            <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '0.8em', opacity: 0.9 }}>
              {failures.map((entry) => (
                <li key={entry.id}>{describeQueuedRequest(entry)}</li>
              ))}
            </ul>
            <button
              onClick={() => retryFailedSyncQueue()}
              disabled={isSyncing}
              style={{
                background: 'rgba(255,255,255,0.2)',
                border: 'none',
                color: 'white',
                padding: '4px 8px',
                borderRadius: '4px',
                cursor: 'pointer',
                alignSelf: 'flex-start'
              }}
            >
              {isSyncing ? 'Retrying...' : 'Retry now'}
            </button>
          </div>
        </div>
      )}
      <style>{`
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
};

export default OfflineIndicator;
