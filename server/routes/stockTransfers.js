import { Router } from 'express';
import {
  listStockTransferRequests,
  createStockTransferRequest,
  submitStockTransferRequest,
  approveStockTransferRequest,
  rejectStockTransferRequest,
  executeStockTransferRequest,
} from '../db/stores/stockTransfersStore.js';
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
  requirePermission('canManageInventory'),
  asyncHandler(async (_req, res) => {
    const transfers = await listStockTransferRequests();
    res.json({ ok: true, transfers });
  })
);

router.post(
  '/',
  requirePermission('canCreateStockTransfer'),
  asyncHandler(async (req, res) => {
    const transfer = await createStockTransferRequest(req.body || {}, req.auth.user);
    res.status(201).json({ ok: true, transfer });
  })
);

router.post(
  '/:id/submit',
  requirePermission('canCreateStockTransfer'),
  asyncHandler(async (req, res) => {
    const transfer = await submitStockTransferRequest(req.params.id, req.auth.user);
    res.json({ ok: true, transfer });
  })
);

router.post(
  '/:id/approve',
  requirePermission('canApproveStockTransfer'),
  asyncHandler(async (req, res) => {
    const transfer = await approveStockTransferRequest(req.params.id, req.body || {}, req.auth.user);
    res.json({ ok: true, transfer });
  })
);

router.post(
  '/:id/reject',
  requirePermission('canApproveStockTransfer'),
  asyncHandler(async (req, res) => {
    const transfer = await rejectStockTransferRequest(req.params.id, req.body || {}, req.auth.user);
    res.json({ ok: true, transfer });
  })
);

router.post(
  '/:id/execute',
  requirePermission('canExecuteStockTransfer'),
  asyncHandler(async (req, res) => {
    const transfer = await executeStockTransferRequest(req.params.id, req.auth.user);
    res.json({ ok: true, transfer });
  })
);

export default router;
