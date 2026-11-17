import { Router } from 'express';
import {
  listProducts,
  listCategories,
  createProduct,
  updateProduct,
  deleteProduct,
  createCategory,
  updateCategory,
  deleteCategory,
  getSystemSettingsSafe,
  deleteImportedProductsBatch,
} from '../db/stores/catalogStore.js';
import {
  requireAuth,
  requireStaff,
  requirePermission,
  asyncHandler,
} from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const isCustomer = req.auth.user.role === 'customer';
    const settings = await getSystemSettingsSafe();
    const allowCustomerPriceView = Boolean(settings.mobileConfig?.allowCustomerPriceView);
    if (isCustomer && settings.mobileConfig?.enableCustomerApp === false) {
      return res.status(403).json({
        ok: false,
        code: 'CUSTOMER_APP_DISABLED',
        error: 'تطبيق العملاء متوقف حاليًا من إعدادات الإدارة.',
      });
    }
    const products = await listProducts({ forCustomer: isCustomer, allowCustomerPriceView });
    res.json({ ok: true, products, mobileConfig: settings.mobileConfig });
  })
);

router.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    const categories = await listCategories();
    res.json({ ok: true, categories });
  })
);

router.post(
  '/categories',
  requireStaff,
  requirePermission('canManageInventory'),
  asyncHandler(async (req, res) => {
    const category = await createCategory(req.body || {}, req.auth.user);
    res.status(201).json({ ok: true, category });
  })
);

router.put(
  '/categories/:id',
  requireStaff,
  requirePermission('canManageInventory'),
  asyncHandler(async (req, res) => {
    const category = await updateCategory(req.params.id, req.body || {}, req.auth.user);
    res.json({ ok: true, category });
  })
);

router.delete(
  '/categories/:id',
  requireStaff,
  requirePermission('canManageInventory'),
  asyncHandler(async (req, res) => {
    await deleteCategory(req.params.id, req.auth.user);
    res.json({ ok: true });
  })
);

router.post(
  '/delete-imported',
  requireStaff,
  requirePermission('canManageInventory'),
  asyncHandler(async (req, res) => {
    const result = await deleteImportedProductsBatch(
      {
        batchId: req.body?.batchId,
        deleteAllImported: req.body?.deleteAllImported !== false,
      },
      req.auth.user
    );
    res.json({ ok: true, ...result });
  })
);

router.post(
  '/',
  requireStaff,
  requirePermission('canManageInventory'),
  asyncHandler(async (req, res) => {
    const product = await createProduct(req.body || {}, req.auth.user);
    res.status(201).json({ ok: true, product });
  })
);

router.put(
  '/:id',
  requireStaff,
  requirePermission('canManageInventory'),
  asyncHandler(async (req, res) => {
    const product = await updateProduct(req.params.id, req.body || {}, req.auth.user);
    res.json({ ok: true, product });
  })
);

router.delete(
  '/:id',
  requireStaff,
  requirePermission('canManageInventory'),
  asyncHandler(async (req, res) => {
    await deleteProduct(req.params.id, req.auth.user);
    res.json({ ok: true });
  })
);

export default router;
