import api from '../api';

const VAPID_PUBLIC_KEY_URL = '/notifications/vapid-key';
const SUBSCRIBE_URL = '/notifications/subscribe';
const UNSUBSCRIBE_URL = '/notifications/unsubscribe';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function getVapidKey() {
  const response = await api.get(VAPID_PUBLIC_KEY_URL);
  return response.data.publicKey;
}

export async function checkSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return false;
  }
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return !!subscription;
}

export async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Push notifications are not supported');
  }

  const registration = await navigator.serviceWorker.ready;
  
  // Get public key from backend
  const publicKey = await getVapidKey();
  const convertedVapidKey = urlBase64ToUint8Array(publicKey);

  // Subscribe
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: convertedVapidKey
  });

  // Send to backend
  await api.post(SUBSCRIBE_URL, subscription);
  return true;
}

export async function unsubscribeFromPush() {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  
  if (subscription) {
    // Unsubscribe from backend first (best effort)
    try {
        await api.post(UNSUBSCRIBE_URL, subscription);
    } catch (e) {
        console.warn('Failed to unsubscribe from backend', e);
    }
    
    // Unsubscribe from browser
    await subscription.unsubscribe();
  }
  return true;
}
