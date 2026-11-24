import React, { useEffect, useRef, useState } from 'react';
import {
  APIProvider,
  Map as GoogleMap,
  AdvancedMarker,
  Pin,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { Check, LocateFixed, MapPin, Search, X, AlertTriangle } from 'lucide-react';
import { fetchMapsClientConfigApi, geocodeAddressViaServerApi, getConfiguredApiBaseUrl } from '../../services/api';
import { getCurrentLocationSafe, parseLatLngCoords, reverseGeocodeCoords } from '../../services/native';
import { isZeroZeroLocation } from '../../utils/storefront';

const DEFAULT_EGYPT_CENTER = { lat: 30.0444, lng: 31.2357 };
const SOLUTION_ATTRIBUTION_ID = 'gmp_mcp_codeassist_v1_aistudio';

export interface PickedCustomerLocation {
  latitude: number;
  longitude: number;
  geoCoordinates: string;
  address: string;
  area?: string;
  city?: string;
  governorate?: string;
  locationCapturedAt: string;
}

interface CustomerLocationPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (location: PickedCustomerLocation) => void;
  initialLat?: number;
  initialLng?: number;
  initialGeoCoordinates?: string;
  initialAddress?: string;
  initialCity?: string;
  initialArea?: string;
  initialGovernorate?: string;
  title?: string;
}

const PlacesAutocompleteBox: React.FC<{
  onSelectPlace: (loc: { lat: number; lng: number; address: string; area?: string; city?: string; governorate?: string }) => void;
  onSearchFallback: (query: string) => Promise<void>;
  searching: boolean;
}> = ({ onSelectPlace, onSearchFallback, searching }) => {
  const placesLib = useMapsLibrary('places');
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [openList, setOpenList] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const clean = query.trim();
    if (clean.length < 2) {
      setSuggestions([]);
      return;
    }
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(async () => {
      try {
        const AutocompleteSuggestion = (placesLib as any)?.AutocompleteSuggestion;
        if (!AutocompleteSuggestion?.fetchAutocompleteSuggestions) {
          setSuggestions([]);
          return;
        }
        const res = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: clean,
          language: 'ar',
          region: 'eg',
        });
        setSuggestions(Array.isArray(res?.suggestions) ? res.suggestions.slice(0, 5) : []);
        setOpenList(true);
      } catch {
        setSuggestions([]);
      }
    }, 300);

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [query, placesLib]);

  const handleChooseSuggestion = async (item: any) => {
    try {
      const prediction = item?.placePrediction;
      const place = prediction?.toPlace?.();
      if (!place) return;
      await place.fetchFields({ fields: ['location', 'formattedAddress', 'addressComponents', 'displayName'] });
      const loc = place.location;
      const lat = typeof loc?.lat === 'function' ? loc.lat() : Number(loc?.lat);
      const lng = typeof loc?.lng === 'function' ? loc.lng() : Number(loc?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || isZeroZeroLocation(lat, lng)) return;
      const comps = Array.isArray(place.addressComponents) ? place.addressComponents : [];
      let area = '';
      let city = '';
      let governorate = '';
      for (const c of comps) {
        const types = Array.isArray(c.types) ? c.types : [];
        const txt = String(c.longText || c.shortText || '').trim();
        if (!txt) continue;
        if (!area && (types.includes('sublocality') || types.includes('neighborhood'))) area = txt;
        if (!city && (types.includes('locality') || types.includes('administrative_area_level_2'))) city = txt;
        if (!governorate && types.includes('administrative_area_level_1')) governorate = txt;
      }
      const addr = String(place.formattedAddress || prediction?.text?.text || query).trim();
      setQuery(addr);
      setOpenList(false);
      onSelectPlace({ lat, lng, address: addr, area: area || undefined, city: city || undefined, governorate: governorate || undefined });
    } catch {
      await onSearchFallback(query);
      setOpenList(false);
    }
  };

  return (
    <div className="relative">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                setOpenList(false);
                onSearchFallback(query);
              }
            }}
            placeholder="ابحث عن الشارع أو المنطقة أو اسم المعلم..."
            className="w-full pr-9 pl-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-xs font-bold text-slate-900 dark:text-slate-100 outline-none focus:border-emerald-700"
          />
        </div>
        <button
          type="button"
          disabled={searching || query.trim().length < 2}
          onClick={() => {
            setOpenList(false);
            onSearchFallback(query);
          }}
          className="px-3.5 py-2 rounded-xl bg-[#0F5A33] hover:bg-[#0B4426] text-white text-xs font-bold disabled:opacity-50 cursor-pointer shrink-0"
        >
          {searching ? 'بحث...' : 'بحث'}
        </button>
      </div>
      {openList && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg max-h-48 overflow-y-auto">
          {suggestions.map((s, idx) => {
            const label = s?.placePrediction?.text?.text || s?.placePrediction?.structuredFormat?.mainText?.text || 'مكان';
            return (
              <button
                key={idx}
                type="button"
                onClick={() => handleChooseSuggestion(s)}
                className="w-full text-right px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-emerald-50 dark:hover:bg-slate-700 border-b last:border-b-0 border-slate-100 dark:border-slate-700 cursor-pointer"
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const CustomerLocationPickerModal: React.FC<CustomerLocationPickerModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  initialLat,
  initialLng,
  initialGeoCoordinates,
  initialAddress = '',
  initialCity = '',
  initialArea = '',
  initialGovernorate = '',
  title = 'تحديد موقع المحل على الخريطة',
}) => {
  const [mapsKey, setMapsKey] = useState<string>(() =>
    String((import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY || '').trim()
  );
  const [mapId, setMapId] = useState<string>('DEMO_MAP_ID');
  const [configLoaded, setConfigLoaded] = useState(false);

  const parsedInitial = parseLatLngCoords(initialGeoCoordinates || '');
  const validInitialLat =
    initialLat !== undefined && !isZeroZeroLocation(initialLat, initialLng)
      ? initialLat
      : parsedInitial?.lat;
  const validInitialLng =
    initialLng !== undefined && !isZeroZeroLocation(initialLat, initialLng)
      ? initialLng
      : parsedInitial?.lng;

  const [pinPos, setPinPos] = useState<{ lat: number; lng: number } | null>(
    validInitialLat !== undefined && validInitialLng !== undefined
      ? { lat: validInitialLat, lng: validInitialLng }
      : null
  );
  const [address, setAddress] = useState(initialAddress);
  const [city, setCity] = useState(initialCity);
  const [area, setArea] = useState(initialArea);
  const [governorate, setGovernorate] = useState(initialGovernorate);
  const [locatingGps, setLocatingGps] = useState(false);
  const [searchingAddr, setSearchingAddr] = useState(false);
  const [showGpsRationale, setShowGpsRationale] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    if (!isOpen) return;
    const pInit = parseLatLngCoords(initialGeoCoordinates || '');
    const initLat =
      initialLat !== undefined && !isZeroZeroLocation(initialLat, initialLng)
        ? initialLat
        : pInit?.lat;
    const initLng =
      initialLng !== undefined && !isZeroZeroLocation(initialLat, initialLng)
        ? initialLng
        : pInit?.lng;
    setPinPos(initLat !== undefined && initLng !== undefined ? { lat: initLat, lng: initLng } : null);
    setAddress(initialAddress || '');
    setCity(initialCity || '');
    setArea(initialArea || '');
    setGovernorate(initialGovernorate || '');
    setErrorMsg('');
    setStatusMsg('');
  }, [isOpen, initialLat, initialLng, initialGeoCoordinates, initialAddress, initialCity, initialArea, initialGovernorate]);

  useEffect(() => {
    if (!isOpen || configLoaded) return;
    fetchMapsClientConfigApi()
      .then((res) => {
        if (res?.apiKey && !mapsKey) {
          setMapsKey(res.apiKey);
        }
        if (res?.mapId) setMapId(res.mapId);
      })
      .catch(() => {})
      .finally(() => setConfigLoaded(true));
  }, [isOpen, configLoaded, mapsKey]);

  if (!isOpen) return null;

  const applyReverseGeocode = async (lat: number, lng: number) => {
    if (isZeroZeroLocation(lat, lng)) {
      setErrorMsg('إحداثيات (0, 0) غير صالحة؛ يرجى اختيار موقع حقيقي على الخريطة.');
      return;
    }
    setPinPos({ lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) });
    setErrorMsg('');
    setStatusMsg('جاري قراءة العنوان من الإحداثيات...');
    const rev = await reverseGeocodeCoords(lat, lng, getConfiguredApiBaseUrl());
    if (rev.ok) {
      if (rev.address) setAddress(rev.address);
      if (rev.area) setArea(rev.area);
      if (rev.city) setCity(rev.city);
      if (rev.governorate) setGovernorate(rev.governorate);
      setStatusMsg('تم تحديث العنوان تلقائياً من الخريطة.');
    } else {
      setStatusMsg('تم تثبيت الإحداثيات بنجاح — يمكنك مراجعة العنوان يدوياً أدناه.');
    }
  };

  const runGpsCapture = async () => {
    setShowGpsRationale(false);
    setLocatingGps(true);
    setErrorMsg('');
    setStatusMsg('جاري تحديد موقعك الحالي عبر GPS...');
    try {
      const gps = await getCurrentLocationSafe();
      if (!gps.ok || !gps.coords) {
        setErrorMsg(gps.error || 'تعذر الحصول على الموقع الحالي من GPS.');
        setStatusMsg('');
        return;
      }
      const parsed = parseLatLngCoords(gps.coords);
      if (!parsed || isZeroZeroLocation(parsed.lat, parsed.lng)) {
        setErrorMsg('تعذر التقاط إحداثيات صالحة من GPS.');
        setStatusMsg('');
        return;
      }
      await applyReverseGeocode(parsed.lat, parsed.lng);
    } finally {
      setLocatingGps(false);
    }
  };

  const handleServerGeocodeSearch = async (query: string) => {
    const clean = query.trim();
    if (clean.length < 2) return;
    setSearchingAddr(true);
    setErrorMsg('');
    try {
      const res = await geocodeAddressViaServerApi(clean);
      if (res?.ok && !isZeroZeroLocation(res.latitude, res.longitude)) {
        setPinPos({ lat: res.latitude, lng: res.longitude });
        if (res.formattedAddress) setAddress(res.formattedAddress);
        if (res.area) setArea(res.area);
        if (res.city) setCity(res.city);
        if (res.governorate) setGovernorate(res.governorate);
        setStatusMsg('تم تحديد الموقع من البحث؛ يمكنك سحب الدبوس لضبطه بدقة.');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر العثور على هذا العنوان؛ اضغط على الخريطة أو استخدم GPS.');
    } finally {
      setSearchingAddr(false);
    }
  };

  const handleSave = () => {
    if (!pinPos || isZeroZeroLocation(pinPos.lat, pinPos.lng)) {
      setErrorMsg('يرجى تحديد موقع حقيقي على الخريطة أو عبر GPS قبل الحفظ (لا يمكن حفظ 0,0).');
      return;
    }
    onConfirm({
      latitude: Number(pinPos.lat.toFixed(6)),
      longitude: Number(pinPos.lng.toFixed(6)),
      geoCoordinates: `${pinPos.lat.toFixed(6)}, ${pinPos.lng.toFixed(6)}`,
      address: address.trim(),
      area: area.trim() || undefined,
      city: city.trim() || undefined,
      governorate: governorate.trim() || undefined,
      locationCapturedAt: new Date().toISOString(),
    });
    onClose();
  };

  const mapCenter = pinPos || DEFAULT_EGYPT_CENTER;
  const canRenderGoogleMap = Boolean(mapsKey) && typeof navigator !== 'undefined' && navigator.onLine !== false;

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-3">
      <div className="bg-white dark:bg-slate-900 w-full sm:max-w-2xl rounded-t-xl sm:rounded-xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        <div className="px-3.5 py-2.5 bg-[#0F5A33] text-white flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 shrink-0" />
            <div>
              <h3 className="text-xs sm:text-sm font-black">{title}</h3>
              <p className="text-[11px] text-emerald-100">اضغط على الخريطة أو اسحب العلامة لتحديد موقع المحل بدقة</p>
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

        <div className="p-3 space-y-2.5 overflow-y-auto flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={locatingGps}
              onClick={() => setShowGpsRationale(true)}
              className="px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs font-black flex items-center gap-1.5 hover:bg-emerald-100 cursor-pointer"
            >
              <LocateFixed className={`w-3.5 h-3.5 ${locatingGps ? 'animate-spin' : ''}`} />
              <span>{locatingGps ? 'جاري التحديد...' : 'تحديد موقعي الحالي (GPS)'}</span>
            </button>
            {pinPos && (
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-md awlad-tabular" dir="ltr">
                {pinPos.lat.toFixed(6)}, {pinPos.lng.toFixed(6)}
              </span>
            )}
          </div>

          {showGpsRationale && (
            <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-100 flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold">سيطلب التطبيق الوصول لموقع الجهاز (GPS) لتحديد إحداثيات المحل وتسهيل التوصيل.</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowGpsRationale(false)}
                  className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-amber-300 text-slate-700 dark:text-slate-200 font-bold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={runGpsCapture}
                  className="px-2.5 py-1 rounded-lg bg-[#0F5A33] text-white font-bold cursor-pointer"
                >
                  موافق، حدّد موقعي
                </button>
              </div>
            </div>
          )}

          {canRenderGoogleMap ? (
            <APIProvider apiKey={mapsKey} language="ar" region="EG">
              <div className="space-y-2">
                <PlacesAutocompleteBox
                  searching={searchingAddr}
                  onSearchFallback={handleServerGeocodeSearch}
                  onSelectPlace={(loc) => {
                    setPinPos({ lat: Number(loc.lat.toFixed(6)), lng: Number(loc.lng.toFixed(6)) });
                    if (loc.address) setAddress(loc.address);
                    if (loc.area) setArea(loc.area);
                    if (loc.city) setCity(loc.city);
                    if (loc.governorate) setGovernorate(loc.governorate);
                    setStatusMsg('تم اختيار الموقع من البحث؛ يمكنك سحب الدبوس للتعديل.');
                  }}
                />
                <div className="w-full h-56 sm:h-64 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
                  <GoogleMap
                    mapId={mapId}
                    defaultCenter={mapCenter}
                    center={mapCenter}
                    defaultZoom={pinPos ? 16 : 11}
                    gestureHandling="greedy"
                    disableDefaultUI={false}
                    streetViewControl={false}
                    internalUsageAttributionIds={[SOLUTION_ATTRIBUTION_ID]}
                    onClick={(ev) => {
                      const latLng = ev?.detail?.latLng;
                      if (!latLng) return;
                      applyReverseGeocode(latLng.lat, latLng.lng);
                    }}
                  >
                    {pinPos && (
                      <AdvancedMarker
                        position={pinPos}
                        draggable={true}
                        onDragEnd={(ev) => {
                          const pos = ev?.latLng;
                          if (!pos) return;
                          const lat = typeof pos.lat === 'function' ? pos.lat() : Number(pos.lat);
                          const lng = typeof pos.lng === 'function' ? pos.lng() : Number(pos.lng);
                          if (Number.isFinite(lat) && Number.isFinite(lng)) {
                            applyReverseGeocode(lat, lng);
                          }
                        }}
                      >
                        <Pin background="#0F5A33" borderColor="#FFFFFF" glyphColor="#FFFFFF" />
                      </AdvancedMarker>
                    )}
                  </GoogleMap>
                </div>
              </div>
            </APIProvider>
          ) : (
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs space-y-2">
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300 font-black">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  {!mapsKey
                    ? 'عرض الخريطة التفاعلية غير مفعّل (مفتاح الخرائط غير مضبوط) — يمكنك استخدام زر GPS أعلاه أو إدخال العنوان يدوياً.'
                    : 'الاتصال بالإنترنت غير متاح لعرض الخريطة — يمكنك التقاط موقع GPS أو كتابة العنوان يدوياً.'}
                </span>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleServerGeocodeSearch(address);
                    }
                  }}
                  placeholder="ابحث بالعنوان أو اكتب تفاصيل الموقع..."
                  className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs font-bold"
                />
                <button
                  type="button"
                  disabled={searchingAddr}
                  onClick={() => handleServerGeocodeSearch(address)}
                  className="px-3 py-1.5 rounded-lg bg-[#0F5A33] text-white text-xs font-bold cursor-pointer"
                >
                  بحث
                </button>
              </div>
            </div>
          )}

          {statusMsg && (
            <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800">
              {statusMsg}
            </p>
          )}
          {errorMsg && (
            <p className="text-[11px] font-bold text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 px-2.5 py-1.5 rounded-lg border border-red-200 dark:border-red-800">
              {errorMsg}
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-0.5">
            <div>
              <label className="block text-[11px] font-black text-slate-600 dark:text-slate-300 mb-0.5">المحافظة</label>
              <input
                type="text"
                value={governorate}
                onChange={(e) => setGovernorate(e.target.value)}
                placeholder="مثال: القاهرة / الجيزة"
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-xs font-bold"
              />
            </div>
            <div>
              <label className="block text-[11px] font-black text-slate-600 dark:text-slate-300 mb-0.5">المدينة / المنطقة</label>
              <input
                type="text"
                value={city || area}
                onChange={(e) => {
                  setCity(e.target.value);
                  if (!area) setArea(e.target.value);
                }}
                placeholder="المدينة أو الحي"
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-xs font-bold"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-black text-slate-600 dark:text-slate-300 mb-0.5">العنوان التفصيلي</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="اسم الشارع، رقم المحل، أقرب علامة مميزة..."
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-xs font-bold"
              />
            </div>
          </div>
        </div>

        <div className="px-3.5 py-2.5 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-1.5 rounded-lg bg-[#0F5A33] hover:bg-[#0B4426] text-white text-xs font-black flex items-center gap-1.5 cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            <span>تأكيد حفظ الموقع</span>
          </button>
        </div>
      </div>
    </div>
  );
};
