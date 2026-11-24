import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Download, Share2, Loader2 } from 'lucide-react';
import { isNativeCapacitor, saveAndShareDocument } from '../../services/native';

interface QrCodeDisplayProps {
  value: string;
  title?: string;
  subtitle?: string;
  filename?: string;
  size?: number;
}

export const QrCodeDisplay: React.FC<QrCodeDisplayProps> = ({
  value,
  title,
  subtitle,
  filename = 'awlad-selim-pairing-qr.png',
  size = 240,
}) => {
  const [dataUrl, setDataUrl] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    if (!value) {
      setDataUrl('');
      return;
    }
    QRCode.toDataURL(value, {
      width: size,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((url) => {
        if (active) {
          setDataUrl(url);
          setError(null);
        }
      })
      .catch(() => {
        if (active) setError('تعذر توليد صورة رمز QR');
      });
    return () => {
      active = false;
    };
  }, [value, size]);

  const handleDownloadOrShare = async () => {
    if (!dataUrl) return;
    setSaving(true);
    try {
      const base64 = dataUrl.split(',')[1] || '';
      await saveAndShareDocument({
        filename,
        content: base64,
        mimeType: 'image/png',
        title: title || 'رمز QR لربط الجهاز — AWLAD SELIM',
        isBase64: true,
      });
    } finally {
      setSaving(false);
    }
  };

  if (!value) return null;

  return (
    <div className="flex flex-col items-center gap-2 p-3 rounded-lg bg-white border border-slate-200 shadow-xs text-center">
      {title && <div className="text-xs font-black text-slate-900">{title}</div>}
      {error ? (
        <div className="text-xs text-red-600 font-bold py-4">{error}</div>
      ) : dataUrl ? (
        <div className="p-1.5 rounded-lg bg-white border border-slate-200">
          <img
            src={dataUrl}
            alt={title || 'QR Code'}
            className="w-44 h-44 sm:w-48 sm:h-48 object-contain"
          />
        </div>
      ) : (
        <div className="w-44 h-44 flex items-center justify-center bg-slate-50 rounded-lg border border-slate-200">
          <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
        </div>
      )}
      {subtitle && (
        <p className="text-[11px] text-slate-500 max-w-xs leading-relaxed">{subtitle}</p>
      )}
      {dataUrl && (
        <button
          type="button"
          onClick={handleDownloadOrShare}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          {isNativeCapacitor() ? <Share2 className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
          <span>{saving ? 'جاري التجهيز...' : isNativeCapacitor() ? 'مشاركة / حفظ صورة QR' : 'تنزيل صورة QR (PNG)'}</span>
        </button>
      )}
    </div>
  );
};
