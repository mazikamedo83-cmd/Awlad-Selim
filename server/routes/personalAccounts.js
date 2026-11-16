import { Router } from 'express';
import {
  listPersonalAccountsData,
  createPersonalAccount,
  updatePersonalAccount,
  createPersonalTransaction,
  editPersonalTransaction,
} from '../db/stores/personalAccountsStore.js';
import {
  requireAuth,
  requireStaff,
  requirePermission,
  asyncHandler,
} from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireStaff);

router.get(
  '/',
  requirePermission('canViewPersonalAccounts'),
  asyncHandler(async (_req, res) => {
    const result = await listPersonalAccountsData();
    res.json({ ok: true, ...result });
  })
);

router.post(
  '/',
  requirePermission('canCreatePersonalTx'),
  asyncHandler(async (req, res) => {
    const account = await createPersonalAccount(req.body || {}, req.auth.user);
    res.status(201).json({ ok: true, account });
  })
);

router.put(
  '/:id',
  requirePermission('canEditPersonalTx'),
  asyncHandler(async (req, res) => {
    const account = await updatePersonalAccount(req.params.id, req.body || {}, req.auth.user);
    res.json({ ok: true, account });
  })
);

router.post(
  '/:id/transactions',
  requirePermission('canCreatePersonalTx'),
  asyncHandler(async (req, res) => {
    const idempotencyKey = req.get('idempotency-key') || req.body?.idempotencyKey || '';
    const result = await createPersonalTransaction(req.params.id, req.body || {}, req.auth.user, idempotencyKey);
    res.status(result.deduplicated ? 200 : 201).json({ ok: true, ...result });
  })
);

router.put(
  '/transactions/:txId',
  requirePermission('canEditPersonalTx'),
  asyncHandler(async (req, res) => {
    const result = await editPersonalTransaction(req.params.txId, req.body || {}, req.auth.user);
    res.json({ ok: true, ...result });
  })
);

export default router;
