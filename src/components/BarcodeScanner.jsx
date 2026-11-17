import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { X, Camera, Zap, ZapOff } from 'lucide-react';
import './BarcodeScanner.css';

const BarcodeScanner = ({ onScan, onClose }) => {
  const scannerRef = useRef(null);
  const [flashOn, setFlashOn] = useState(false);
  const [cameraError, setCameraError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    let html5QrCode;

    const startScanner = async () => {
      try {
        const formatsToSupport = [
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
        ];

        html5QrCode = new Html5Qrcode("reader");
        scannerRef.current = html5QrCode;

        const config = {
          fps: 10,
          qrbox: { width: 280, height: 280 },
          aspectRatio: 1.0,
          formatsToSupport: formatsToSupport
        };

        await html5QrCode.start(
          { facingMode: "environment" },
          config,
          (decodedText) => {
            // Success callback
            if (html5QrCode.isScanning) {
                html5QrCode.stop().then(() => {
                    onScan(decodedText);
                }).catch(err => {
                    console.error("Failed to stop scanner", err);
                    onScan(decodedText); // Proceed anyway
                });
            }
          },
          () => {
            // Error callback (called frequently, ignore)
          }
        );

        if (!isMounted) {
          html5QrCode.stop().catch(() => {});
          return;
        }

      } catch (err) {
        console.error("Error starting scanner scan:", err);
        if (isMounted) {
          setCameraError("Could not access camera. Please ensure you have granted permission.");
        }
      }
    };

    startScanner();

    return () => {
      isMounted = false;
      if (scannerRef.current && scannerRef.current.isScanning) {
        scannerRef.current.stop().catch(console.error);
      }
    };
  }, [onScan]);

  const toggleFlash = async () => {
    if (!scannerRef.current) return;
    try {
       await scannerRef.current.applyVideoConstraints({
         advanced: [{ torch: !flashOn }]
       });
       setFlashOn(!flashOn);
    } catch (err) {
       console.error("Flash toggle failed", err);
    }
  };

  return (
    <div className="scanner-overlay">
      <div className="scanner-container">
        <div className="scanner-header">
          <h3>Scan Barcode</h3>
          <button className="close-btn" onClick={onClose}>
            <X size={24} />
          </button>
        </div>
        
        <div id="reader" className="scanner-view"></div>
        
        {cameraError && (
            <div className="camera-error">
                <p>{cameraError}</p>
            </div>
        )}
        
        <div className="scanner-controls">
           <button onClick={toggleFlash} className="control-btn" title="Toggle Flash">
             {flashOn ? <Zap size={24} fill="currentColor" /> : <ZapOff size={24} />}
           </button>
           <div className="scanner-instruction">
             Point at a tracking number
           </div>
        </div>
      </div>
    </div>
  );
};

export default BarcodeScanner;
