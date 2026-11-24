import { Router } from 'express';
import {
  getPublishedStorefront,
  getAdminStorefront,
  saveStorefrontDraft,
  publishStorefront,
  getCustomerFavorites,
  setCustomerFavorites,
  toggleCustomerFavorite,
} from '../db/stores/storefrontStore.js';
import { requireAuth, requireStaff, requirePermission, asyncHandler } from '../middleware/auth.js';
import { AppError } from '../utils/errors.js';

const router = Router();

router.use(requireAuth);

router.get(
  '/published',
  asyncHandler(async (_req, res) => {
    const storefront = await getPublishedStorefront();
    res.json({ ok: true, storefront });
  })
);

router.get(
  '/admin',
  requireStaff,
  requirePermission('canManageSettings'),
  asyncHandler(async (_req, res) => {
    const data = await getAdminStorefront();
    res.json({ ok: true, ...data });
  })
);

router.put(
  '/draft',
  requireStaff,
  requirePermission('canManageSettings'),
  asyncHandler(async (req, res) => {
    const result = await saveStorefrontDraft(req.body || {}, req.auth.user);
    res.json({ ok: true, ...result });
  })
);

router.post(
  '/publish',
  requireStaff,
  requirePermission('canManageSettings'),
  asyncHandler(async (req, res) => {
    const result = await publishStorefront(req.body || {}, req.auth.user);
    res.json({ ok: true, ...result });
  })
);

router.get(
  '/favorites',
  asyncHandler(async (req, res) => {
    if (req.auth.user.role !== 'customer' || !req.auth.customerProfile) {
      return res.json({ ok: true, favoriteProductIds: [] });
    }
    const favoriteProductIds = await getCustomerFavorites(req.auth.customerProfile.id);
    res.json({ ok: true, favoriteProductIds });
  })
);

router.put(
  '/favorites',
  asyncHandler(async (req, res) => {
    if (req.auth.user.role !== 'customer') {
      throw new AppError(403, 'قائمة المفضلة مخصصة لحسابات العملاء فقط', 'CUSTOMER_ONLY');
    }
    if (!req.auth.customerProfile) {
      throw new AppError(404, 'حسابك غير مربوط بملف عميل', 'CUSTOMER_PROFILE_REQUIRED');
    }
    const favoriteProductIds = await setCustomerFavorites(
      req.auth.customerProfile.id,
      req.body?.favoriteProductIds || req.body?.productIds || []
    );
    res.json({ ok: true, favoriteProductIds });
  })
);

router.post(
  '/favorites/toggle',
  asyncHandler(async (req, res) => {
    if (req.auth.user.role !== 'customer') {
      throw new AppError(403, 'قائمة المفضلة مخصصة لحسابات العملاء فقط', 'CUSTOMER_ONLY');
    }
    if (!req.auth.customerProfile) {
      throw new AppError(404, 'حسابك غير مربوط بملف عميل', 'CUSTOMER_PROFILE_REQUIRED');
    }
    const result = await toggleCustomerFavorite(req.auth.customerProfile.id, req.body?.productId);
    res.json({ ok: true, ...result });
  })
);

export default router;
