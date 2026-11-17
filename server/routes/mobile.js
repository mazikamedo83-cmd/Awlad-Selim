import { Router } from 'express';
import { getMobileNotifications } from '../db/stores/inventoryAdminStore.js';
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

export default router;
