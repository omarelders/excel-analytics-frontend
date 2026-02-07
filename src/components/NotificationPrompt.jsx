import React, { useState, useEffect } from 'react';
import { Bell, BellOff, Info } from 'lucide-react';
import { checkSubscription, subscribeToPush, unsubscribeFromPush } from '../utils/pushNotifications';

const NotificationPrompt = () => {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showIosInstructions, setShowIosInstructions] = useState(false);

  useEffect(() => {
    checkSubscription().then(setIsSubscribed);
    
    // Check if iOS
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    // Check if standalone (installed)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    
    if (isIOS && !isStandalone) {
        setShowIosInstructions(true);
    }
  }, []);

  const handleToggle = async () => {
    setLoading(true);
    setError('');
    try {
      if (isSubscribed) {
        await unsubscribeFromPush();
        setIsSubscribed(false);
      } else {
        await subscribeToPush();
        setIsSubscribed(true);
      }
    } catch (err) {
      console.error(err);
      setError('Failed to update subscription. Ensure you have dismissed any browser permission blocks.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="notification-prompt" style={{
      padding: '1.5rem',
      backgroundColor: 'var(--bg-secondary)',
      borderRadius: '1rem',
      marginTop: '1rem',
      color: 'var(--text-primary)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {isSubscribed ? <Bell size={24} color="var(--success)" /> : <BellOff size={24} color="var(--text-secondary)" />}
          <div>
            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Push Notifications</h3>
            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              {isSubscribed ? 'You are receiving notifications.' : 'Enable to get updates on shipments.'}
            </p>
          </div>
        </div>
        
        <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '50px', height: '28px' }}>
          <input 
            type="checkbox" 
            checked={isSubscribed} 
            onChange={handleToggle} 
            disabled={loading}
            style={{ opacity: 0, width: 0, height: 0 }}
          />
          <span className="slider round" style={{
            position: 'absolute', cursor: 'pointer',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: isSubscribed ? 'var(--primary)' : '#ccc',
            transition: '0.4s',
            borderRadius: '34px'
          }}>
            <span style={{
              position: 'absolute',
              content: '""',
              height: '20px', width: '20px',
              left: isSubscribed ? '26px' : '4px',
              bottom: '4px',
              backgroundColor: 'white',
              transition: '0.4s',
              borderRadius: '50%'
            }}/>
          </span>
        </label>
      </div>

      {error && <p style={{ color: 'var(--danger)', fontSize: '0.9rem' }}>{error}</p>}
      
      {showIosInstructions && (
        <div style={{
            marginTop: '1rem',
            padding: '1rem',
            backgroundColor: 'rgba(255, 193, 7, 0.1)',
            border: '1px solid rgba(255, 193, 7, 0.3)',
            borderRadius: '0.5rem',
            fontSize: '0.9rem'
        }}>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <Info size={18} color="var(--warning)" />
                <strong>iOS Requirement</strong>
            </div>
            <p style={{ margin: 0 }}>
                To enable notifications on iPhone/iPad, you must first add this app to your Home Screen.
                Tap the Share icon <span style={{fontSize: '1.2rem'}}>⎋</span> then "Add to Home Screen".
            </p>
        </div>
      )}
    </div>
  );
};

export default NotificationPrompt;
