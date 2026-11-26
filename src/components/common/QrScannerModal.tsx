import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, Upload, Link2, X, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { requestCameraStreamForQr } from '../../services/native';
import { usePreferences } from '../../context/PreferencesContext';

interface QrScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDetected: (rawText: string) => void;
  mode?: 'qr' | 'barcode';
}

export const QrScannerModal: React.FC<QrScannerModalProps> = ({
  isOpen,
  onClose,
  onDetected,
  mode = 'qr',
}) => {
  const { t, dir } = usePreferences();
  const [tab, setTab] = useState<'camera' | 'paste'>('camera');
  const [manualInput, setManualInput] = useState('');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraRetryKey, setCameraRetryKey] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const detectedOnceRef = useRef(false);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  const stopCamera = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          // ignore
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.pause();
      } catch {
        // ignore
      }
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setTab('camera');
      setManualInput('');
      setCameraError(null);
      setFileError(null);
      detectedOnceRef.current = false;
      return;
    }
    detectedOnceRef.current = false;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || tab !== 'camera') {
      stopCamera();
      return;
    }

    let cancelled = false;

    const startScanner = async () => {
      setCameraError(null);
      try {
        const camRes = await requestCameraStreamForQr();
        if (!camRes.ok) {
          if (!cancelled) {
            setCameraError(camRes.error);
          }
          return;
        }
        const stream = camRes.stream;
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setCameraActive(true);

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => {});

        const BarcodeDet = (window as any).BarcodeDetector
          ? new (window as any).BarcodeDetector({
              formats:
                mode === 'barcode'
                  ? ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code']
                  : ['qr_code'],
            })
          : null;

        const scanFrame = async () => {
          if (cancelled || detectedOnceRef.current) return;
          const vid = videoRef.current;
          const canvas = canvasRef.current;
          if (!vid || !canvas || vid.readyState < 2 || vid.videoWidth === 0) {
            rafRef.current = requestAnimationFrame(scanFrame);
            return;
          }

          try {
            if (BarcodeDet) {
              const codes = await BarcodeDet.detect(vid);
              if (Array.isArray(codes) && codes[0]?.rawValue) {
                detectedOnceRef.current = true;
                stopCamera();
                onDetectedRef.current(String(codes[0].rawValue));
                return;
              }
            }
          } catch {
            // fallback cleanly to jsQR canvas decode below
          }

          canvas.width = vid.videoWidth;
          canvas.height = vid.videoHeight;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const decoded = jsQR(imgData.data, imgData.width, imgData.height, {
              inversionAttempts: 'dontInvert',
            });
            if (decoded?.data) {
              detectedOnceRef.current = true;
              stopCamera();
              onDetectedRef.current(decoded.data);
              return;
            }
          }

          rafRef.current = requestAnimationFrame(scanFrame);
        };

        rafRef.current = requestAnimationFrame(scanFrame);
      } catch {
        if (!cancelled) {
          setCameraError(
            t(
              'تعذر تشغيل الكاميرا على هذا الجهاز. يمكنك رفع صورة رمز QR أو لصق رابط الدعوة.',
              'Unable to start camera on this device. You can upload a QR image or paste the pairing link.'
            )
          );
        }
      }
    };

    startScanner();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [isOpen, tab, cameraRetryKey]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    const inputEl = e.target;
    const file = inputEl.files?.[0];
    inputEl.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setFileError(t('تعذر معالجة الصورة', 'Could not process image'));
          return;
        }
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(imgData.data, imgData.width, imgData.height);
        if (decoded?.data) {
          stopCamera();
          onDetected(decoded.data);
        } else {
          setFileError(t('لم يتم العثور على رمز QR واضح داخل الصورة المختارة.', 'No clear QR code found inside the selected image.'));
        }
      };
      img.onerror = () => setFileError(t('ملف الصورة غير صالح', 'Invalid image file'));
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = manualInput.trim();
    if (!trimmed) return;
    stopCamera();
    onDetected(trimmed);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-slate-950/75 backdrop-blur-xs p-0 sm:p-2.5">
      <div dir={dir} className="w-full max-w-md bg-white dark:bg-[#0E1C36] rounded-t-lg sm:rounded-lg border border-slate-200 dark:border-[#21375C] overflow-hidden text-start pb-safe">
        <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-slate-100 dark:border-[#21375C]">
          <div className="flex items-center gap-1.5">
            <Camera className="w-4 h-4 text-[#003589] dark:text-[#60A5FA] shrink-0" />
            <div>
              <h3 className="text-xs font-black text-slate-900 dark:text-[#F3F7FC]">
                {mode === 'barcode'
                  ? t('مسح باركود الصنف أو إدخال الكود', 'Scan Product Barcode or Enter Code')
                  : t('مسح رمز QR أو إدخال رابط الربط', 'Scan QR Code or Enter Pairing Link')}
              </h3>
              <p className="text-[10px] text-slate-500 dark:text-[#A9BCD9]">
                {mode === 'barcode'
                  ? t('وجّه الكاميرا نحو باركود المنتج للبحث الفوري', 'Point the camera at the product barcode to search instantly')
                  : t('وجّه الكاميرا نحو رمز QR الظاهر على شاشة الإدارة', 'Point the camera at the QR code shown on the admin screen')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            aria-label={t('إغلاق', 'Close')}
            className="h-7 w-7 flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-[#1A3461] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-2.5 space-y-2">
          <div className="grid grid-cols-2 gap-1 p-0.5 rounded-md bg-slate-100 dark:bg-[#132544] text-xs font-bold">
            <button
              type="button"
              onClick={() => setTab('camera')}
              className={`h-8 rounded-md flex items-center justify-center gap-1 cursor-pointer ${
                tab === 'camera' ? 'bg-white dark:bg-[#0E1C36] text-slate-900 dark:text-[#F3F7FC] border border-slate-200 dark:border-[#2A436E] font-black' : 'text-slate-600 dark:text-[#A9BCD9]'
              }`}
            >
              <Camera className="w-3.5 h-3.5" />
              <span>{t('مسح بالكاميرا / صورة', 'Scan Camera / Image')}</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('paste')}
              className={`h-8 rounded-md flex items-center justify-center gap-1 cursor-pointer ${
                tab === 'paste' ? 'bg-white dark:bg-[#0E1C36] text-slate-900 dark:text-[#F3F7FC] border border-slate-200 dark:border-[#2A436E] font-black' : 'text-slate-600 dark:text-[#A9BCD9]'
              }`}
            >
              <Link2 className="w-3.5 h-3.5" />
              <span>{mode === 'barcode' ? t('إدخال رقم الباركود', 'Enter Barcode') : t('لصق رابط الدعوة', 'Paste Pairing Link')}</span>
            </button>
          </div>

          {tab === 'camera' ? (
            <div className="space-y-1.5">
              <div className="relative rounded-md overflow-hidden bg-slate-900 aspect-square max-h-56 w-full flex items-center justify-center border border-slate-800">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className={`w-full h-full object-cover ${cameraActive ? 'opacity-100' : 'opacity-20'}`}
                />
                <canvas ref={canvasRef} className="hidden" />
                {cameraActive && (
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div className="w-40 h-40 border-2 border-[#0053BE] rounded-lg shadow-[0_0_0_9999px_rgba(15,23,42,0.45)]" />
                  </div>
                )}
                {cameraError && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-2.5 text-center text-white bg-slate-900/95 space-y-2">
                    <AlertCircle className="w-6 h-6 text-amber-400" />
                    <p className="text-xs leading-relaxed text-slate-200">{cameraError}</p>
                    <div className="flex flex-wrap items-center justify-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setCameraRetryKey((k) => k + 1)}
                        className="h-8 px-2.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>{t('إعادة المحاولة', 'Retry')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          stopCamera();
                          setTab('paste');
                        }}
                        className="h-8 px-2.5 rounded-md bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <Link2 className="w-3.5 h-3.5" />
                        <span>{t('لصق الرابط بدلاً من الكاميرا', 'Paste Link Instead')}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <label className="w-full h-8 px-2.5 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-[#132544] dark:hover:bg-[#1A3461] text-slate-800 dark:text-[#DCE6F5] text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer border border-slate-200 dark:border-[#21375C]">
                <Upload className="w-3.5 h-3.5 text-slate-700 dark:text-[#A9BCD9]" />
                <span>{t('أو اختيار صورة QR محفوظة من الجهاز', 'Or choose saved QR image from device')}</span>
                <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
              </label>

              {fileError && (
                <div className="p-2 rounded-md bg-red-50 border border-red-200 text-red-700 text-xs font-bold flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{fileError}</span>
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={handleManualSubmit} className="space-y-2">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-[#CBD9EE] mb-0.5">
                  {mode === 'barcode'
                    ? t('اكتب رقم الباركود أو كود الصنف:', 'Enter barcode or item code:')
                    : t('الصق رابط الدعوة المرسل من الإدارة (WhatsApp أو رابط مباشر):', 'Paste the pairing link sent by administration:')}
                </label>
                <textarea
                  rows={mode === 'barcode' ? 2 : 3}
                  dir="ltr"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  className="w-full rounded-md border border-slate-300 dark:border-[#2A436E] p-2 text-xs font-mono text-left focus:border-[#003589] outline-hidden"
                />
              </div>
              <button
                type="submit"
                disabled={!manualInput.trim()}
                className="w-full h-8 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{mode === 'barcode' ? t('بحث بالباركود', 'Search by Barcode') : t('تطبيق الربط تلقائياً', 'Apply Pairing Automatically')}</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
