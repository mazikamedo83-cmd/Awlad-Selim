import { Router } from 'express';
import { asyncHandler } from '../middleware/auth.js';
import { AppError } from '../utils/errors.js';

const router = Router();
const SOLUTION_ATTRIBUTION_ID = 'gmp_mcp_codeassist_v1_aistudio';

function resolveServerMapsApiKey() {
  return String(
    process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || ''
  ).trim();
}

function resolveBrowserMapsApiKey() {
  return String(
    process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || ''
  ).trim();
}

function isZeroZero(lat, lng) {
  return Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001;
}

function extractAddressParts(resultItem) {
  if (!resultItem || typeof resultItem !== 'object') {
    return { formattedAddress: '', area: '', city: '', governorate: '' };
  }
  const formattedAddress = String(resultItem.formattedAddress || '').trim();
  const comps = Array.isArray(resultItem.addressComponents) ? resultItem.addressComponents : [];
  let area = '';
  let city = '';
  let governorate = '';

  for (const c of comps) {
    const types = Array.isArray(c.types) ? c.types : [];
    const text = String(c.longText || c.shortText || '').trim();
    if (!text) continue;
    if (!area && (types.includes('sublocality') || types.includes('sublocality_level_1') || types.includes('neighborhood'))) {
      area = text;
    }
    if (!city && (types.includes('locality') || types.includes('administrative_area_level_2'))) {
      city = text;
    }
    if (!governorate && types.includes('administrative_area_level_1')) {
      governorate = text;
    }
  }

  return { formattedAddress, area, city, governorate };
}

router.get(
  '/config',
  asyncHandler(async (_req, res) => {
    const browserKey = resolveBrowserMapsApiKey();
    res.json({
      ok: true,
      configured: Boolean(browserKey),
      apiKey: browserKey,
      mapId: 'DEMO_MAP_ID',
      attributionId: SOLUTION_ATTRIBUTION_ID,
    });
  })
);

router.get(
  '/geocode',
  asyncHandler(async (req, res) => {
    const address = String(req.query.address || '').trim();
    if (!address || address.length < 2) {
      throw new AppError(400, 'يرجى إدخال عنوان أو اسم منطقة للبحث', 'INVALID_GEOCODE_ADDRESS');
    }

    const apiKey = resolveServerMapsApiKey();
    if (!apiKey) {
      return res.status(503).json({
        ok: false,
        code: 'MAPS_NOT_CONFIGURED',
        error: 'مفتاح خرائط جوجل غير مهيأ على الخادم بعد.',
      });
    }

    const url = `https://geocode.googleapis.com/v4/geocode/address/${encodeURIComponent(address)}?languageCode=ar&regionCode=EG`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-Maps-Solution-ID': SOLUTION_ATTRIBUTION_ID,
      },
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const errStatus = String(data?.error?.status || '');
      const isQuota = response.status === 429 || errStatus === 'RESOURCE_EXHAUSTED';
      return res.status(isQuota ? 429 : response.status || 502).json({
        ok: false,
        code: isQuota ? 'MAPS_QUOTA_EXCEEDED' : 'MAPS_GEOCODE_FAILED',
        quotaExceeded: isQuota,
        error: isQuota
          ? 'تم تجاوز حصة خدمة الخرائط المجانية (Demo Quota).'
          : data?.error?.message || 'تعذر تحديد إحداثيات العنوان من خدمة الخرائط.',
      });
    }

    const first = Array.isArray(data?.results) ? data.results[0] : null;
    const lat = Number(first?.location?.latitude);
    const lng = Number(first?.location?.longitude);
    if (!first || !Number.isFinite(lat) || !Number.isFinite(lng) || isZeroZero(lat, lng)) {
      return res.status(404).json({
        ok: false,
        code: 'LOCATION_NOT_FOUND',
        error: 'لم يتم العثور على موقع مطابق لهذا العنوان.',
      });
    }

    const parts = extractAddressParts(first);
    res.json({
      ok: true,
      latitude: Number(lat.toFixed(6)),
      longitude: Number(lng.toFixed(6)),
      coords: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
      ...parts,
    });
  })
);

router.get(
  '/reverse-geocode',
  asyncHandler(async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180 ||
      isZeroZero(lat, lng)
    ) {
      throw new AppError(
        400,
        'إحداثيات الموقع غير صالحة أو تساوي (0, 0). يرجى اختيار موقع حقيقي.',
        'ZERO_ZERO_COORDINATES'
      );
    }

    const apiKey = resolveServerMapsApiKey();
    if (!apiKey) {
      return res.status(503).json({
        ok: false,
        code: 'MAPS_NOT_CONFIGURED',
        error: 'مفتاح خرائط جوجل غير مهيأ على الخادم بعد.',
      });
    }

    const url = `https://geocode.googleapis.com/v4/geocode/location/${encodeURIComponent(`${lat},${lng}`)}?languageCode=ar&regionCode=EG`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-Maps-Solution-ID': SOLUTION_ATTRIBUTION_ID,
      },
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const errStatus = String(data?.error?.status || '');
      const isQuota = response.status === 429 || errStatus === 'RESOURCE_EXHAUSTED';
      return res.status(isQuota ? 429 : response.status || 502).json({
        ok: false,
        code: isQuota ? 'MAPS_QUOTA_EXCEEDED' : 'MAPS_REVERSE_GEOCODE_FAILED',
        quotaExceeded: isQuota,
        error: isQuota
          ? 'تم تجاوز حصة خدمة الخرائط المجانية (Demo Quota).'
          : data?.error?.message || 'تعذر قراءة العنوان من خدمة الخرائط.',
      });
    }

    const first = Array.isArray(data?.results) ? data.results[0] : null;
    if (!first) {
      return res.status(404).json({
        ok: false,
        code: 'ADDRESS_NOT_FOUND',
        error: 'لم يتم العثور على عنوان لهذا الموقع.',
      });
    }

    const parts = extractAddressParts(first);
    res.json({
      ok: true,
      latitude: Number(lat.toFixed(6)),
      longitude: Number(lng.toFixed(6)),
      coords: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
      address: parts.formattedAddress,
      ...parts,
    });
  })
);

export default router;
