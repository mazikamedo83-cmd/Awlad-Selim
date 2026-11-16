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
    const products = await listProducts({ forCustomer: isCustomer });
    res.json({ ok: true, products });
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
