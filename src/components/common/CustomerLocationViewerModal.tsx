import React, { useEffect, useState } from 'react';
import { APIProvider, Map as GoogleMap, AdvancedMarker, Pin } from '@vis.gl/react-google-maps';
import { Copy, Check, ExternalLink, MapPin, X, AlertTriangle } from 'lucide-react';
import { fetchMapsClientConfigApi } from '../../services/api';
import { parseLatLngCoords } from '../../services/native';
import { isZeroZeroLocation } from '../../utils/storefront';
import { usePreferences } from '../../context/PreferencesContext';

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
  const { t, language, dir } = usePreferences();
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
    <div className="fixed inset-0 z-[80] bg-black/60 dark:bg-[#040B17]/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-2.5">
      <div dir={dir} className="bg-white dark:bg-[#0E1C36] w-full sm:max-w-xl rounded-t-lg sm:rounded-lg border border-slate-200 dark:border-[#21375C] overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-2.5 py-2 awlad-brand-gradient text-white flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <MapPin className="w-4 h-4 shrink-0" />
            <div>
              <h3 className="text-xs sm:text-sm font-black">{shopName || customerName}</h3>
              <p className="text-[11px] text-[#DCE6F5]">{t('عرض الموقع المسجل للعميل (للقراءة فقط)', 'Registered customer location view (read-only)')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded-md bg-white/15 hover:bg-white/25 cursor-pointer"
            aria-label={t('إغلاق', 'Close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-2.5 space-y-2 overflow-y-auto">
          {!hasValidCoords ? (
            <div className="p-2.5 rounded-md bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-400/30 text-center space-y-1">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-300 mx-auto" />
              <p className="text-xs font-black text-amber-900 dark:text-amber-200">
                {t('لا توجد إحداثيات جغرافية صالحة مسجلة لهذا العميل حتى الآن.', 'No valid geographic coordinates are recorded for this customer yet.')}
              </p>
              {address && <p className="text-xs text-slate-600 dark:text-[#A9BCD9]">{address}</p>}
            </div>
          ) : (
            <>
              {mapsKey && typeof navigator !== 'undefined' && navigator.onLine !== false ? (
                <APIProvider apiKey={mapsKey} language={language} region="EG">
                  <div className="w-full h-56 rounded-md overflow-hidden border border-slate-200 dark:border-[#21375C]">
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
                        <Pin background="#011E58" borderColor="#FFFFFF" glyphColor="#FFFFFF" />
                      </AdvancedMarker>
                    </GoogleMap>
                  </div>
                </APIProvider>
              ) : (
                <div className="p-2.5 rounded-md bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C] text-xs font-bold text-slate-700 dark:text-[#DCE6F5]">
                  {t('الإحداثيات المحفوظة:', 'Saved Coordinates:')}{' '}
                  <span className="awlad-tabular" dir="ltr">{coordText}</span>
                </div>
              )}

              <div className="p-2 rounded-md bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C] space-y-1 text-xs">
                {(governorate || city || area) && (
                  <p className="font-bold text-slate-700 dark:text-[#DCE6F5]">
                    {t('النطاق:', 'Area:')} {[governorate, city || area].filter(Boolean).join(' - ')}
                  </p>
                )}
                {address && <p className="text-slate-600 dark:text-[#A9BCD9] font-medium">{address}</p>}
                <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1.5 border-t border-slate-200 dark:border-[#21375C]">
                  <span className="font-bold text-slate-500 dark:text-[#97AECE] awlad-tabular" dir="ltr">
                    {coordText}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="h-7 px-2 rounded-md bg-white dark:bg-[#0E1C36] border border-slate-300 dark:border-[#2A436E] text-[11px] font-bold text-slate-700 dark:text-[#DCE6F5] flex items-center gap-1 cursor-pointer"
                    >
                      {copied ? <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copied ? t('تم النسخ', 'Copied') : t('نسخ الإحداثيات', 'Copy Coordinates')}</span>
                    </button>
                    {navUrl && (
                      <a
                        href={navUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="h-7 px-2 rounded-md bg-[#003589] hover:bg-[#0049B0] dark:bg-[#1659C8] dark:hover:bg-[#1F6BE6] text-white text-[11px] font-bold flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>{t('التوجيه على الخريطة', 'Directions on Map')}</span>
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
