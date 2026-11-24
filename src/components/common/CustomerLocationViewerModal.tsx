import React, { useEffect, useState } from 'react';
import { APIProvider, Map as GoogleMap, AdvancedMarker, Pin } from '@vis.gl/react-google-maps';
import { Copy, Check, ExternalLink, MapPin, X, AlertTriangle } from 'lucide-react';
import { fetchMapsClientConfigApi } from '../../services/api';
import { parseLatLngCoords } from '../../services/native';
import { isZeroZeroLocation } from '../../utils/storefront';

const SOLUTION_ATTRIBUTION_ID = 'gmp_mcp_codeassist_v1_aistudio';

interface CustomerLocationViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerName: string;
  shopName?: string;
  address?: string;
  city?: string;
  area?: string;
  governorate?: string;
  geoCoordinates?: string;
  latitude?: number;
  longitude?: number;
}

export const CustomerLocationViewerModal: React.FC<CustomerLocationViewerModalProps> = ({
  isOpen,
  onClose,
  customerName,
  shopName,
  address,
  city,
  area,
  governorate,
  geoCoordinates,
  latitude,
  longitude,
}) => {
  const [mapsKey, setMapsKey] = useState<string>(() =>
    String((import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY || '').trim()
  );
  const [mapId, setMapId] = useState<string>('DEMO_MAP_ID');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen || mapsKey) return;
    fetchMapsClientConfigApi()
      .then((res) => {
        if (res?.apiKey) setMapsKey(res.apiKey);
        if (res?.mapId) setMapId(res.mapId);
      })
      .catch(() => {});
  }, [isOpen, mapsKey]);

  if (!isOpen) return null;

  const parsed = parseLatLngCoords(geoCoordinates || '');
  const lat = latitude !== undefined && !isZeroZeroLocation(latitude, longitude) ? latitude : parsed?.lat;
  const lng = longitude !== undefined && !isZeroZeroLocation(latitude, longitude) ? longitude : parsed?.lng;
  const hasValidCoords = lat !== undefined && lng !== undefined && !isZeroZeroLocation(lat, lng);
  const coordText = hasValidCoords ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : '';
  const navUrl = hasValidCoords ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(coordText)}` : '';

  const handleCopy = async () => {
    if (!coordText) return;
    try {
      await navigator.clipboard.writeText(coordText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-3">
      <div className="bg-white dark:bg-slate-900 w-full sm:max-w-xl rounded-t-xl sm:rounded-xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-3.5 py-2.5 bg-[#0F5A33] text-white flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 shrink-0" />
            <div>
              <h3 className="text-xs sm:text-sm font-black">{shopName || customerName}</h3>
              <p className="text-[11px] text-emerald-100">عرض الموقع المسجل للعميل (للقراءة فقط)</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25 cursor-pointer"
            aria-label="إغلاق"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 space-y-2.5 overflow-y-auto">
          {!hasValidCoords ? (
            <div className="p-3.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-center space-y-1.5">
              <AlertTriangle className="w-6 h-6 text-amber-600 mx-auto" />
              <p className="text-xs font-black text-amber-900 dark:text-amber-100">
                لا توجد إحداثيات جغرافية صالحة مسجلة لهذا العميل حتى الآن.
              </p>
              {address && <p className="text-xs text-slate-600 dark:text-slate-300">{address}</p>}
            </div>
          ) : (
            <>
              {mapsKey && typeof navigator !== 'undefined' && navigator.onLine !== false ? (
                <APIProvider apiKey={mapsKey} language="ar" region="EG">
                  <div className="w-full h-56 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
                    <GoogleMap
                      mapId={mapId}
                      defaultCenter={{ lat, lng }}
                      center={{ lat, lng }}
                      defaultZoom={16}
                      gestureHandling="greedy"
                      streetViewControl={false}
                      internalUsageAttributionIds={[SOLUTION_ATTRIBUTION_ID]}
                    >
                      <AdvancedMarker position={{ lat, lng }}>
                        <Pin background="#0F5A33" borderColor="#FFFFFF" glyphColor="#FFFFFF" />
                      </AdvancedMarker>
                    </GoogleMap>
                  </div>
                </APIProvider>
              ) : (
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200">
                  الإحداثيات المحفوظة: <span className="awlad-tabular" dir="ltr">{coordText}</span>
                </div>
              )}

              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 space-y-1 text-xs">
                {(governorate || city || area) && (
                  <p className="font-bold text-slate-700 dark:text-slate-200">
                    النطاق: {[governorate, city || area].filter(Boolean).join(' - ')}
                  </p>
                )}
                {address && <p className="text-slate-600 dark:text-slate-300 font-medium">{address}</p>}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-200 dark:border-slate-700">
                  <span className="font-bold text-slate-500 awlad-tabular" dir="ltr">
                    {coordText}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied ? 'تم النسخ' : 'نسخ الإحداثيات'}</span>
                    </button>
                    {navUrl && (
                      <a
                        href={navUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1 rounded-lg bg-[#0F5A33] text-white text-[11px] font-bold flex items-center gap-1"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>التوجيه على الخريطة</span>
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
