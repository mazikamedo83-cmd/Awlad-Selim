import { Router } from 'express';
import { getMobileNotifications, getRepresentativeAccountStatement } from '../db/stores/inventoryAdminStore.js';
import { requireAuth, asyncHandler } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    const result = await getMobileNotifications(req.auth);
    res.json({ ok: true, ...result });
  })
);

router.get(
  '/representatives/:id/statement',
  asyncHandler(async (req, res) => {
    const data = await getRepresentativeAccountStatement(req.params.id, req.auth.user);
    res.json({ ok: true, statement: data, ...data });
  })
);

export default router;

