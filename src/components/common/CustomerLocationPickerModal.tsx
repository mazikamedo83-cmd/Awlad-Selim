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
import { usePreferences } from '../../context/PreferencesContext';

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
  const { t, language } = usePreferences();
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
          language,
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
  }, [query, placesLib, language]);

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
          <Search className="w-4 h-4 text-slate-400 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" />
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
            placeholder={t('ابحث عن الشارع أو المنطقة أو اسم المعلم...', 'Search street, area, or landmark...')}
            className="w-full ps-8 pe-2.5 py-1.5 h-8 rounded-md border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#10203D] text-xs font-bold text-slate-900 dark:text-[#EEF4FC] dark:placeholder-[#7F96BA] outline-none focus:border-[#003589] dark:focus:border-[#3B82F6]"
          />
        </div>
        <button
          type="button"
          disabled={searching || query.trim().length < 2}
          onClick={() => {
            setOpenList(false);
            onSearchFallback(query);
          }}
          className="px-3 py-1.5 h-8 rounded-md bg-[#003589] hover:bg-[#0049B0] dark:bg-[#1659C8] dark:hover:bg-[#1F6BE6] text-white text-xs font-bold disabled:opacity-50 cursor-pointer shrink-0"
        >
          {searching ? t('بحث...', 'Searching...') : t('بحث', 'Search')}
        </button>
      </div>
      {openList && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-white dark:bg-[#0E1C36] border border-slate-200 dark:border-[#21375C] rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {suggestions.map((s, idx) => {
            const label = s?.placePrediction?.text?.text || s?.placePrediction?.structuredFormat?.mainText?.text || t('مكان', 'Place');
            return (
              <button
                key={idx}
                type="button"
                onClick={() => handleChooseSuggestion(s)}
                className="w-full text-start px-3 py-2 text-xs font-bold text-slate-700 dark:text-[#DCE6F5] hover:bg-[#EEF3FA] dark:hover:bg-[#1A3461] border-b last:border-b-0 border-slate-100 dark:border-[#1B2F52] cursor-pointer"
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
  title,
}) => {
  const { t, language, dir } = usePreferences();
  const resolvedTitle = title ?? t('تحديد موقع المحل على الخريطة', 'Pin Shop Location on Map');
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
      setErrorMsg(t('إحداثيات (0, 0) غير صالحة؛ يرجى اختيار موقع حقيقي على الخريطة.', 'Coordinates (0, 0) are invalid; please select a real map location.'));
      return;
    }
    setPinPos({ lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) });
    setErrorMsg('');
    setStatusMsg(t('جاري قراءة العنوان من الإحداثيات...', 'Reading address from coordinates...'));
    const rev = await reverseGeocodeCoords(lat, lng, getConfiguredApiBaseUrl());
    if (rev.ok) {
      if (rev.address) setAddress(rev.address);
      if (rev.area) setArea(rev.area);
      if (rev.city) setCity(rev.city);
      if (rev.governorate) setGovernorate(rev.governorate);
      setStatusMsg(t('تم تحديث العنوان تلقائياً من الخريطة.', 'Address automatically updated from map.'));
    } else {
      setStatusMsg(t('تم تثبيت الإحداثيات بنجاح — يمكنك مراجعة العنوان يدوياً أدناه.', 'Coordinates pinned — you can review the address manually below.'));
    }
  };

  const runGpsCapture = async () => {
    setShowGpsRationale(false);
    setLocatingGps(true);
    setErrorMsg('');
    setStatusMsg(t('جاري تحديد موقعك الحالي عبر GPS...', 'Detecting your current location via GPS...'));
    try {
      const gps = await getCurrentLocationSafe();
      if (!gps.ok || !gps.coords) {
        setErrorMsg(gps.error || t('تعذر الحصول على الموقع الحالي من GPS.', 'Could not get current GPS location.'));
        setStatusMsg('');
        return;
      }
      const parsed = parseLatLngCoords(gps.coords);
      if (!parsed || isZeroZeroLocation(parsed.lat, parsed.lng)) {
        setErrorMsg(t('تعذر التقاط إحداثيات صالحة من GPS.', 'Failed to capture valid GPS coordinates.'));
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
        setStatusMsg(t('تم تحديد الموقع من البحث؛ يمكنك سحب الدبوس لضبطه بدقة.', 'Location found from search; drag the pin to adjust accurately.'));
      }
    } catch (err: any) {
      setErrorMsg(err?.message || t('تعذر العثور على هذا العنوان؛ اضغط على الخريطة أو استخدم GPS.', 'Could not find this address; tap on the map or use GPS.'));
    } finally {
      setSearchingAddr(false);
    }
  };

  const handleSave = () => {
    if (!pinPos || isZeroZeroLocation(pinPos.lat, pinPos.lng)) {
      setErrorMsg(t('يرجى تحديد موقع حقيقي على الخريطة أو عبر GPS قبل الحفظ (لا يمكن حفظ 0,0).', 'Please select a valid location on the map or via GPS before saving.'));
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
    <div className="fixed inset-0 z-[80] bg-black/60 dark:bg-[#040B17]/75 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-3">
      <div dir={dir} className="bg-white dark:bg-[#0E1C36] w-full sm:max-w-2xl rounded-t-lg sm:rounded-lg border border-slate-200 dark:border-[#21375C] overflow-hidden flex flex-col max-h-[92vh]">
        <div className="px-2.5 py-2 awlad-brand-gradient text-white flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <MapPin className="w-4 h-4 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-xs font-black truncate">{resolvedTitle}</h3>
              <p className="text-[10.5px] text-[#DCE6F5] truncate">{t('اضغط على الخريطة أو اسحب العلامة لتحديد موقع المحل بدقة', 'Tap the map or drag the pin to accurately set the shop location')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded-md bg-white/15 hover:bg-white/25 cursor-pointer shrink-0"
            aria-label={t('إغلاق', 'Close')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="p-2.5 space-y-2 overflow-y-auto flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={locatingGps}
              onClick={() => setShowGpsRationale(true)}
              className="h-8 px-2.5 rounded-md bg-[#EEF3FA] dark:bg-[#132544] border border-[#DCE6F5] dark:border-[#2A436E] text-[#011E58] dark:text-[#85B8FF] text-xs font-black flex items-center gap-1.5 hover:bg-[#DCE6F5] dark:hover:bg-[#1A3461] cursor-pointer"
            >
              <LocateFixed className={`w-3.5 h-3.5 ${locatingGps ? 'animate-spin' : ''}`} />
              <span>{locatingGps ? t('جاري التحديد...', 'Locating...') : t('تحديد موقعي الحالي (GPS)', 'Use Current Location (GPS)')}</span>
            </button>
            {pinPos && (
              <span className="h-8 inline-flex items-center text-[11px] font-bold text-slate-600 dark:text-[#A9BCD9] bg-slate-100 dark:bg-[#132544] border border-transparent dark:border-[#21375C] px-2 rounded-md awlad-tabular" dir="ltr">
                {pinPos.lat.toFixed(6)}, {pinPos.lng.toFixed(6)}
              </span>
            )}
          </div>

          {showGpsRationale && (
            <div className="p-2 rounded-md bg-amber-50 dark:bg-amber-500/15 border border-amber-200 dark:border-amber-400/30 text-xs text-amber-900 dark:text-amber-200 flex flex-wrap items-center justify-between gap-1.5">
              <span className="font-bold">{t('سيطلب التطبيق الوصول لموقع الجهاز (GPS) لتحديد إحداثيات المحل وتسهيل التوصيل.', 'The app will request device location (GPS) to pin shop coordinates for delivery.')}</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowGpsRationale(false)}
                  className="h-7 px-2 rounded-md bg-white dark:bg-[#132544] border border-amber-300 dark:border-[#2A436E] text-slate-700 dark:text-[#DCE6F5] text-[11px] font-bold cursor-pointer"
                >
                  {t('إلغاء', 'Cancel')}
                </button>
                <button
                  type="button"
                  onClick={runGpsCapture}
                  className="h-7 px-2 rounded-md bg-[#003589] hover:bg-[#0049B0] dark:bg-[#1659C8] dark:hover:bg-[#1F6BE6] text-white text-[11px] font-bold cursor-pointer"
                >
                  {t('موافق، حدّد موقعي', 'Allow & Locate Me')}
                </button>
              </div>
            </div>
          )}

          {canRenderGoogleMap ? (
            <APIProvider apiKey={mapsKey} language={language} region="EG">
              <div className="space-y-1.5">
                <PlacesAutocompleteBox
                  searching={searchingAddr}
                  onSearchFallback={handleServerGeocodeSearch}
                  onSelectPlace={(loc) => {
                    setPinPos({ lat: Number(loc.lat.toFixed(6)), lng: Number(loc.lng.toFixed(6)) });
                    if (loc.address) setAddress(loc.address);
                    if (loc.area) setArea(loc.area);
                    if (loc.city) setCity(loc.city);
                    if (loc.governorate) setGovernorate(loc.governorate);
                    setStatusMsg(t('تم اختيار الموقع من البحث؛ يمكنك سحب الدبوس للتعديل.', 'Location selected from search; drag the pin to adjust.'));
                  }}
                />
                <div className="w-full h-56 sm:h-64 rounded-lg overflow-hidden border border-slate-200 dark:border-[#21375C] bg-slate-100 dark:bg-[#132544]">
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
                        <Pin background="#011E58" borderColor="#FFFFFF" glyphColor="#FFFFFF" />
                      </AdvancedMarker>
                    )}
                  </GoogleMap>
                </div>
              </div>
            </APIProvider>
          ) : (
            <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C] text-xs space-y-1.5">
              <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300 font-black">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  {!mapsKey
                    ? t('عرض الخريطة التفاعلية غير مفعّل (مفتاح الخرائط غير مضبوط) — يمكنك استخدام زر GPS أعلاه أو إدخال العنوان يدوياً.', 'Interactive map display is disabled (Maps key not configured) — you can use the GPS button above or enter address manually.')
                    : t('الاتصال بالإنترنت غير متاح لعرض الخريطة — يمكنك التقاط موقع GPS أو كتابة العنوان يدوياً.', 'No internet connection to display map — you can capture GPS location or type the address manually.')}
                </span>
              </div>
              <div className="flex gap-1.5">
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
                  placeholder={t('ابحث بالعنوان أو اكتب تفاصيل الموقع...', 'Search by address or enter location details...')}
                  className="flex-1 h-8 px-2 rounded-md border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#10203D] text-xs font-bold text-slate-900 dark:text-[#EEF4FC]"
                />
                <button
                  type="button"
                  disabled={searchingAddr}
                  onClick={() => handleServerGeocodeSearch(address)}
                  className="h-8 px-2.5 rounded-md bg-[#003589] hover:bg-[#0049B0] dark:bg-[#1659C8] dark:hover:bg-[#1F6BE6] text-white text-xs font-bold cursor-pointer"
                >
                  {t('بحث', 'Search')}
                </button>
              </div>
            </div>
          )}

          {statusMsg && (
            <p className="text-[11px] font-bold text-[#011E58] dark:text-[#85B8FF] bg-[#EEF3FA] dark:bg-[#132544] px-2 py-1 rounded-md border border-[#DCE6F5] dark:border-[#2A436E]">
              {statusMsg}
            </p>
          )}
          {errorMsg && (
            <p className="text-[11px] font-bold text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/15 px-2 py-1 rounded-md border border-red-200 dark:border-red-400/30">
              {errorMsg}
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-0.5">
            <div>
              <label className="block text-[11px] font-black text-slate-600 dark:text-[#A9BCD9] mb-0.5">{t('المحافظة', 'Governorate')}</label>
              <input
                type="text"
                value={governorate}
                onChange={(e) => setGovernorate(e.target.value)}
                className="w-full h-8 px-2 rounded-md border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#10203D] text-xs font-bold text-slate-900 dark:text-[#EEF4FC]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-black text-slate-600 dark:text-[#A9BCD9] mb-0.5">{t('المدينة / المنطقة', 'City / Area')}</label>
              <input
                type="text"
                value={city || area}
                onChange={(e) => {
                  setCity(e.target.value);
                  if (!area) setArea(e.target.value);
                }}
                className="w-full h-8 px-2 rounded-md border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#10203D] text-xs font-bold text-slate-900 dark:text-[#EEF4FC]"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-black text-slate-600 dark:text-[#A9BCD9] mb-0.5">{t('العنوان التفصيلي', 'Detailed Address')}</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full h-8 px-2 rounded-md border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#10203D] text-xs font-bold text-slate-900 dark:text-[#EEF4FC]"
              />
            </div>
          </div>
        </div>

        <div className="px-2.5 py-2 border-t border-slate-200 dark:border-[#21375C] bg-slate-50 dark:bg-[#132544] flex items-center justify-end gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-3 rounded-md border border-slate-300 dark:border-[#2A436E] dark:bg-[#0E1C36] text-xs font-bold text-slate-700 dark:text-[#DCE6F5] cursor-pointer"
          >
            {t('إلغاء', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="h-8 px-3 rounded-md bg-[#003589] hover:bg-[#0049B0] dark:bg-[#1659C8] dark:hover:bg-[#1F6BE6] text-white text-xs font-black flex items-center gap-1.5 cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            <span>{t('تأكيد حفظ الموقع', 'Confirm & Save Location')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
