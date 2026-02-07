import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { getSyncQueueCount, getSyncQueue, removeSyncQueueItem } from '../utils/offlineStorage';
import api from '../api';

const OfflineIndicator = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial check for pending items
    updatePendingCount();

    // Check periodically if online
    const interval = setInterval(() => {
        updatePendingCount();
    }, 5000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, []);

  // Listen for custom event from api.js when queue is updated
  useEffect(() => {
    const handleQueueUpdate = () => updatePendingCount();
    window.addEventListener('sync-queue-updated', handleQueueUpdate);
    return () => window.removeEventListener('sync-queue-updated', handleQueueUpdate);
  }, []);

  const updatePendingCount = async () => {
    try {
      const count = await getSyncQueueCount();
      setPendingCount(count);
    } catch (e) {
      console.error('Error checking sync queue:', e);
    }
  };

  const syncData = async () => {
    if (isSyncing || pendingCount === 0 || !isOnline) return;

    setIsSyncing(true);
    try {
      const queue = await getSyncQueue();
      
      for (const item of queue) {
        try {
            // Re-execute request
            // We use a special flag to bypass the offline interceptor queueing logic
            await api.request({
                method: item.method,
                url: item.url,
                data: item.data,
                params: item.params,
                headers: item.headers,
                _isSyncRequest: true 
            });
            
            // Remove from queue on success
            await removeSyncQueueItem(item.id);
        } catch (error) {
            console.error('Failed to sync item:', item, error);
            // Keep in queue or move to a "failed" queue? 
            // For now, we leave it in queue to retry later or let user retry manual sync
        }
      }
      
      await updatePendingCount();
      // Optional: Notify user of success
    } catch (error) {
      console.error('Sync failed:', error);
    } finally {
      setIsSyncing(false);
    }
  };

  if (isOnline && pendingCount === 0) return null;

  return (
    <div className="offline-indicator" style={{
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      zIndex: 9999,
      backgroundColor: isOnline ? 'rgba(16, 185, 129, 0.9)' : 'rgba(239, 68, 68, 0.9)',
      color: 'white',
      padding: '10px 16px',
      borderRadius: '8px',
      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      backdropFilter: 'blur(4px)',
      transition: 'all 0.3s ease'
    }}>
      {isOnline ? (
        <>
            <Wifi size={18} />
            <span>Online</span>
            {pendingCount > 0 && (
                <button 
                    onClick={syncData} 
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
                    {isSyncing ? 'Syncing...' : `Sync (${pendingCount})`}
                </button>
            )}
        </>
      ) : (
        <>
            <WifiOff size={18} />
            <span>Offline</span>
            {pendingCount > 0 && (
                <span style={{ 
                    background: 'rgba(0,0,0,0.2)', 
                    padding: '2px 6px', 
                    borderRadius: '4px', 
                    fontSize: '0.8em' 
                }}>
                    {pendingCount} pending
                </span>
            )}
        </>
      )}
      <style>{`
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
};

export default OfflineIndicator;
