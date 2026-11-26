import fs from 'node:fs';
import path from 'node:path';
import { getPool, withTransaction } from '../postgres.js';
import {
  withJsonTransaction,
  readJsonDatabase,
  writeJsonDatabase,
  normalizeDbState,
  getDataPaths,
  createEmptyDatabaseState,
  readJsonIdempotency,
  writeJsonIdempotency,
  nextJsonSequence,
} from '../jsonLedger.js';
import { hashPasswordBcrypt, generateServerId } from '../../utils/crypto.js';
import {
  AppError,
  nowIso,
  todayIso,
  round2,
  round3,
  sanitizeUser,
  sanitizeProductForRepresentative,
  sanitizeInvoiceForRepresentative,
  buildPhoneLookupVariants,
  canViewCashboxBalances,
  sanitizeCashboxForViewer,
  canViewAllRepresentatives,
  canManageSyncConflictsGlobally,
  sanitizeSyncPayload,
  isRepOwnerOfInvoice,
  buildPgInPredicate,
} from '../../utils/errors.js';
import {
  buildScopedIdemKey,
  findPgIdempotency,
  savePgIdempotency,
  findJsonIdempotency,
  saveJsonIdempotency,
} from '../../utils/idempotency.js';
import {
  isPgMode,
  FULL_ADMIN_PERMISSIONS,
  getDefaultPermissionsForRole,
  resolveDefaultPermissionsForRole,
  resolveRolePermissionPresets,
  sanitizeRolePermissionPreset,
  sanitizeEffectivePermissionsForRole,
  normalizeCustomerPhonesList,
  mapPgUserRow,
  mapPgCustomerRow,
  mapPgProductRow,
  mapPgOrderRow,
  mapPgInvoiceRow,
  mapPgPurchaseReturnRequestRow,
  mapPgSalesReturnRequestRow,
  isoDateOnly,
  isoTimestamp,
} from './mode.js';

const EMPTY_PERMISSIONS = Object.fromEntries(Object.keys(FULL_ADMIN_PERMISSIONS).map((k) => [k, false]));
import { recordAuditLog, listAuditLogs } from './authStore.js';
import {
  listCustomers,
  listCategories,
  listProducts,
  getRepresentativeByUserId,
  getSystemSettingsSafe,
  normalizePhoneDigits,
  normalizeCustomerRecordShape,
  customerMatchesPhoneDigits,
} from './catalogStore.js';
import { listInvoices } from './invoicesStore.js';
import { listOrders } from './ordersStore.js';
import { listPersonalAccountsData } from './personalAccountsStore.js';
import { listStockCounts } from './stockCountsStore.js';
import { listStockTransferRequests } from './stockTransfersStore.js';
import { getPublishedStorefront } from './storefrontStore.js';
import {
  attachRecordToIdentityPgTx,
  attachRecordToIdentityJsonTx,
  assertNoSameRoleDuplicatesPgTx,
  assertNoSameRoleDuplicatesJsonTx,
  splitDetachedEmployeeUserIdentityPgTx,
  splitDetachedEmployeeUserIdentityJsonTx,
  alignEmployeeUserIdentityPgTx,
  alignEmployeeUserIdentityJsonTx,
  resolveActorIdentityPgTx,
  resolveActorIdentityJsonTx,
  listIdentitiesOverview,
} from '../identityManager.js';
import {
  listDispatchBatches,
  listDispatchRecipients,
} from './syncDispatchStore.js';

function resolvePurchaseReceiversFromUsers(usersList = []) {
  return (usersList || [])
    .filter((u) => {
      if (!u || u.isActive === false) return false;
      if (u.role === 'customer' || u.role === 'representative') return false;
      const p = u.permissions || {};
      return (
        u.role === 'admin' ||
        u.role === 'purchases' ||
        u.role === 'manager' ||
        Boolean(p.canManagePurchases || p.canApprove || p.canReceive)
      );
    })
    .map((u) => ({
      id: u.id,
      fullName: u.fullName,
      role: u.role,
      jobTitle: u.jobTitle || '',
    }));
}

export async function listPurchaseReceivers() {
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query(
      "SELECT id, full_name, role, job_title, is_active, permissions FROM users WHERE is_active = TRUE AND role NOT IN ('customer', 'representative') ORDER BY full_name ASC"
    );
    return resolvePurchaseReceiversFromUsers(res.rows.map(mapPgUserRow));
  }
  const db = readJsonDatabase();
  return resolvePurchaseReceiversFromUsers(db.users || []);
}

// ==============================================================================
// Staff / Admin Bootstrap Snapshot (Strictly NO password hashes, RBAC-scoped)
// ==============================================================================

export async function getStaffBootstrapData(actor) {
  const isAdmin = actor.role === 'admin';
  const perms = actor.permissions || {};
  const isRep = actor.role === 'representative';
  const isAdminOrUserMgr = !isRep && (isAdmin || Boolean(perms.canManageUsers));
  const canViewPersonal = !isRep && (isAdmin || Boolean(perms.canViewPersonalAccounts));
  const canViewSuppliers = isRep
    ? Boolean(perms.canCreatePurchase || perms.canManagePurchases)
    : (isAdmin || Boolean(perms.canManagePurchases || perms.canCreatePurchase || perms.canManageAccounts || perms.canViewReports));
  const canViewPurchaseReceivers = isRep
    ? Boolean(perms.canCreatePurchase || perms.canManagePurchases)
    : (isAdmin || Boolean(perms.canManagePurchases || perms.canCreatePurchase || perms.canSend));
  const canViewPurchaseReturnReqs = isRep
    ? canViewSuppliers
    : (isAdmin || Boolean(perms.canManagePurchases || perms.canCreatePurchase || perms.canApprove || perms.canViewReports));
  const canViewSalesReturnReqs = isRep
    ? Boolean(perms.canManageSales)
    : (isAdmin || Boolean(perms.canManageSales || perms.canApprove || perms.canManageCashboxes || perms.canManageAccounts || perms.canViewReports));
  const canViewTreasuryLedger = !isRep && (isAdmin || Boolean(perms.canManageCashboxes || perms.canManageAccounts || perms.canViewReports));
  const canViewChequesInstallments = !isRep && (isAdmin || Boolean(perms.canManageAccounts || perms.canViewReports));
  const canViewHrData = !isRep && (isAdmin || Boolean(perms.canManageEmployees || perms.canViewReports));
  const canViewAuditLogs = !isRep && isAdminOrUserMgr;
  const canSeeCashboxes = canViewCashboxBalances(actor);
  const repProfile = isRep ? await getRepresentativeByUserId(actor.id) : null;

  if (await isPgMode()) {
    const pool = getPool();
    const [
      usersRes,
      whRes,
      cats,
      prods,
      custs,
      suppRes,
      invs,
      retRes,
      retItemRes,
      cbRes,
      ftRes,
      chRes,
      instRes,
      repRes,
      rtRes,
      ritRes,
      ritItemRes,
      empRes,
      advRes,
      attRes,
      payRes,
      expRes,
      smRes,
      stRes,
      orders,
      audits,
      advPayRes,
      conflictsRes,
      custodyOpsRes,
      purchaseReceiversList,
      prReqRes,
      prReqItemRes,
      srReqRes,
      srReqItemRes,
    ] = await Promise.all([
      isAdminOrUserMgr ? pool.query('SELECT * FROM users ORDER BY created_at DESC') : Promise.resolve({ rows: [] }),
      pool.query('SELECT * FROM warehouses ORDER BY created_at ASC'),
      listCategories(),
      listProducts({ forCustomer: false, forRepresentative: isRep }),
      listCustomers(),
      canViewSuppliers ? pool.query('SELECT * FROM suppliers ORDER BY created_at DESC') : Promise.resolve({ rows: [] }),
      listInvoices(actor),
      pool.query('SELECT * FROM invoice_returns ORDER BY created_at DESC'),
      pool.query('SELECT * FROM invoice_return_items'),
      canViewCashboxBalances(actor)
        ? pool.query('SELECT * FROM cashboxes ORDER BY created_at ASC')
        : pool.query('SELECT id, name, type, is_default FROM cashboxes ORDER BY created_at ASC'),
      canViewTreasuryLedger ? pool.query('SELECT * FROM financial_transactions ORDER BY created_at DESC LIMIT 1000') : Promise.resolve({ rows: [] }),
      canViewChequesInstallments ? pool.query('SELECT * FROM cheques ORDER BY created_at DESC') : Promise.resolve({ rows: [] }),
      canViewChequesInstallments ? pool.query('SELECT * FROM installments ORDER BY created_at DESC') : Promise.resolve({ rows: [] }),
      canViewAllRepresentatives(actor)
        ? pool.query('SELECT * FROM representatives ORDER BY created_at ASC')
        : pool.query('SELECT * FROM representatives WHERE user_id = $1 ORDER BY created_at ASC', [actor.id]),
      pool.query('SELECT * FROM rep_transfers ORDER BY created_at DESC'),
      pool.query('SELECT * FROM rep_item_transfers ORDER BY created_at DESC'),
      pool.query('SELECT * FROM rep_item_transfer_items'),
      canViewHrData ? pool.query('SELECT * FROM employees ORDER BY created_at DESC') : Promise.resolve({ rows: [] }),
      Promise.resolve({ rows: [] }),
      Promise.resolve({ rows: [] }),
      Promise.resolve({ rows: [] }),
      canViewTreasuryLedger ? pool.query('SELECT * FROM expenses_incomes ORDER BY created_at DESC') : Promise.resolve({ rows: [] }),
      isRep
        ? repProfile?.warehouseId
          ? pool.query(
              'SELECT * FROM stock_movements WHERE (warehouse_id = $1 OR target_warehouse_id = $1) ORDER BY created_at DESC LIMIT 1500',
              [repProfile.warehouseId]
            )
          : Promise.resolve({ rows: [] })
        : pool.query('SELECT * FROM stock_movements ORDER BY created_at DESC LIMIT 1500'),
      pool.query('SELECT * FROM system_settings LIMIT 1'),
      listOrders({ user: actor, representativeProfile: repProfile }),
      canViewAuditLogs ? listAuditLogs(300) : Promise.resolve([]),
      pool.query('SELECT * FROM order_advance_payments ORDER BY created_at DESC LIMIT 1000'),
      canManageSyncConflictsGlobally(actor)
        ? pool.query('SELECT * FROM sync_conflicts ORDER BY created_at DESC LIMIT 300')
        : pool.query('SELECT * FROM sync_conflicts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 150', [actor.id]),
      isRep && repProfile
        ? pool.query('SELECT * FROM rep_custody_operations WHERE representative_id = $1 ORDER BY created_at DESC', [repProfile.id])
        : pool.query('SELECT * FROM rep_custody_operations ORDER BY created_at DESC LIMIT 1000'),
      canViewPurchaseReceivers ? listPurchaseReceivers() : Promise.resolve([]),
      canViewPurchaseReturnReqs
        ? isRep
          ? pool.query(
              'SELECT * FROM purchase_return_requests WHERE requested_by_user_id = $1 OR ($2::varchar IS NOT NULL AND representative_id = $2) ORDER BY created_at DESC',
              [actor.id, repProfile?.id || null]
            )
          : pool.query('SELECT * FROM purchase_return_requests ORDER BY created_at DESC')
        : Promise.resolve({ rows: [] }),
      canViewPurchaseReturnReqs ? pool.query('SELECT * FROM purchase_return_request_items') : Promise.resolve({ rows: [] }),
      canViewSalesReturnReqs
        ? isRep
          ? pool.query(
              'SELECT * FROM sales_return_requests WHERE requested_by_user_id = $1 OR ($2::varchar IS NOT NULL AND representative_id = $2) ORDER BY created_at DESC',
              [actor.id, repProfile?.id || null]
            )
          : pool.query('SELECT * FROM sales_return_requests ORDER BY created_at DESC')
        : Promise.resolve({ rows: [] }),
      canViewSalesReturnReqs ? pool.query('SELECT * FROM sales_return_request_items') : Promise.resolve({ rows: [] }),
    ]);

    const retItemsMap = new Map();
    for (const it of retItemRes.rows) {
      const list = retItemsMap.get(it.return_id) || [];
      list.push({
        productId: it.product_id,
        productName: it.product_name,
        unit: it.unit,
        unitFactor: Number(it.unit_factor || 1),
        quantity: Number(it.quantity || 0),
        unitPrice: Number(it.unit_price || 0),
        total: Number(it.total || 0),
      });
      retItemsMap.set(it.return_id, list);
    }

    const prReqItemsMap = new Map();
    for (const it of prReqItemRes?.rows || []) {
      const list = prReqItemsMap.get(it.request_id) || [];
      list.push(it);
      prReqItemsMap.set(it.request_id, list);
    }

    const srReqItemsMap = new Map();
    for (const it of srReqItemRes?.rows || []) {
      const list = srReqItemsMap.get(it.request_id) || [];
      list.push(it);
      srReqItemsMap.set(it.request_id, list);
    }

    const ritItemsMap = new Map();
    for (const it of ritItemRes.rows) {
      const list = ritItemsMap.get(it.transfer_id) || [];
      list.push({
        productId: it.product_id,
        productName: it.product_name,
        barcode: it.barcode || '',
        unit: it.unit,
        requestedQty: Number(it.requested_qty || 0),
        availableInVanQty: Number(it.available_in_van_qty || 0),
        shortageQty: Number(it.shortage_qty || 0),
        approvedQty: it.approved_qty ?? undefined,
        executedQty: it.executed_qty ?? undefined,
      });
      ritItemsMap.set(it.transfer_id, list);
    }

    const sRow = stRes.rows[0];
    const rawExtra = sRow?.extra_settings || {};
    const enrichedExtra = {
      ...rawExtra,
      roleDefaultPermissions: resolveRolePermissionPresets(rawExtra),
    };
    const settings = sRow
      ? {
          companyName: sRow.company_name,
          companySubtitle: sRow.company_subtitle || '',
          phone1: sRow.phone1 || '',
          phone2: sRow.phone2 || '',
          address: sRow.address || '',
          commercialRegistration: sRow.commercial_registration || '',
          taxNumber: sRow.tax_number || '',
          branchNumber: sRow.branch_number || rawExtra.branchNumber || '',
          currency: sRow.currency || 'ج.م',
          defaultPrintMode: sRow.default_print_mode || 'a4',
          invoiceNotes: sRow.invoice_notes || '',
          allowNegativeStock: Boolean(sRow.allow_negative_stock),
          extraSettings: enrichedExtra,
        }
      : {
          ...createEmptyDatabaseState().settings,
          extraSettings: enrichedExtra,
        };

    const [personalData, stockCountsList, stockTransferRequestsList, identityOverview, publishedStorefront] = await Promise.all([
      canViewPersonal ? listPersonalAccountsData() : Promise.resolve({ accounts: [], transactions: [] }),
      isRep ? Promise.resolve([]) : listStockCounts(),
      isRep ? Promise.resolve([]) : listStockTransferRequests(),
      isAdminOrUserMgr
        ? listIdentitiesOverview()
        : Promise.resolve({ identities: [], identityRoles: [], conflicts: [] }),
      getPublishedStorefront(),
    ]);

    const allowedCustIdSet = isRep ? new Set(custs.map((c) => c.id)) : null;
    const visibleInvIdSet = isRep ? new Set(invs.map((i) => i.id)) : null;

    return {
      mode: 'postgresql-enterprise',
      users: usersRes.rows.map((r) => sanitizeUser(mapPgUserRow(r))),
      purchaseReceivers: purchaseReceiversList,
      warehouses: whRes.rows.map((w) => ({
        id: w.id,
        name: w.name,
        code: w.code,
        location: w.location || '',
        managerName: w.manager_name || undefined,
        phone: w.phone || undefined,
        isDefault: Boolean(w.is_default),
        status: w.status || 'active',
      })),
      categories: cats,
      products: prods,
      customers: custs,
      suppliers: canViewSuppliers
        ? suppRes.rows.map((s) => ({
            id: s.id,
            code: s.code,
            name: s.name,
            phone: s.phone || '',
            address: s.address || '',
            openingBalance: Number(s.opening_balance || 0),
            currentBalance: Number(s.current_balance || 0),
            notes: s.notes || '',
            status: s.status || 'active',
            identityId: s.identity_id || undefined,
            userId: s.user_id || undefined,
            createdAt: isoTimestamp(s.created_at),
          }))
        : [],
      invoices: invs,
      invoiceReturns: retRes.rows
        .filter(
          (r) =>
            !isRep ||
            (r.type === 'sales_return' && (visibleInvIdSet?.has(r.original_invoice_id) || r.created_by_user_id === actor.id)) ||
            (r.type === 'purchase_return' && canViewSuppliers && (visibleInvIdSet?.has(r.original_invoice_id) || r.created_by_user_id === actor.id))
        )
        .map((r) => ({
          id: r.id,
          returnNumber: r.return_number,
          type: r.type,
          originalInvoiceId: r.original_invoice_id,
          originalInvoiceNumber: r.original_invoice_number,
          date: isoDateOnly(r.date),
          partyId: r.party_id,
          partyName: r.party_name,
          warehouseId: r.warehouse_id,
          warehouseName: r.warehouse_name,
          items: retItemsMap.get(r.id) || [],
          grandTotal: Number(r.grand_total || 0),
          refundType: r.refund_type,
          cashboxId: canSeeCashboxes ? (r.cashbox_id || undefined) : undefined,
          reason: r.reason,
          notes: r.notes || '',
          createdByUserId: r.created_by_user_id || undefined,
          createdBy: r.created_by,
          createdAt: isoTimestamp(r.created_at),
        })),
      purchaseReturnRequests: (prReqRes?.rows || []).map((r) => {
        const mapped = mapPgPurchaseReturnRequestRow(r, prReqItemsMap.get(r.id) || []);
        if (!canSeeCashboxes) delete mapped.cashboxId;
        return mapped;
      }),
      salesReturnRequests: (srReqRes?.rows || []).map((r) => {
        const mapped = mapPgSalesReturnRequestRow(r, srReqItemsMap.get(r.id) || []);
        if (!canSeeCashboxes) delete mapped.cashboxId;
        return mapped;
      }),
      cashboxes: cbRes.rows.map((c) =>
        sanitizeCashboxForViewer(
          {
            id: c.id,
            name: c.name,
            type: c.type,
            openingBalance: c.opening_balance !== undefined ? Number(c.opening_balance || 0) : undefined,
            currentBalance: c.current_balance !== undefined ? Number(c.current_balance || 0) : undefined,
            isDefault: Boolean(c.is_default),
          },
          actor
        )
      ),
      financialTransactions: canViewTreasuryLedger
        ? ftRes.rows.map((ft) => ({
            id: ft.id,
            transactionNumber: ft.transaction_number,
            date: isoDateOnly(ft.date),
            type: ft.type,
            cashboxId: ft.cashbox_id,
            cashboxName: ft.cashbox_name,
            balanceAfter: ft.balance_after !== null && ft.balance_after !== undefined ? Number(ft.balance_after) : undefined,
            amount: Number(ft.amount || 0),
            category: ft.category || '',
            relatedDocType: ft.related_doc_type || undefined,
            relatedDocId: ft.related_doc_id || undefined,
            relatedDocNumber: ft.related_doc_number || undefined,
            partyId: ft.related_entity_id || undefined,
            partyName: ft.related_entity_name || undefined,
            description: ft.description || '',
            notes: ft.notes || '',
            createdByUserId: ft.created_by_user_id || undefined,
            createdBy: ft.created_by,
            createdAt: isoTimestamp(ft.created_at),
          }))
        : [],
      cheques: canViewChequesInstallments
        ? chRes.rows.map((ch) => ({
            id: ch.id,
            chequeNumber: ch.cheque_number,
            type: ch.type,
            bankName: ch.bank_name,
            amount: Number(ch.amount || 0),
            issueDate: isoDateOnly(ch.issue_date),
            dueDate: isoDateOnly(ch.due_date),
            partyId: ch.party_id,
            partyName: ch.party_name,
            status: ch.status,
            cashboxId: ch.cashbox_id || undefined,
            notes: ch.notes || '',
            createdAt: isoTimestamp(ch.created_at),
          }))
        : [],
      installments: canViewChequesInstallments
        ? instRes.rows.map((i) => ({
            id: i.id,
            scheduleNumber: i.schedule_number,
            customerId: i.customer_id,
            customerName: i.customer_name,
            invoiceId: i.invoice_id || undefined,
            invoiceNumber: i.invoice_number || undefined,
            totalAmount: Number(i.total_amount || 0),
            paidAmount: Number(i.paid_amount || 0),
            remainingAmount: Number(i.remaining_amount || 0),
            items: i.installments_data || [],
            notes: i.notes || '',
            createdAt: isoTimestamp(i.created_at),
          }))
        : [],
      representatives: repRes.rows.map((r) =>
        canViewAllRepresentatives(actor)
          ? {
              id: r.id,
              userId: r.user_id || undefined,
              identityId: r.identity_id || undefined,
              name: r.name,
              phone: r.phone || '',
              vehicleNumber: r.vehicle_number || '',
              warehouseId: r.warehouse_id || undefined,
              openingBalance: Number(r.opening_balance || 0),
              currentBalance: Number(r.current_balance || 0),
              commissionRate: Number(r.commission_rate || 0),
              notes: r.notes || '',
              status: r.status || 'active',
            }
          : {
              id: r.id,
              userId: r.user_id || undefined,
              identityId: r.identity_id || undefined,
              name: r.name,
              phone: r.phone || '',
              vehicleNumber: r.vehicle_number || '',
              warehouseId: r.warehouse_id || undefined,
              currentBalance: Number(r.current_balance || 0),
              status: r.status || 'active',
            }
      ),
      repTransfers: rtRes.rows
        .filter((rt) => !isRep || (repProfile && (rt.representative_id === repProfile.id || rt.sender_id === repProfile.id || rt.receiver_id === repProfile.id)))
        .map((rt) => ({
          id: rt.id,
          transferNumber: rt.transfer_number,
          date: isoDateOnly(rt.date),
          timestamp: isoTimestamp(rt.created_at),
          direction: rt.direction,
          senderId: rt.sender_id,
          senderName: rt.sender_name,
          receiverId: rt.receiver_id,
          receiverName: rt.receiver_name,
          amount: Number(rt.amount || 0),
          cashboxId: rt.cashbox_id,
          cashboxName: rt.cashbox_name,
          notes: rt.notes || '',
          status: rt.status,
          sentAt: rt.sent_at ? isoTimestamp(rt.sent_at) : isoTimestamp(rt.created_at),
          confirmedAt: rt.confirmed_at ? isoTimestamp(rt.confirmed_at) : undefined,
          rejectedAt: rt.rejected_at ? isoTimestamp(rt.rejected_at) : undefined,
          rejectionReason: rt.rejection_reason || undefined,
          confirmedBy: rt.confirmed_by || undefined,
          auditTrail: rt.audit_trail || [],
        })),
      repItemTransfers: ritRes.rows
        .filter((rit) => !isRep || (repProfile && rit.representative_id === repProfile.id))
        .map((rit) => ({
          id: rit.id,
          requestNumber: rit.request_number,
          date: isoDateOnly(rit.date),
          representativeId: rit.representative_id,
          representativeName: rit.representative_name,
          invoiceId: rit.invoice_id || undefined,
          invoiceNumber: rit.invoice_number || undefined,
          sourceWarehouseId: rit.source_warehouse_id,
          sourceWarehouseName: rit.source_warehouse_name,
          targetWarehouseId: rit.target_warehouse_id,
          targetWarehouseName: rit.target_warehouse_name,
          transferMode: rit.transfer_mode || 'transfer',
          items: ritItemsMap.get(rit.id) || [],
          status: rit.status,
          rejectionReason: rit.rejection_reason || undefined,
          notes: rit.notes || '',
          createdBy: rit.created_by,
          createdAt: isoTimestamp(rit.created_at),
          reviewedBy: rit.reviewed_by || undefined,
          reviewedAt: rit.reviewed_at ? isoTimestamp(rit.reviewed_at) : undefined,
          dispatchedBy: rit.dispatched_by || undefined,
          dispatchedAt: rit.dispatched_at ? isoTimestamp(rit.dispatched_at) : undefined,
          executedAt: rit.executed_at ? isoTimestamp(rit.executed_at) : undefined,
          receivedBy: rit.received_by || undefined,
          receivedAt: rit.received_at ? isoTimestamp(rit.received_at) : undefined,
        })),
      repCustodyOperations: (custodyOpsRes?.rows || []).map((op) => ({
        id: op.id,
        operationNumber: op.operation_number,
        date: isoDateOnly(op.date),
        representativeId: op.representative_id,
        representativeName: op.representative_name,
        operationType: op.operation_type,
        productId: op.product_id,
        productName: op.product_name,
        unit: op.unit,
        unitFactor: Number(op.unit_factor || 1),
        quantity: Number(op.quantity || 0),
        baseQuantity: Number(op.base_quantity || 0),
        warehouseId: op.warehouse_id || undefined,
        warehouseName: op.warehouse_name || '',
        customerId: op.customer_id || undefined,
        customerName: op.customer_name || '',
        invoiceId: op.invoice_id || undefined,
        invoiceNumber: op.invoice_number || undefined,
        notes: op.notes || '',
        status: op.status || 'approved',
        createdBy: op.created_by,
        createdAt: isoTimestamp(op.created_at),
      })),
      customerItemOrders: orders,
      employees: !canViewHrData
        ? []
        : empRes.rows.map((e) => ({
            id: e.id,
            code: e.code,
            name: e.full_name,
            phone: e.phone || '',
            jobTitle: e.job_title,
            department: e.department || '',
            nationalId: e.national_id || '',
            hireDate: isoDateOnly(e.hire_date),
            status: e.status || 'active',
            notes: e.notes || '',
            identityId: e.identity_id || undefined,
            userId: e.user_id || undefined,
          })),
      expenseIncomes: !canViewTreasuryLedger
        ? []
        : expRes.rows.map((ex) => ({
            id: ex.id,
            recordNumber: ex.voucher_number,
            type: ex.type,
            category: ex.category,
            amount: Number(ex.amount || 0),
            date: isoDateOnly(ex.date),
            cashboxId: ex.cashbox_id,
            cashboxName: ex.cashbox_name,
            paymentMethod: ex.payment_method || 'cash',
            recipientOrPayer: ex.recipient_or_payer || '',
            attachmentName: ex.attachment_name || undefined,
            notes: ex.notes || '',
            createdBy: ex.created_by,
            createdAt: isoTimestamp(ex.created_at),
          })),
      stockMovements: smRes.rows
        .filter((sm) => !isRep || (repProfile?.warehouseId && (sm.warehouse_id === repProfile.warehouseId || sm.target_warehouse_id === repProfile.warehouseId)))
        .map((sm) => ({
          id: sm.id,
          date: isoDateOnly(sm.date),
          type: sm.movement_type,
          productId: sm.product_id,
          productName: sm.product_name,
          warehouseId: sm.warehouse_id,
          warehouseName: sm.warehouse_name,
          targetWarehouseId: sm.target_warehouse_id || undefined,
          targetWarehouseName: sm.target_warehouse_name || undefined,
          quantity: Number(sm.quantity || 0),
          unit: sm.unit || '',
          unitFactor: Number(sm.unit_factor || 1),
          unitCost: isRep ? 0 : Number(sm.unit_cost || 0),
          balanceBefore: sm.balance_before !== null && sm.balance_before !== undefined ? Number(sm.balance_before) : undefined,
          balanceAfter: sm.balance_after !== null && sm.balance_after !== undefined ? Number(sm.balance_after) : undefined,
          relatedDocType: sm.related_doc_type || undefined,
          referenceId: sm.related_doc_id || undefined,
          referenceNumber: sm.related_doc_number || undefined,
          notes: sm.notes || '',
          createdByUserId: sm.created_by_user_id || undefined,
          createdBy: sm.created_by,
          createdAt: isoTimestamp(sm.created_at),
        })),
      ownerAccounts: personalData.accounts,
      ownerTransactions: personalData.transactions,
      stockCounts: stockCountsList,
      stockTransferRequests: stockTransferRequestsList,
      orderAdvancePayments: advPayRes.rows
        .filter((r) => !isRep || allowedCustIdSet?.has(r.customer_id))
        .map((r) => ({
          id: r.id,
          paymentNumber: r.payment_number,
          orderId: r.order_id,
          customerId: r.customer_id,
          ...(canSeeCashboxes ? { cashboxId: r.cashbox_id, cashboxName: r.cashbox_name || '' } : {}),
          paymentMethod: r.payment_method || 'cash',
          amount: Number(r.amount || 0),
          date: isoDateOnly(r.date),
          notes: r.notes || '',
          status: r.status || 'active',
          appliedInvoiceId: r.applied_invoice_id || undefined,
          createdBy: r.created_by,
          createdAt: isoTimestamp(r.created_at),
        })),
      syncConflicts: conflictsRes.rows.map((r) => ({
        id: r.id,
        operationId: r.operation_id,
        operationType: r.operation_type,
        entityType: r.entity_type,
        entityId: r.entity_id || undefined,
        deviceId: r.device_id || undefined,
        userId: r.user_id || undefined,
        userName: r.user_name || '',
        conflictReason: r.conflict_reason,
        localPayload: sanitizeSyncPayload(r.local_payload || {}, { redactCosts: isRep }),
        serverSnapshot: sanitizeSyncPayload(r.server_snapshot || {}, { redactCosts: isRep }),
        status: r.status,
        resolutionNotes: r.resolution_notes || '',
        resolvedBy: r.resolved_by || undefined,
        resolvedAt: r.resolved_at ? isoTimestamp(r.resolved_at) : undefined,
        createdAt: isoTimestamp(r.created_at),
      })),
      identities: identityOverview.identities || [],
      identityRoles: identityOverview.identityRoles || [],
      identityConflicts: identityOverview.conflicts || [],
      syncDispatchBatches: await listDispatchBatches(actor),
      dispatchRecipients: await listDispatchRecipients(actor),
      publishedStorefront,
      settings,
      auditLogs: audits,
    };
  }

  // JSON Ledger fallback
  const db = readJsonDatabase();
  const [audits, identityOverviewJson] = await Promise.all([
    canViewAuditLogs ? listAuditLogs(300) : Promise.resolve([]),
    isAdminOrUserMgr
      ? listIdentitiesOverview()
      : Promise.resolve({ identities: [], identityRoles: [], conflicts: [] }),
  ]);
  const scopedCustomers = (db.customers || []).map(normalizeCustomerRecordShape);
  const scopedCustomerIdSet = new Set(scopedCustomers.map((c) => c.id));
  const scopedInvoices = isRep
    ? (db.invoices || [])
        .filter((inv) => {
          const isOwnInv = isRepOwnerOfInvoice(inv, actor, repProfile);
          if (!isOwnInv) return false;
          if (inv.type === 'sales' || inv.type === 'quote') return true;
          if (inv.type === 'purchase') return canViewSuppliers;
          return false;
        })
        .map(sanitizeInvoiceForRepresentative)
    : db.invoices;
  const scopedInvIdSet = new Set(scopedInvoices.map((i) => i.id));
  const scopedPrReqs = canViewPurchaseReturnReqs
    ? (isRep
        ? (db.purchaseReturnRequests || []).filter(
            (r) =>
              r.requestedByUserId === actor.id ||
              r.createdByUserId === actor.id ||
              (repProfile && r.representativeId === repProfile.id)
          )
        : (db.purchaseReturnRequests || [])
      ).map((r) => {
        if (canSeeCashboxes) return r;
        const copy = { ...r };
        delete copy.cashboxId;
        return copy;
      })
    : [];
  const scopedSrReqs = canViewSalesReturnReqs
    ? (isRep
        ? (db.salesReturnRequests || []).filter(
            (r) =>
              r.requestedByUserId === actor.id ||
              r.createdByUserId === actor.id ||
              (repProfile && r.representativeId === repProfile.id)
          )
        : (db.salesReturnRequests || [])
      ).map((r) => {
        if (canSeeCashboxes) return r;
        const copy = { ...r };
        delete copy.cashboxId;
        return copy;
      })
    : [];

  const redactRetCashbox = (ret) => {
    if (canSeeCashboxes) return ret;
    const copy = { ...ret };
    delete copy.cashboxId;
    return copy;
  };

  return {
    mode: 'local-json-ledger',
    users: isAdminOrUserMgr
      ? db.users.map((u) => sanitizeUser({ ...u, permissions: sanitizeEffectivePermissionsForRole(u.role, u.permissions) }))
      : [],
    purchaseReceivers: canViewPurchaseReceivers ? resolvePurchaseReceiversFromUsers(db.users || []) : [],
    warehouses: db.warehouses,
    categories: db.categories,
    products: isRep ? (db.products || []).map(sanitizeProductForRepresentative) : db.products,
    customers: scopedCustomers,
    suppliers: canViewSuppliers ? db.suppliers : [],
    invoices: scopedInvoices,
    invoiceReturns: (isRep
      ? (db.invoiceReturns || []).filter(
          (r) =>
            (r.type === 'sales_return' && (scopedInvIdSet.has(r.originalInvoiceId) || r.createdByUserId === actor.id)) ||
            (r.type === 'purchase_return' && canViewSuppliers && (scopedInvIdSet.has(r.originalInvoiceId) || r.createdByUserId === actor.id))
        )
      : db.invoiceReturns
    ).map(redactRetCashbox),
    purchaseReturnRequests: scopedPrReqs,
    salesReturnRequests: scopedSrReqs,
    cashboxes: (db.cashboxes || []).map((c) => sanitizeCashboxForViewer(c, actor)),
    financialTransactions: canViewTreasuryLedger ? db.financialTransactions : [],
    cheques: canViewChequesInstallments ? db.cheques : [],
    installments: canViewChequesInstallments ? db.installments : [],
    representatives: canViewAllRepresentatives(actor)
      ? db.representatives
      : (db.representatives || [])
          .filter((r) => r.userId === actor.id || (repProfile && r.id === repProfile.id))
          .map((r) => ({
            id: r.id,
            userId: r.userId || undefined,
            name: r.name,
            phone: r.phone || '',
            vehicleNumber: r.vehicleNumber || '',
            warehouseId: r.warehouseId || undefined,
            currentBalance: Number(r.currentBalance || 0),
            status: r.status || 'active',
          })),
    repTransfers: isRep
      ? (repProfile ? (db.repTransfers || []).filter((rt) => rt.representativeId === repProfile.id || rt.senderId === repProfile.id || rt.receiverId === repProfile.id) : [])
      : db.repTransfers,
    repItemTransfers: isRep
      ? (repProfile ? (db.repItemTransfers || []).filter((rit) => rit.representativeId === repProfile.id) : [])
      : db.repItemTransfers,
    repCustodyOperations: isRep
      ? (repProfile ? (db.repCustodyOperations || []).filter((op) => op.representativeId === repProfile.id) : [])
      : (db.repCustodyOperations || []),
    customerItemOrders: await listOrders({ user: actor, representativeProfile: repProfile }),
    orderAdvancePayments: (isRep
      ? (db.orderAdvancePayments || []).filter((a) => scopedCustomerIdSet.has(a.customerId))
      : db.orderAdvancePayments || []
    ).map((a) => {
      if (canSeeCashboxes) return a;
      const copy = { ...a };
      delete copy.cashboxId;
      delete copy.cashboxName;
      return copy;
    }),
    syncConflicts: (canManageSyncConflictsGlobally(actor)
      ? db.syncConflicts || []
      : (db.syncConflicts || []).filter((c) => c.userId === actor.id)
    ).map((c) => ({
      ...c,
      localPayload: sanitizeSyncPayload(c.localPayload || {}, { redactCosts: isRep }),
      serverSnapshot: sanitizeSyncPayload(c.serverSnapshot || {}, { redactCosts: isRep }),
    })),
    employees: canViewHrData ? db.employees : [],
    expenseIncomes: canViewTreasuryLedger ? db.expenseIncomes : [],
    stockMovements: isRep
      ? (db.stockMovements || [])
          .filter((sm) => repProfile?.warehouseId && (sm.warehouseId === repProfile.warehouseId || sm.targetWarehouseId === repProfile.warehouseId))
          .map((sm) => ({ ...sm, unitCost: 0 }))
      : db.stockMovements,
    ownerAccounts: canViewPersonal ? (db.ownerAccounts || []) : [],
    ownerTransactions: canViewPersonal ? (db.ownerTransactions || []) : [],
    stockCounts: isRep ? [] : (db.stockCounts || []),
    stockTransferRequests: isRep ? [] : (db.stockTransferRequests || []),
    identities: identityOverviewJson.identities || [],
    identityRoles: identityOverviewJson.identityRoles || [],
    identityConflicts: identityOverviewJson.conflicts || [],
    syncDispatchBatches: await listDispatchBatches(actor),
    dispatchRecipients: await listDispatchRecipients(actor),
    publishedStorefront: await getPublishedStorefront(),
    settings: {
      ...(db.settings || {}),
      extraSettings: {
        ...(db.settings?.extraSettings || {}),
        roleDefaultPermissions: resolveRolePermissionPresets(db.settings?.extraSettings || {}),
      },
    },
    auditLogs: audits,
  };
}

// ==============================================================================
// Warehouses & Stock Operations
// ==============================================================================

export async function createWarehouse(payload, actor) {
  const id = payload.id || generateServerId('WH');
  const code = String(payload.code || `WH-${Date.now().toString().slice(-4)}`).trim();
  const name = String(payload.name || '').trim();
  if (!name) throw new AppError(400, 'اسم المستودع مطلوب', 'INVALID_WAREHOUSE_NAME');
  const now = nowIso();

  if (await isPgMode()) {
    const wh = await withTransaction(async (client) => {
      if (payload.isDefault) await client.query('UPDATE warehouses SET is_default = FALSE');
      await client.query(
        `INSERT INTO warehouses (id, name, code, location, manager_name, phone, is_default, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, name, code, payload.location || '', payload.managerName || null, payload.phone || null, Boolean(payload.isDefault), payload.status || 'active', now]
      );
      return { id, name, code, location: payload.location || '', managerName: payload.managerName, phone: payload.phone, isDefault: Boolean(payload.isDefault), status: payload.status || 'active' };
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إضافة مستودع (${name})`, module: 'المخزون والمستودعات', recordId: id });
    return wh;
  }

  const wh = await withJsonTransaction(async (db) => {
    if (payload.isDefault) db.warehouses.forEach((w) => { w.isDefault = false; });
    const item = { id, name, code, location: payload.location || '', managerName: payload.managerName, phone: payload.phone, isDefault: Boolean(payload.isDefault), status: payload.status || 'active' };
    db.warehouses.push(item);
    return item;
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إضافة مستودع (${name})`, module: 'المخزون والمستودعات', recordId: id });
  return wh;
}

export async function updateWarehouse(warehouseId, updates, actor) {
  if (await isPgMode()) {
    const wh = await withTransaction(async (client) => {
      const r = await client.query('SELECT * FROM warehouses WHERE id = $1 FOR UPDATE', [warehouseId]);
      if (!r.rows[0]) throw new AppError(404, 'المستودع غير موجود', 'WAREHOUSE_NOT_FOUND');
      const cur = r.rows[0];
      if (updates.isDefault) await client.query('UPDATE warehouses SET is_default = FALSE');
      await client.query(
        `UPDATE warehouses SET name = $1, location = $2, manager_name = $3, phone = $4, is_default = $5, status = $6 WHERE id = $7`,
        [updates.name ?? cur.name, updates.location ?? cur.location, updates.managerName ?? cur.manager_name, updates.phone ?? cur.phone, updates.isDefault ?? cur.is_default, updates.status ?? cur.status, warehouseId]
      );
      const next = (await client.query('SELECT * FROM warehouses WHERE id = $1', [warehouseId])).rows[0];
      return { id: next.id, name: next.name, code: next.code, location: next.location || '', managerName: next.manager_name || undefined, phone: next.phone || undefined, isDefault: Boolean(next.is_default), status: next.status };
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تحديث مستودع (${wh.name})`, module: 'المخزون والمستودعات', recordId: warehouseId });
    return wh;
  }

  const wh = await withJsonTransaction(async (db) => {
    const idx = db.warehouses.findIndex((w) => w.id === warehouseId);
    if (idx === -1) throw new AppError(404, 'المستودع غير موجود', 'WAREHOUSE_NOT_FOUND');
    if (updates.isDefault) db.warehouses.forEach((w) => { w.isDefault = false; });
    db.warehouses[idx] = { ...db.warehouses[idx], ...updates, id: warehouseId };
    return db.warehouses[idx];
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تحديث مستودع (${wh.name})`, module: 'المخزون والمستودعات', recordId: warehouseId });
  return wh;
}

export async function deleteWarehouse(warehouseId, actor) {
  if (await isPgMode()) {
    await withTransaction(async (client) => {
      const r = await client.query('SELECT * FROM warehouses WHERE id = $1 FOR UPDATE', [warehouseId]);
      if (!r.rows[0]) throw new AppError(404, 'المستودع غير موجود', 'WAREHOUSE_NOT_FOUND');
      const used = await client.query('SELECT id FROM invoices WHERE warehouse_id = $1 LIMIT 1', [warehouseId]);
      if (used.rows[0]) throw new AppError(409, 'لا يمكن حذف مستودع مرتبط بفواتير. يمكنك إيقافه بدلاً من الحذف.', 'WAREHOUSE_IN_USE');
      await client.query('DELETE FROM warehouses WHERE id = $1', [warehouseId]);
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `حذف مستودع`, module: 'المخزون والمستودعات', recordId: warehouseId });
    return { ok: true };
  }

  await withJsonTransaction(async (db) => {
    if (!db.warehouses.some((w) => w.id === warehouseId)) throw new AppError(404, 'المستودع غير موجود', 'WAREHOUSE_NOT_FOUND');
    if (db.invoices.some((i) => i.warehouseId === warehouseId)) {
      throw new AppError(409, 'لا يمكن حذف مستودع مرتبط بفواتير. يمكنك إيقافه بدلاً من الحذف.', 'WAREHOUSE_IN_USE');
    }
    db.warehouses = db.warehouses.filter((w) => w.id !== warehouseId);
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `حذف مستودع`, module: 'المخزون والمستودعات', recordId: warehouseId });
  return { ok: true };
}

export async function transferStock({ productId, fromWarehouseId, toWarehouseId, quantity, notes = '' }, actor) {
  const qty = round3(quantity);
  if (qty <= 0) throw new AppError(400, 'الكمية يجب أن تكون أكبر من صفر', 'INVALID_QUANTITY');
  if (fromWarehouseId === toWarehouseId) throw new AppError(400, 'لا يمكن التحويل إلى نفس المستودع', 'SAME_WAREHOUSE');
  const now = nowIso();
  const dateStr = todayIso();

  if (await isPgMode()) {
    await withTransaction(async (client) => {
      const pRes = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [productId]);
      const prod = pRes.rows[0];
      if (!prod) throw new AppError(404, 'الصنف غير موجود', 'PRODUCT_NOT_FOUND');
      const fromWh = (await client.query('SELECT id, name FROM warehouses WHERE id = $1', [fromWarehouseId])).rows[0];
      const toWh = (await client.query('SELECT id, name FROM warehouses WHERE id = $1', [toWarehouseId])).rows[0];
      if (!fromWh || !toWh) throw new AppError(404, 'المستودع غير موجود', 'WAREHOUSE_NOT_FOUND');

      const stockMap = { ...(prod.stock_per_warehouse || {}) };
      const curFrom = Number(stockMap[fromWarehouseId] || 0);
      if (curFrom < qty) throw new AppError(409, `الرصيد المتاح (${curFrom}) أقل من المطلوب للتحويل (${qty})`, 'INSUFFICIENT_STOCK');
      stockMap[fromWarehouseId] = round3(curFrom - qty);
      stockMap[toWarehouseId] = round3(Number(stockMap[toWarehouseId] || 0) + qty);
      await client.query('UPDATE products SET stock_per_warehouse = $1, updated_at = $2 WHERE id = $3', [JSON.stringify(stockMap), now, productId]);

      const mOutId = generateServerId('SM');
      const mInId = generateServerId('SM');
      const actorCtx = await resolveActorIdentityPgTx(client, actor);
      await client.query(
        `INSERT INTO stock_movements (id, movement_number, date, product_id, product_name, warehouse_id, warehouse_name, target_warehouse_id, target_warehouse_name, movement_type, quantity, unit, unit_factor, unit_cost, balance_after, notes, created_by_user_id, created_by, actor_identity_id, actor_employee_id, acting_role, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'transfer_out',$10,$11,1,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [mOutId, mOutId, dateStr, prod.id, prod.name, fromWh.id, fromWh.name, toWh.id, toWh.name, qty, prod.base_unit, prod.purchase_price, stockMap[fromWarehouseId], `تحويل صادر إلى ${toWh.name}: ${notes}`, actor.id, actor.fullName, actorCtx.actorIdentityId || null, actorCtx.actorEmployeeId || null, actorCtx.actingRole || actor.role || null, now]
      );
      await client.query(
        `INSERT INTO stock_movements (id, movement_number, date, product_id, product_name, warehouse_id, warehouse_name, target_warehouse_id, target_warehouse_name, movement_type, quantity, unit, unit_factor, unit_cost, balance_after, notes, created_by_user_id, created_by, actor_identity_id, actor_employee_id, acting_role, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'transfer_in',$10,$11,1,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [mInId, mInId, dateStr, prod.id, prod.name, toWh.id, toWh.name, fromWh.id, fromWh.name, qty, prod.base_unit, prod.purchase_price, stockMap[toWarehouseId], `تحويل وارد من ${fromWh.name}: ${notes}`, actor.id, actor.fullName, actorCtx.actorIdentityId || null, actorCtx.actorEmployeeId || null, actorCtx.actingRole || actor.role || null, now]
      );
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تحويل مخزني بين المستودعات`, module: 'المخزون والمستودعات', recordId: productId });
    return { ok: true };
  }

  await withJsonTransaction(async (db) => {
    const prod = db.products.find((p) => p.id === productId);
    if (!prod) throw new AppError(404, 'الصنف غير موجود', 'PRODUCT_NOT_FOUND');
    const fromWh = db.warehouses.find((w) => w.id === fromWarehouseId);
    const toWh = db.warehouses.find((w) => w.id === toWarehouseId);
    if (!fromWh || !toWh) throw new AppError(404, 'المستودع غير موجود', 'WAREHOUSE_NOT_FOUND');

    const curFrom = Number(prod.stockPerWarehouse?.[fromWarehouseId] || 0);
    if (curFrom < qty) throw new AppError(409, `الرصيد المتاح (${curFrom}) أقل من المطلوب للتحويل (${qty})`, 'INSUFFICIENT_STOCK');
    prod.stockPerWarehouse[fromWarehouseId] = round3(curFrom - qty);
    prod.stockPerWarehouse[toWarehouseId] = round3(Number(prod.stockPerWarehouse?.[toWarehouseId] || 0) + qty);

    const actorCtxJson = resolveActorIdentityJsonTx(db, actor);
    db.stockMovements.unshift(
      {
        id: generateServerId('SM'),
        date: dateStr,
        type: 'transfer_in',
        productId: prod.id,
        productName: prod.name,
        warehouseId: toWh.id,
        warehouseName: toWh.name,
        targetWarehouseId: fromWh.id,
        targetWarehouseName: fromWh.name,
        quantity: qty,
        unitCost: prod.purchasePrice,
        notes: `تحويل وارد من ${fromWh.name}: ${notes}`,
        createdByUserId: actor.id,
        createdBy: actor.fullName,
        actorIdentityId: actorCtxJson.actorIdentityId,
        actorEmployeeId: actorCtxJson.actorEmployeeId,
        actingRole: actorCtxJson.actingRole,
        createdAt: now,
      },
      {
        id: generateServerId('SM'),
        date: dateStr,
        type: 'transfer_out',
        productId: prod.id,
        productName: prod.name,
        warehouseId: fromWh.id,
        warehouseName: fromWh.name,
        targetWarehouseId: toWh.id,
        targetWarehouseName: toWh.name,
        quantity: qty,
        unitCost: prod.purchasePrice,
        notes: `تحويل صادر إلى ${toWh.name}: ${notes}`,
        createdByUserId: actor.id,
        createdBy: actor.fullName,
        actorIdentityId: actorCtxJson.actorIdentityId,
        actorEmployeeId: actorCtxJson.actorEmployeeId,
        actingRole: actorCtxJson.actingRole,
        createdAt: now,
      }
    );
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تحويل مخزني بين المستودعات`, module: 'المخزون والمستودعات', recordId: productId });
  return { ok: true };
}

export async function adjustStock({ productId, warehouseId, newQuantity, reason = '' }, actor) {
  if (!actor || actor.role === 'representative' || actor.role === 'customer') {
    throw new AppError(403, 'غير مصرح للمندوبين أو العملاء بإجراء تسويات جردية', 'FORBIDDEN_INVENTORY_ADJUSTMENT');
  }
  const nextQty = round3(newQuantity);
  const now = nowIso();
  const dateStr = todayIso();

  if (await isPgMode()) {
    await withTransaction(async (client) => {
      const pRes = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [productId]);
      const prod = pRes.rows[0];
      if (!prod) throw new AppError(404, 'الصنف غير موجود', 'PRODUCT_NOT_FOUND');
      const wh = (await client.query('SELECT id, name FROM warehouses WHERE id = $1', [warehouseId])).rows[0];
      if (!wh) throw new AppError(404, 'المستودع غير موجود', 'WAREHOUSE_NOT_FOUND');

      const stockMap = { ...(prod.stock_per_warehouse || {}) };
      const oldQty = Number(stockMap[warehouseId] || 0);
      const diff = round3(nextQty - oldQty);
      stockMap[warehouseId] = nextQty;
      await client.query('UPDATE products SET stock_per_warehouse = $1, updated_at = $2 WHERE id = $3', [JSON.stringify(stockMap), now, productId]);

      const mvId = generateServerId('SM');
      const actorCtx = await resolveActorIdentityPgTx(client, actor);
      await client.query(
        `INSERT INTO stock_movements (id, movement_number, date, product_id, product_name, warehouse_id, warehouse_name, movement_type, quantity, unit, unit_factor, unit_cost, balance_after, notes, created_by_user_id, created_by, actor_identity_id, actor_employee_id, acting_role, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'adjustment',$8,$9,1,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [mvId, mvId, dateStr, prod.id, prod.name, wh.id, wh.name, Math.abs(diff), prod.base_unit, prod.purchase_price, nextQty, `تسوية جردية: الفرق (${diff > 0 ? '+' : ''}${diff}) - ${reason}`, actor.id, actor.fullName, actorCtx.actorIdentityId || null, actorCtx.actorEmployeeId || null, actorCtx.actingRole || actor.role || null, now]
      );
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تسوية جردية (${reason})`, module: 'المخزون والمستودعات', recordId: productId });
    return { ok: true };
  }

  await withJsonTransaction(async (db) => {
    const prod = db.products.find((p) => p.id === productId);
    const wh = db.warehouses.find((w) => w.id === warehouseId);
    if (!prod || !wh) throw new AppError(404, 'الصنف أو المستودع غير موجود', 'NOT_FOUND');
    const oldQty = Number(prod.stockPerWarehouse?.[warehouseId] || 0);
    const diff = round3(nextQty - oldQty);
    prod.stockPerWarehouse[warehouseId] = nextQty;
    const actorCtxJson = resolveActorIdentityJsonTx(db, actor);
    db.stockMovements.unshift({
      id: generateServerId('SM'),
      date: dateStr,
      type: 'adjustment',
      productId: prod.id,
      productName: prod.name,
      warehouseId: wh.id,
      warehouseName: wh.name,
      quantity: Math.abs(diff),
      unitCost: prod.purchasePrice,
      notes: `تسوية جردية: الفرق (${diff > 0 ? '+' : ''}${diff}) - ${reason}`,
      createdByUserId: actor.id,
      createdBy: actor.fullName,
      actorIdentityId: actorCtxJson.actorIdentityId,
      actorEmployeeId: actorCtxJson.actorEmployeeId,
      actingRole: actorCtxJson.actingRole,
      createdAt: now,
    });
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تسوية جردية (${reason})`, module: 'المخزون والمستودعات', recordId: productId });
  return { ok: true };
}

export async function recordDamagedStock({ productId, warehouseId, quantity, reason = '' }, actor) {
  if (!actor || actor.role === 'representative' || actor.role === 'customer') {
    throw new AppError(403, 'غير مصرح للمندوبين أو العملاء بإثبات التوالف', 'FORBIDDEN_INVENTORY_DAMAGED');
  }
  const qty = round3(quantity);
  if (qty <= 0) throw new AppError(400, 'الكمية التالفة يجب أن تكون أكبر من صفر', 'INVALID_QUANTITY');
  const now = nowIso();
  const dateStr = todayIso();

  if (await isPgMode()) {
    await withTransaction(async (client) => {
      const pRes = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [productId]);
      const prod = pRes.rows[0];
      if (!prod) throw new AppError(404, 'الصنف غير موجود', 'PRODUCT_NOT_FOUND');
      const wh = (await client.query('SELECT id, name FROM warehouses WHERE id = $1', [warehouseId])).rows[0];
      if (!wh) throw new AppError(404, 'المستودع غير موجود', 'WAREHOUSE_NOT_FOUND');

      const stockMap = { ...(prod.stock_per_warehouse || {}) };
      const curQty = Number(stockMap[warehouseId] || 0);
      const nextQty = round3(Math.max(0, curQty - qty));
      stockMap[warehouseId] = nextQty;
      await client.query('UPDATE products SET stock_per_warehouse = $1, updated_at = $2 WHERE id = $3', [JSON.stringify(stockMap), now, productId]);

      const mvId = generateServerId('SM');
      const actorCtx = await resolveActorIdentityPgTx(client, actor);
      await client.query(
        `INSERT INTO stock_movements (id, movement_number, date, product_id, product_name, warehouse_id, warehouse_name, movement_type, quantity, unit, unit_factor, unit_cost, balance_after, notes, created_by_user_id, created_by, actor_identity_id, actor_employee_id, acting_role, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'damaged',$8,$9,1,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [mvId, mvId, dateStr, prod.id, prod.name, wh.id, wh.name, qty, prod.base_unit, prod.purchase_price, nextQty, `توالف ومنتهي الصلاحية: ${reason}`, actor.id, actor.fullName, actorCtx.actorIdentityId || null, actorCtx.actorEmployeeId || null, actorCtx.actingRole || actor.role || null, now]
      );
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إثبات توالف (${qty})`, module: 'المخزون والمستودعات', recordId: productId });
    return { ok: true };
  }

  await withJsonTransaction(async (db) => {
    const prod = db.products.find((p) => p.id === productId);
    const wh = db.warehouses.find((w) => w.id === warehouseId);
    if (!prod || !wh) throw new AppError(404, 'الصنف أو المستودع غير موجود', 'NOT_FOUND');
    const curQty = Number(prod.stockPerWarehouse?.[warehouseId] || 0);
    prod.stockPerWarehouse[warehouseId] = round3(Math.max(0, curQty - qty));
    const actorCtxJson = resolveActorIdentityJsonTx(db, actor);
    db.stockMovements.unshift({
      id: generateServerId('SM'),
      date: dateStr,
      type: 'damaged',
      productId: prod.id,
      productName: prod.name,
      warehouseId: wh.id,
      warehouseName: wh.name,
      quantity: qty,
      unitCost: prod.purchasePrice,
      notes: `توالف ومنتهي الصلاحية: ${reason}`,
      createdByUserId: actor.id,
      createdBy: actor.fullName,
      actorIdentityId: actorCtxJson.actorIdentityId,
      actorEmployeeId: actorCtxJson.actorEmployeeId,
      actingRole: actorCtxJson.actingRole,
      createdAt: now,
    });
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إثبات توالف (${qty})`, module: 'المخزون والمستودعات', recordId: productId });
  return { ok: true };
}

// ==============================================================================
// Rep Financial Transfers ("تحويل بالنصف") & Rep Item Transfers
// ==============================================================================

export async function createRepTransfer(payload, actor) {
  if (!actor || actor.role === 'customer') {
    throw new AppError(403, 'غير مصرح للعملاء بإنشاء تحويلات مناديب', 'FORBIDDEN');
  }
  const direction = String(payload?.direction || '').trim();
  if (direction !== 'rep_to_owner' && direction !== 'owner_to_rep') {
    throw new AppError(400, 'اتجاه التحويل غير صالح', 'INVALID_TRANSFER_DIRECTION');
  }
  const repActor = actor.role === 'representative' ? await getRepresentativeByUserId(actor.id) : null;
  if (actor.role === 'representative') {
    if (!repActor) {
      throw new AppError(403, 'حساب المندوب غير مربوط بملف مندوب مسجل', 'REP_PROFILE_REQUIRED');
    }
    if (direction !== 'rep_to_owner') {
      throw new AppError(403, 'يمكن للمندوب إنشاء توريد نقدية للخزينة الرئيسية فقط', 'FORBIDDEN_REP_TRANSFER_DIRECTION');
    }
  } else if (actor.role !== 'admin' && !actor.permissions?.canManageTransfers && !actor.permissions?.canManageReps) {
    throw new AppError(403, 'ليس لديك صلاحية إنشاء تحويل مندوب', 'FORBIDDEN_PERMISSION');
  }

  const amount = round2(payload.amount);
  if (amount <= 0) throw new AppError(400, 'مبلغ التحويل يجب أن يكون أكبر من صفر', 'INVALID_AMOUNT');
  const now = nowIso();
  const dateStr = todayIso();
  const id = generateServerId('TRN');
  const transferNumber = `TRN-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`;
  const auditEntry = { timestamp: now, action: 'إنشاء طلب التحويل بالنصف وإرساله للطرف الآخر', user: actor.fullName, note: payload.notes || '' };

  if (await isPgMode()) {
    const created = await withTransaction(async (client) => {
      let cb = null;
      if (repActor) {
        cb = (await client.query('SELECT id, name FROM cashboxes ORDER BY is_default DESC, id ASC LIMIT 1')).rows[0];
      } else {
        const reqCbId = String(payload.cashboxId || '').trim();
        cb = reqCbId
          ? (await client.query('SELECT id, name FROM cashboxes WHERE id = $1 LIMIT 1', [reqCbId])).rows[0]
          : null;
      }
      if (!cb) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');

      let repRow = repActor;
      if (!repRow) {
        const reqRepId = String(direction === 'rep_to_owner' ? (payload.senderId || payload.representativeId || '') : (payload.receiverId || payload.representativeId || '')).trim();
        repRow = reqRepId
          ? (await client.query('SELECT id, name FROM representatives WHERE id = $1 LIMIT 1', [reqRepId])).rows[0]
          : null;
        if (!repRow) throw new AppError(404, 'المندوب غير موجود', 'REPRESENTATIVE_NOT_FOUND');
      }

      const senderId = direction === 'rep_to_owner' ? repRow.id : 'OWNER';
      const senderName = direction === 'rep_to_owner' ? repRow.name : 'الفرع الرئيسي (الخزينة)';
      const receiverId = direction === 'rep_to_owner' ? 'OWNER' : repRow.id;
      const receiverName = direction === 'rep_to_owner' ? 'الفرع الرئيسي (الخزينة)' : repRow.name;

      const actorCtx = await resolveActorIdentityPgTx(client, actor);
      await client.query(
        `INSERT INTO rep_transfers (id, transfer_number, representative_id, representative_name, direction, sender_id, sender_name, receiver_id, receiver_name, type, amount, cashbox_id, cashbox_name, date, status, notes, sent_at, audit_trail, created_by, actor_identity_id, actor_employee_id, acting_role, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$5,$10,$11,$12,$13,'awaiting_receipt',$14,$15,$16,$17,$18,$19,$20,$15)`,
        [
          id,
          transferNumber,
          repRow.id,
          repRow.name,
          direction,
          senderId,
          senderName,
          receiverId,
          receiverName,
          amount,
          cb.id,
          cb.name,
          dateStr,
          payload.notes || '',
          now,
          JSON.stringify([auditEntry]),
          actor.fullName,
          actorCtx.actorIdentityId || null,
          actorCtx.actorEmployeeId || null,
          actorCtx.actingRole || actor.role || null,
        ]
      );
      return {
        id,
        transferNumber,
        representativeId: repRow.id,
        representativeName: repRow.name,
        date: dateStr,
        timestamp: now,
        direction,
        senderId,
        senderName,
        receiverId,
        receiverName,
        amount,
        cashboxId: cb.id,
        cashboxName: cb.name,
        notes: payload.notes || '',
        status: 'awaiting_receipt',
        sentAt: now,
        actorIdentityId: actorCtx.actorIdentityId || undefined,
        actorEmployeeId: actorCtx.actorEmployeeId || undefined,
        actingRole: actorCtx.actingRole || actor.role || undefined,
        auditTrail: [auditEntry],
      };
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إنشاء طلب تحويل بالنصف (${transferNumber})`, module: 'المندوبون', recordId: id });
    return created;
  }

  const created = await withJsonTransaction(async (db) => {
    const cb = repActor
      ? ((db.cashboxes || []).find((c) => c.isDefault) || (db.cashboxes || [])[0])
      : (db.cashboxes || []).find((c) => c.id === payload.cashboxId);
    if (!cb) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');

    let repRow = repActor;
    if (!repRow) {
      const reqRepId = String(direction === 'rep_to_owner' ? (payload.senderId || payload.representativeId || '') : (payload.receiverId || payload.representativeId || '')).trim();
      repRow = (db.representatives || []).find((r) => r.id === reqRepId);
      if (!repRow) throw new AppError(404, 'المندوب غير موجود', 'REPRESENTATIVE_NOT_FOUND');
    }

    const senderId = direction === 'rep_to_owner' ? repRow.id : 'OWNER';
    const senderName = direction === 'rep_to_owner' ? repRow.name : 'الفرع الرئيسي (الخزينة)';
    const receiverId = direction === 'rep_to_owner' ? 'OWNER' : repRow.id;
    const receiverName = direction === 'rep_to_owner' ? 'الفرع الرئيسي (الخزينة)' : repRow.name;

    const actorCtxJson = resolveActorIdentityJsonTx(db, actor);
    const item = {
      id,
      transferNumber,
      representativeId: repRow.id,
      representativeName: repRow.name,
      date: dateStr,
      timestamp: now,
      direction,
      senderId,
      senderName,
      receiverId,
      receiverName,
      amount,
      cashboxId: cb.id,
      cashboxName: cb.name,
      notes: payload.notes || '',
      status: 'awaiting_receipt',
      sentAt: now,
      actorIdentityId: actorCtxJson.actorIdentityId,
      actorEmployeeId: actorCtxJson.actorEmployeeId,
      actingRole: actorCtxJson.actingRole,
      auditTrail: [auditEntry],
    };
    db.repTransfers.unshift(item);
    return item;
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إنشاء طلب تحويل بالنصف (${transferNumber})`, module: 'المندوبون', recordId: id });
  return created;
}

export async function confirmRepTransfer(transferId, { note = '' } = {}, actor) {
  if (!actor || actor.role === 'customer') {
    throw new AppError(403, 'غير مصرح للعملاء باعتماد تحويلات المناديب', 'FORBIDDEN');
  }
  const repActor = actor.role === 'representative' ? await getRepresentativeByUserId(actor.id) : null;
  if (actor.role === 'representative' && !repActor) {
    throw new AppError(403, 'حساب المندوب غير مربوط بملف مندوب مسجل', 'REP_PROFILE_REQUIRED');
  }
  if (
    actor.role !== 'representative' &&
    actor.role !== 'admin' &&
    !actor.permissions?.canManageTransfers &&
    !actor.permissions?.canManageCashboxes &&
    !actor.permissions?.canManageAccounts
  ) {
    throw new AppError(403, 'ليس لديك صلاحية اعتماد تحويل المندوب', 'FORBIDDEN_PERMISSION');
  }

  const now = nowIso();
  const dateStr = todayIso();

  if (await isPgMode()) {
    await withTransaction(async (client) => {
      const trRes = await client.query('SELECT * FROM rep_transfers WHERE id = $1 FOR UPDATE', [transferId]);
      const tr = trRes.rows[0];
      if (!tr) throw new AppError(404, 'طلب التحويل غير موجود', 'TRANSFER_NOT_FOUND');

      if (tr.direction === 'rep_to_owner') {
        if (actor.role === 'representative') {
          throw new AppError(403, 'لا يمكن للمندوب اعتماد استلام توريده للخزينة بنفسه', 'FORBIDDEN_SELF_CONFIRM_TRANSFER');
        }
      } else if (tr.direction === 'owner_to_rep') {
        if (actor.role === 'representative') {
          const isTargetRep = tr.receiver_id === repActor.id || tr.representative_id === repActor.id;
          if (!isTargetRep) {
            throw new AppError(403, 'غير مصرح لك بتأكيد استلام عهدة تخص مندوبًا آخر', 'FORBIDDEN_REP_TRANSFER_ACCESS');
          }
        }
      }

      if (tr.status === 'received') throw new AppError(409, 'تم تأكيد استلام التحويل مسبقًا', 'ALREADY_RECEIVED');
      if (tr.status === 'rejected' || tr.status === 'cancelled') throw new AppError(409, 'لا يمكن تأكيد تحويل مرفوض أو ملغى', 'INVALID_STATUS');

      const cbRes = await client.query('SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE', [tr.cashbox_id]);
      if (!cbRes.rows[0]) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');
      const cb = cbRes.rows[0];
      const amount = Number(tr.amount || 0);
      const repId = tr.direction === 'rep_to_owner' ? tr.sender_id : tr.receiver_id;

      if (repId) {
        const repRes = await client.query('SELECT * FROM representatives WHERE id = $1 FOR UPDATE', [repId]);
        if (repRes.rows[0]) {
          const curRepBal = Number(repRes.rows[0].current_balance || 0);
          const nextRepBal = tr.direction === 'rep_to_owner' ? round2(curRepBal - amount) : round2(curRepBal + amount);
          await client.query('UPDATE representatives SET current_balance = $1 WHERE id = $2', [nextRepBal, repId]);
        }
      }

      const nextCb = tr.direction === 'rep_to_owner' ? round2(Number(cb.current_balance || 0) + amount) : round2(Number(cb.current_balance || 0) - amount);
      await client.query('UPDATE cashboxes SET current_balance = $1 WHERE id = $2', [nextCb, cb.id]);

      const txId = generateServerId('FT');
      const actorCtx = await resolveActorIdentityPgTx(client, actor);
      await client.query(
        `INSERT INTO financial_transactions (id, transaction_number, date, type, amount, cashbox_id, cashbox_name, balance_after, category, related_entity_id, related_entity_name, related_doc_type, related_doc_id, related_doc_number, description, notes, created_by_user_id, created_by, actor_identity_id, actor_employee_id, acting_role, created_at)
         VALUES ($1,$2,$3,'rep_transfer',$4,$5,$6,$7,$8,$9,$10,'rep_transfer',$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [
          txId,
          `TRX-${Date.now().toString().slice(-6)}`,
          dateStr,
          amount,
          cb.id,
          cb.name,
          nextCb,
          tr.direction === 'rep_to_owner' ? 'توريد تحصيلات مندوب' : 'صرف عهدة ونقدية لمندوب',
          repId || null,
          tr.direction === 'rep_to_owner' ? tr.sender_name : tr.receiver_name,
          tr.id,
          tr.transfer_number,
          `اعتماد طلب تحويل بالنصف رقم ${tr.transfer_number}`,
          note || tr.notes || '',
          actor.id,
          actor.fullName,
          actorCtx.actorIdentityId || null,
          actorCtx.actorEmployeeId || null,
          actorCtx.actingRole || actor.role || null,
          now,
        ]
      );

      const nextAudit = [...(tr.audit_trail || []), { timestamp: now, action: 'تأكيد الاستلام الفعلي واعتماد القيود', user: actor.fullName, note }];
      await client.query(
        `UPDATE rep_transfers SET status = 'received', confirmed_at = $1, confirmed_by = $2, audit_trail = $3 WHERE id = $4`,
        [now, actor.fullName, JSON.stringify(nextAudit), transferId]
      );
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تأكيد استلام تحويل مندوب`, module: 'المندوبون', recordId: transferId });
    return { ok: true };
  }

  await withJsonTransaction(async (db) => {
    const tr = db.repTransfers.find((t) => t.id === transferId);
    if (!tr) throw new AppError(404, 'طلب التحويل غير موجود', 'TRANSFER_NOT_FOUND');

    if (tr.direction === 'rep_to_owner') {
      if (actor.role === 'representative') {
        throw new AppError(403, 'لا يمكن للمندوب اعتماد استلام توريده للخزينة بنفسه', 'FORBIDDEN_SELF_CONFIRM_TRANSFER');
      }
    } else if (tr.direction === 'owner_to_rep') {
      if (actor.role === 'representative') {
        const isTargetRep = tr.receiverId === repActor.id || tr.representativeId === repActor.id;
        if (!isTargetRep) {
          throw new AppError(403, 'غير مصرح لك بتأكيد استلام عهدة تخص مندوبًا آخر', 'FORBIDDEN_REP_TRANSFER_ACCESS');
        }
      }
    }

    if (tr.status === 'received') throw new AppError(409, 'تم تأكيد استلام التحويل مسبقًا', 'ALREADY_RECEIVED');
    if (tr.status === 'rejected' || tr.status === 'cancelled') throw new AppError(409, 'لا يمكن تأكيد تحويل مرفوض أو ملغى', 'INVALID_STATUS');

    const cb = db.cashboxes.find((c) => c.id === tr.cashboxId);
    if (!cb) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');
    const repId = tr.direction === 'rep_to_owner' ? tr.senderId : tr.receiverId;
    const rep = db.representatives.find((r) => r.id === repId);
    if (rep) {
      rep.currentBalance = tr.direction === 'rep_to_owner' ? round2(rep.currentBalance - tr.amount) : round2(rep.currentBalance + tr.amount);
    }
    cb.currentBalance = tr.direction === 'rep_to_owner' ? round2(cb.currentBalance + tr.amount) : round2(cb.currentBalance - tr.amount);
    const actorCtxJson = resolveActorIdentityJsonTx(db, actor);
    db.financialTransactions.unshift({
      id: generateServerId('FT'),
      transactionNumber: `TRX-${Date.now().toString().slice(-6)}`,
      date: dateStr,
      type: 'rep_transfer',
      cashboxId: cb.id,
      cashboxName: cb.name,
      balanceAfter: cb.currentBalance,
      amount: tr.amount,
      category: tr.direction === 'rep_to_owner' ? 'توريد تحصيلات مندوب' : 'صرف عهدة ونقدية لمندوب',
      relatedDocType: 'rep_transfer',
      relatedDocId: tr.id,
      relatedDocNumber: tr.transferNumber,
      relatedEntityId: repId || undefined,
      partyId: repId || undefined,
      partyName: tr.direction === 'rep_to_owner' ? tr.senderName : tr.receiverName,
      description: `اعتماد طلب تحويل بالنصف رقم ${tr.transferNumber}`,
      notes: note || tr.notes || '',
      createdByUserId: actor.id,
      createdBy: actor.fullName,
      actorIdentityId: actorCtxJson.actorIdentityId,
      actorEmployeeId: actorCtxJson.actorEmployeeId,
      actingRole: actorCtxJson.actingRole,
      createdAt: now,
    });
    tr.status = 'received';
    tr.confirmedAt = now;
    tr.confirmedBy = actor.fullName;
    tr.auditTrail = [...(tr.auditTrail || []), { timestamp: now, action: 'تأكيد الاستلام الفعلي واعتماد القيود', user: actor.fullName, note }];
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تأكيد استلام تحويل مندوب`, module: 'المندوبون', recordId: transferId });
  return { ok: true };
}

export async function rejectRepTransfer(transferId, { reason = '' } = {}, actor) {
  if (!actor || actor.role === 'customer') {
    throw new AppError(403, 'غير مصرح للعملاء برفض تحويلات المناديب', 'FORBIDDEN');
  }
  const repActor = actor.role === 'representative' ? await getRepresentativeByUserId(actor.id) : null;
  if (actor.role === 'representative' && !repActor) {
    throw new AppError(403, 'حساب المندوب غير مربوط بملف مندوب مسجل', 'REP_PROFILE_REQUIRED');
  }
  if (actor.role !== 'representative' && actor.role !== 'admin' && !actor.permissions?.canManageTransfers) {
    throw new AppError(403, 'ليس لديك صلاحية رفض التحويل', 'FORBIDDEN_PERMISSION');
  }

  const now = nowIso();
  const cleanReason = String(reason || 'مرفوض').trim();
  if (await isPgMode()) {
    await withTransaction(async (client) => {
      const trRes = await client.query('SELECT * FROM rep_transfers WHERE id = $1 FOR UPDATE', [transferId]);
      const tr = trRes.rows[0];
      if (!tr) throw new AppError(404, 'طلب التحويل غير موجود', 'TRANSFER_NOT_FOUND');
      if (actor.role === 'representative') {
        const isOwner = tr.sender_id === repActor.id || tr.receiver_id === repActor.id || tr.representative_id === repActor.id;
        if (!isOwner) {
          throw new AppError(403, 'غير مصرح لك برفض تحويل يخص مندوبًا آخر', 'FORBIDDEN_REP_TRANSFER_ACCESS');
        }
      }
      if (tr.status === 'received') throw new AppError(409, 'تم تأكيد استلام التحويل مسبقًا ولا يمكن رفضه', 'ALREADY_RECEIVED');
      const nextAudit = [...(tr.audit_trail || []), { timestamp: now, action: 'رفض طلب التحويل', user: actor.fullName, note: cleanReason }];
      await client.query(`UPDATE rep_transfers SET status = 'rejected', rejected_at = $1, rejection_reason = $2, audit_trail = $3 WHERE id = $4`, [
        now,
        cleanReason,
        JSON.stringify(nextAudit),
        transferId,
      ]);
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `رفض طلب تحويل مندوب`, module: 'المندوبون', recordId: transferId, notes: cleanReason });
    return { ok: true };
  }
  await withJsonTransaction(async (db) => {
    const tr = db.repTransfers.find((t) => t.id === transferId);
    if (!tr) throw new AppError(404, 'طلب التحويل غير موجود', 'TRANSFER_NOT_FOUND');
    if (actor.role === 'representative') {
      const isOwner = tr.senderId === repActor.id || tr.receiverId === repActor.id || tr.representativeId === repActor.id;
      if (!isOwner) {
        throw new AppError(403, 'غير مصرح لك برفض تحويل يخص مندوبًا آخر', 'FORBIDDEN_REP_TRANSFER_ACCESS');
      }
    }
    if (tr.status === 'received') throw new AppError(409, 'تم تأكيد استلام التحويل مسبقًا ولا يمكن رفضه', 'ALREADY_RECEIVED');
    tr.status = 'rejected';
    tr.rejectedAt = now;
    tr.rejectionReason = cleanReason;
    tr.auditTrail = [...(tr.auditTrail || []), { timestamp: now, action: 'رفض طلب التحويل', user: actor.fullName, note: cleanReason }];
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `رفض طلب تحويل مندوب`, module: 'المندوبون', recordId: transferId, notes: cleanReason });
  return { ok: true };
}

export async function ensureRepVanWarehouse(repName, actor, repId = null) {
  const cleanName = String(repName || '').trim();
  const name = `سيارة المندوب - ${cleanName}`;
  if (await isPgMode()) {
    const existing = await getPool().query('SELECT * FROM warehouses WHERE name = $1 LIMIT 1', [name]);
    let wh;
    if (existing.rows[0]) {
      const w = existing.rows[0];
      wh = { id: w.id, name: w.name, code: w.code, location: w.location || '', isDefault: false, status: w.status };
    } else {
      wh = await createWarehouse({ name, code: `VAN-${Date.now().toString().slice(-4)}`, location: 'مخزون سيارة مندوب', managerName: cleanName, isDefault: false }, actor);
    }
    if (repId) {
      await getPool().query('UPDATE representatives SET warehouse_id = $1 WHERE id = $2 AND (warehouse_id IS NULL OR warehouse_id = \'\')', [wh.id, repId]);
    } else if (cleanName) {
      await getPool().query('UPDATE representatives SET warehouse_id = $1 WHERE name = $2 AND (warehouse_id IS NULL OR warehouse_id = \'\')', [wh.id, cleanName]);
    }
    return wh;
  }
  const db = readJsonDatabase();
  let wh = db.warehouses.find((w) => w.name === name);
  if (!wh) {
    wh = await createWarehouse({ name, code: `VAN-${Date.now().toString().slice(-4)}`, location: 'مخزون سيارة مندوب', managerName: cleanName, isDefault: false }, actor);
  }
  await withJsonTransaction((ledger) => {
    const rep = ledger.representatives.find((r) => (repId ? r.id === repId : r.name === cleanName));
    if (rep && !rep.warehouseId) rep.warehouseId = wh.id;
  });
  return wh;
}

export async function createRepItemTransfer(payload, actor) {
  const id = generateServerId('RTR');
  const requestNumber = `RTR-${Date.now().toString().slice(-5)}-${Math.floor(Math.random() * 90 + 10)}`;
  const now = nowIso();
  const dateStr = payload.date || todayIso();
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) throw new AppError(400, 'يجب تحديد صنف واحد على الأقل للتحويل', 'EMPTY_ITEMS');

  const transferMode = payload.transferMode === 'custody_dispatch' ? 'custody_dispatch' : 'transfer';

  let representativeId = payload.representativeId;
  let representativeName = payload.representativeName;
  let repTargetWhId = payload.targetWarehouseId;
  let repTargetWhName = payload.targetWarehouseName;

  if (actor.role === 'representative') {
    const repProfile = await getRepresentativeByUserId(actor.id);
    if (!repProfile) throw new AppError(403, 'حساب المندوب غير مربوط بملف مندوب مسجل', 'REP_PROFILE_REQUIRED');
    representativeId = repProfile.id;
    representativeName = repProfile.name;
    if (transferMode === 'custody_dispatch') {
      throw new AppError(403, 'صرف العهدة المباشر متاح للإدارة فقط', 'FORBIDDEN_CUSTODY_DISPATCH');
    }
  } else if (transferMode === 'custody_dispatch' && (!repTargetWhId || !representativeName) && representativeId) {
    if (await isPgMode()) {
      const rRow = (await getPool().query('SELECT * FROM representatives WHERE id = $1 LIMIT 1', [representativeId])).rows[0];
      if (!rRow) throw new AppError(404, 'المندوب المحدد غير موجود', 'REP_NOT_FOUND');
      representativeName = representativeName || rRow.name;
      repTargetWhId = repTargetWhId || rRow.warehouse_id;
    } else {
      const db = readJsonDatabase();
      const rRow = (db.representatives || []).find((r) => r.id === representativeId);
      if (!rRow) throw new AppError(404, 'المندوب المحدد غير موجود', 'REP_NOT_FOUND');
      representativeName = representativeName || rRow.name;
      repTargetWhId = repTargetWhId || rRow.warehouseId;
    }
    if (!repTargetWhId) {
      const van = await ensureRepVanWarehouse(representativeName, actor, representativeId);
      repTargetWhId = van.id;
      repTargetWhName = van.name;
    }
  }

  let srcWhId = payload.sourceWarehouseId;
  let srcWhName = payload.sourceWarehouseName;

  if (await isPgMode()) {
    if (!srcWhName && srcWhId) {
      const wRow = (await getPool().query('SELECT id, name FROM warehouses WHERE id = $1', [srcWhId])).rows[0];
      if (wRow) srcWhName = wRow.name;
    }
    if (!repTargetWhName && repTargetWhId) {
      const wRow = (await getPool().query('SELECT id, name FROM warehouses WHERE id = $1', [repTargetWhId])).rows[0];
      if (wRow) repTargetWhName = wRow.name;
    }
    await withTransaction(async (client) => {
      const actorCtx = await resolveActorIdentityPgTx(client, actor);
      await client.query(
        `INSERT INTO rep_item_transfers (id, request_number, date, representative_id, representative_name, invoice_id, invoice_number, source_warehouse_id, source_warehouse_name, target_warehouse_id, target_warehouse_name, transfer_mode, status, notes, created_by, actor_identity_id, actor_employee_id, acting_role, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',$13,$14,$15,$16,$17,$18)`,
        [
          id,
          requestNumber,
          dateStr,
          representativeId,
          representativeName,
          payload.invoiceId || null,
          payload.invoiceNumber || null,
          srcWhId,
          srcWhName || '',
          repTargetWhId,
          repTargetWhName || '',
          transferMode,
          payload.notes || '',
          actor.fullName,
          actorCtx.actorIdentityId || null,
          actorCtx.actorEmployeeId || null,
          actorCtx.actingRole || actor.role || null,
          now,
        ]
      );
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        await client.query(
          `INSERT INTO rep_item_transfer_items (id, transfer_id, product_id, product_name, barcode, unit, requested_qty, available_in_van_qty, shortage_qty, approved_qty, executed_qty)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            `${id}-RITI-${i + 1}`,
            id,
            it.productId,
            it.productName,
            it.barcode || '',
            it.unit || 'قطعة',
            Number(it.requestedQty || 0),
            Number(it.availableInVanQty || 0),
            Number(it.shortageQty || 0),
            it.approvedQty ?? null,
            it.executedQty ?? null,
          ]
        );
      }
      if (payload.invoiceId) {
        await client.query(
          `UPDATE invoices SET linked_rep_transfer_id = $1, linked_rep_transfer_number = $2, updated_at = $3 WHERE id = $4`,
          [id, requestNumber, now, payload.invoiceId]
        );
      }
    });
  } else {
    await withJsonTransaction(async (db) => {
      if (!srcWhName && srcWhId) {
        srcWhName = db.warehouses.find((w) => w.id === srcWhId)?.name || '';
      }
      if (!repTargetWhName && repTargetWhId) {
        repTargetWhName = db.warehouses.find((w) => w.id === repTargetWhId)?.name || '';
      }
      const actorCtxJson = resolveActorIdentityJsonTx(db, actor);
      const reqObj = {
        ...payload,
        representativeId,
        representativeName,
        sourceWarehouseId: srcWhId,
        sourceWarehouseName: srcWhName || '',
        targetWarehouseId: repTargetWhId,
        targetWarehouseName: repTargetWhName || '',
        transferMode,
        id,
        requestNumber,
        date: dateStr,
        status: 'pending',
        createdBy: actor.fullName,
        actorIdentityId: actorCtxJson.actorIdentityId,
        actorEmployeeId: actorCtxJson.actorEmployeeId,
        actingRole: actorCtxJson.actingRole,
        createdAt: now,
      };
      db.repItemTransfers.unshift(reqObj);
      if (payload.invoiceId) {
        const inv = db.invoices.find((i) => i.id === payload.invoiceId);
        if (inv) {
          inv.linkedRepTransferId = id;
          inv.linkedRepTransferNumber = requestNumber;
        }
      }
    });
  }

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action:
      transferMode === 'custody_dispatch'
        ? `إنشاء إرسال عهدة بضاعة للمندوب ${representativeName} (${requestNumber})`
        : `إنشاء طلب تحويل أصناف للمندوب (${requestNumber})`,
    module: 'المندوبون',
    recordId: id,
  });

  if (transferMode === 'custody_dispatch' && payload.autoDispatch === true) {
    await updateRepItemTransferStatus(id, { status: 'executed', notes: payload.notes || '' }, actor);
  }

  return {
    ...payload,
    representativeId,
    representativeName,
    sourceWarehouseId: srcWhId,
    sourceWarehouseName: srcWhName || '',
    targetWarehouseId: repTargetWhId,
    targetWarehouseName: repTargetWhName || '',
    transferMode,
    id,
    requestNumber,
    date: dateStr,
    status: transferMode === 'custody_dispatch' && payload.autoDispatch === true ? 'executed' : 'pending',
    dispatchedBy: transferMode === 'custody_dispatch' && payload.autoDispatch === true ? actor.fullName : undefined,
    dispatchedAt: transferMode === 'custody_dispatch' && payload.autoDispatch === true ? nowIso() : undefined,
    createdBy: actor.fullName,
    createdAt: now,
  };
}

export async function updateRepItemTransferStatus(requestId, { status, approvedItems, notes }, actor) {
  const allowedStatuses = new Set(['approved', 'rejected', 'executed', 'received']);
  if (!allowedStatuses.has(status)) {
    throw new AppError(400, 'حالة طلب التحويل غير صالحة', 'INVALID_TRANSFER_STATUS');
  }

  const isRepActor = actor.role === 'representative';
  let repActorProfile = null;
  if (isRepActor) {
    if (status !== 'received') {
      throw new AppError(
        403,
        'غير مصرح للمندوب باعتماد أو تنفيذ أو رفض طلب تحويل الأصناف — يقتصر دوره على تأكيد الاستلام الفعلي فقط.',
        'FORBIDDEN_REP_TRANSFER_APPROVAL'
      );
    }
    repActorProfile = await getRepresentativeByUserId(actor.id);
    if (!repActorProfile) {
      throw new AppError(403, 'حساب المندوب غير مربوط بملف مندوب مسجل', 'REP_PROFILE_REQUIRED');
    }
  } else {
    const canManage = actor.role === 'admin' || Boolean(actor.permissions?.canManageTransfers);
    if (!canManage) {
      throw new AppError(403, 'ليس لديك صلاحية اعتماد أو تنفيذ تحويلات المندوبين', 'FORBIDDEN_TRANSFER_PERMISSION');
    }
  }

  const now = nowIso();
  const dateStr = todayIso();

  if (await isPgMode()) {
    await withTransaction(async (client) => {
      const rRes = await client.query('SELECT * FROM rep_item_transfers WHERE id = $1 FOR UPDATE', [requestId]);
      const req = rRes.rows[0];
      if (!req) throw new AppError(404, 'طلب التحويل غير موجود', 'NOT_FOUND');

      const isCustodyDispatch = req.transfer_mode === 'custody_dispatch';

      if (isRepActor) {
        if (req.representative_id !== repActorProfile.id) {
          throw new AppError(403, 'غير مصرح لك بتأكيد استلام تحويل يخص مندوباً آخر', 'FORBIDDEN_REP_TRANSFER_OWNER');
        }
        if (req.status !== 'executed') {
          throw new AppError(409, 'لا يمكن تأكيد الاستلام قبل تنفيذ التحويل من الإدارة أولاً', 'TRANSFER_NOT_EXECUTED_YET');
        }
      } else {
        if (req.status === 'received') {
          throw new AppError(409, 'تم استلام هذا التحويل بالفعل ولا يمكن تعديله', 'TRANSFER_ALREADY_RECEIVED');
        }
      }

      const itemsRes = await client.query('SELECT * FROM rep_item_transfer_items WHERE transfer_id = $1', [requestId]);
      const stRes = await client.query('SELECT allow_negative_stock FROM system_settings LIMIT 1');
      const allowNeg = Boolean(stRes.rows[0]?.allow_negative_stock);
      const actorCtx = await resolveActorIdentityPgTx(client, actor);

      if (status === 'executed' && req.status !== 'executed' && req.status !== 'received') {
        const origByProduct = new Map(itemsRes.rows.map((r) => [r.product_id, r]));
        const itemsToMove =
          approvedItems ||
          itemsRes.rows.map((r) => ({
            productId: r.product_id,
            productName: r.product_name,
            unit: r.unit,
            approvedQty: r.approved_qty,
            requestedQty: r.requested_qty,
          }));

        for (const it of itemsToMove) {
          const pRes = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [it.productId]);
          const prod = pRes.rows[0];
          if (!prod) continue;
          const origRow = origByProduct.get(prod.id);
          const qty = Number(it.approvedQty || it.requestedQty || 0);
          if (qty <= 0) continue;
          const uRes = await client.query('SELECT * FROM product_units WHERE product_id = $1', [prod.id]);
          const unitName = String(it.unit || origRow?.unit || prod.base_unit || 'قطعة');
          const unitObj = uRes.rows.find((u) => u.name === unitName);
          const factor = unitObj ? Number(unitObj.conversion_factor || 1) : 1;
          const baseQty = round3(qty * factor);

          const stockMap = { ...(prod.stock_per_warehouse || {}) };
          const srcQty = Number(stockMap[req.source_warehouse_id] || 0);
          const dstQty = Number(stockMap[req.target_warehouse_id] || 0);
          if (srcQty < baseQty && !allowNeg) {
            throw new AppError(409, `الرصيد المتاح من (${prod.name}) بالمصدر (${srcQty}) أقل من (${baseQty})`, 'INSUFFICIENT_STOCK');
          }
          // Custody dispatch holds items in-transit until rep confirms receipt; normal transfer moves immediately
          stockMap[req.source_warehouse_id] = round3(srcQty - baseQty);
          if (!isCustodyDispatch) {
            stockMap[req.target_warehouse_id] = round3(dstQty + baseQty);
          }
          await client.query('UPDATE products SET stock_per_warehouse = $1 WHERE id = $2', [JSON.stringify(stockMap), prod.id]);

          if (approvedItems) {
            await client.query(
              `UPDATE rep_item_transfer_items SET approved_qty = $1, executed_qty = $1 WHERE transfer_id = $2 AND product_id = $3`,
              [qty, requestId, prod.id]
            );
          } else {
            await client.query(
              `UPDATE rep_item_transfer_items SET executed_qty = COALESCE(executed_qty, $1) WHERE transfer_id = $2 AND product_id = $3`,
              [qty, requestId, prod.id]
            );
          }

          const mvId = generateServerId('SM');
          await client.query(
            `INSERT INTO stock_movements (id, movement_number, date, product_id, product_name, warehouse_id, warehouse_name, target_warehouse_id, target_warehouse_name, movement_type, quantity, unit, unit_factor, unit_cost, related_doc_type, related_doc_id, related_doc_number, notes, created_by_user_id, created_by, actor_identity_id, actor_employee_id, acting_role, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'transfer_out',$10,$11,$12,$13,'rep_item_transfer',$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
            [
              mvId,
              mvId,
              dateStr,
              prod.id,
              prod.name,
              req.source_warehouse_id,
              req.source_warehouse_name,
              req.target_warehouse_id,
              req.target_warehouse_name,
              baseQty,
              unitName,
              factor,
              prod.purchase_price,
              req.id,
              req.request_number,
              isCustodyDispatch
                ? `صرف عهدة بضاعة مرسلة للمندوب ${req.representative_name} (بانتظار تأكيد الاستلام)`
                : `تحويل عهدة بضاعة للمندوب ${req.representative_name}`,
              actor.id,
              actor.fullName,
              actorCtx.actorIdentityId || null,
              actorCtx.actorEmployeeId || null,
              actorCtx.actingRole || actor.role || null,
              now,
            ]
          );
        }
      }

      if (status === 'rejected' && isCustodyDispatch && req.status === 'executed') {
        // Restore deducted source stock if dispatched custody is cancelled/rejected before rep receipt
        for (const r of itemsRes.rows) {
          const qty = Number(r.executed_qty ?? r.approved_qty ?? r.requested_qty ?? 0);
          if (qty <= 0) continue;
          const pRes = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [r.product_id]);
          const prod = pRes.rows[0];
          if (!prod) continue;
          const uRes = await client.query('SELECT * FROM product_units WHERE product_id = $1', [prod.id]);
          const unitName = String(r.unit || prod.base_unit || 'قطعة');
          const unitObj = uRes.rows.find((u) => u.name === unitName);
          const factor = unitObj ? Number(unitObj.conversion_factor || 1) : 1;
          const baseQty = round3(qty * factor);

          const stockMap = { ...(prod.stock_per_warehouse || {}) };
          stockMap[req.source_warehouse_id] = round3(Number(stockMap[req.source_warehouse_id] || 0) + baseQty);
          await client.query('UPDATE products SET stock_per_warehouse = $1 WHERE id = $2', [JSON.stringify(stockMap), prod.id]);
          const mvId = generateServerId('SM');
          await client.query(
            `INSERT INTO stock_movements (id, movement_number, date, product_id, product_name, warehouse_id, warehouse_name, movement_type, quantity, unit, unit_factor, unit_cost, related_doc_type, related_doc_id, related_doc_number, notes, created_by_user_id, created_by, actor_identity_id, actor_employee_id, acting_role, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'transfer_in',$8,$9,$10,$11,'rep_item_transfer',$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
            [mvId, mvId, dateStr, prod.id, prod.name, req.source_warehouse_id, req.source_warehouse_name, baseQty, unitName, factor, prod.purchase_price, req.id, req.request_number, `رد عهدة مرفوضة للمندوب ${req.representative_name}`, actor.id, actor.fullName, actorCtx.actorIdentityId || null, actorCtx.actorEmployeeId || null, actorCtx.actingRole || actor.role || null, now]
          );
        }
      }

      if (status === 'received') {
        if (req.status === 'received') {
          throw new AppError(409, 'تم تأكيد استلام هذه العهدة مسبقاً', 'ALREADY_RECEIVED');
        }
        if (isCustodyDispatch) {
          for (const r of itemsRes.rows) {
            const qty = Number(r.executed_qty ?? r.approved_qty ?? r.requested_qty ?? 0);
            if (qty <= 0) continue;
            const pRes = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [r.product_id]);
            const prod = pRes.rows[0];
            if (!prod) continue;
            const uRes = await client.query('SELECT * FROM product_units WHERE product_id = $1', [prod.id]);
            const unitName = String(r.unit || prod.base_unit || 'قطعة');
            const unitObj = uRes.rows.find((u) => u.name === unitName);
            const factor = unitObj ? Number(unitObj.conversion_factor || 1) : 1;
            const baseQty = round3(qty * factor);

            const stockMap = { ...(prod.stock_per_warehouse || {}) };
            stockMap[req.target_warehouse_id] = round3(Number(stockMap[req.target_warehouse_id] || 0) + baseQty);
            await client.query('UPDATE products SET stock_per_warehouse = $1 WHERE id = $2', [JSON.stringify(stockMap), prod.id]);

            const mvId = generateServerId('SM');
            await client.query(
              `INSERT INTO stock_movements (id, movement_number, date, product_id, product_name, warehouse_id, warehouse_name, target_warehouse_id, target_warehouse_name, movement_type, quantity, unit, unit_factor, unit_cost, related_doc_type, related_doc_id, related_doc_number, notes, created_by_user_id, created_by, actor_identity_id, actor_employee_id, acting_role, created_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'transfer_in',$10,$11,$12,$13,'rep_item_transfer',$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
              [
                mvId,
                mvId,
                dateStr,
                prod.id,
                prod.name,
                req.target_warehouse_id,
                req.target_warehouse_name,
                req.source_warehouse_id,
                req.source_warehouse_name,
                baseQty,
                unitName,
                factor,
                prod.purchase_price,
                req.id,
                req.request_number,
                `تأكيد استلام عهدة المندوب ${req.representative_name}`,
                actor.id,
                actor.fullName,
                actorCtx.actorIdentityId || null,
                actorCtx.actorEmployeeId || null,
                actorCtx.actingRole || actor.role || null,
                now,
              ]
            );
          }
        }
        await client.query(
          `UPDATE rep_item_transfers SET status = 'received', notes = CASE WHEN $1 <> '' THEN $1 ELSE notes END, received_by = $2, received_at = $3 WHERE id = $4`,
          [String(notes || ''), actor.fullName, now, requestId]
        );
      } else {
        await client.query(
          `UPDATE rep_item_transfers
           SET status = $1,
               notes = CASE WHEN $2 <> '' THEN $2 ELSE notes END,
               reviewed_by = $3,
               reviewed_at = $4,
               executed_at = CASE WHEN $1 = 'executed' THEN $4 ELSE executed_at END,
               dispatched_by = CASE WHEN $1 = 'executed' AND transfer_mode = 'custody_dispatch' THEN $3 ELSE dispatched_by END,
               dispatched_at = CASE WHEN $1 = 'executed' AND transfer_mode = 'custody_dispatch' THEN $4 ELSE dispatched_at END
           WHERE id = $5`,
          [status, String(notes || ''), actor.fullName, now, requestId]
        );
      }
    });
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `تحديث حالة طلب تحويل أصناف إلى (${status})`,
      module: 'المندوبون',
      recordId: requestId,
    });
    return { ok: true };
  }

  await withJsonTransaction(async (db) => {
    const req = db.repItemTransfers.find((r) => r.id === requestId);
    if (!req) throw new AppError(404, 'طلب التحويل غير موجود', 'NOT_FOUND');
    const isCustodyDispatch = req.transferMode === 'custody_dispatch';

    if (isRepActor) {
      if (req.representativeId !== repActorProfile.id) {
        throw new AppError(403, 'غير مصرح لك بتأكيد استلام تحويل يخص مندوباً آخر', 'FORBIDDEN_REP_TRANSFER_OWNER');
      }
      if (req.status !== 'executed') {
        throw new AppError(409, 'لا يمكن تأكيد الاستلام قبل تنفيذ التحويل من الإدارة أولاً', 'TRANSFER_NOT_EXECUTED_YET');
      }
    } else if (req.status === 'received') {
      throw new AppError(409, 'تم استلام هذا التحويل بالفعل ولا يمكن تعديله', 'TRANSFER_ALREADY_RECEIVED');
    }

    const actorCtxJson = resolveActorIdentityJsonTx(db, actor);
    if (status === 'executed' && req.status !== 'executed' && req.status !== 'received') {
      const origByProduct = new Map((req.items || []).map((r) => [r.productId, r]));
      const itemsToMove = approvedItems || req.items;
      for (const it of itemsToMove) {
        const prod = db.products.find((p) => p.id === it.productId);
        if (!prod) continue;
        const origRow = origByProduct.get(prod.id);
        const qty = Number(it.approvedQty || it.requestedQty || 0);
        if (qty <= 0) continue;
        const unitName = String(it.unit || origRow?.unit || prod.baseUnit || 'قطعة');
        const unitObj = (prod.units || []).find((u) => u.name === unitName);
        const factor = unitObj ? Number(unitObj.conversionFactor || 1) : 1;
        const baseQty = round3(qty * factor);

        const src = Number(prod.stockPerWarehouse[req.sourceWarehouseId] || 0);
        const dst = Number(prod.stockPerWarehouse[req.targetWarehouseId] || 0);
        if (src < baseQty && !db.settings?.allowNegativeStock) {
          throw new AppError(409, `الرصيد المتاح من (${prod.name}) بالمصدر (${src}) أقل من (${baseQty})`, 'INSUFFICIENT_STOCK');
        }
        prod.stockPerWarehouse[req.sourceWarehouseId] = round3(src - baseQty);
        if (!isCustodyDispatch) {
          prod.stockPerWarehouse[req.targetWarehouseId] = round3(dst + baseQty);
        }
        it.executedQty = qty;
        const mvId = generateServerId('SM');
        db.stockMovements.unshift({
          id: mvId,
          movementNumber: mvId,
          date: dateStr,
          type: 'transfer_out',
          productId: prod.id,
          productName: prod.name,
          warehouseId: req.sourceWarehouseId,
          warehouseName: req.sourceWarehouseName,
          targetWarehouseId: req.targetWarehouseId,
          targetWarehouseName: req.targetWarehouseName,
          quantity: baseQty,
          unit: unitName,
          unitFactor: factor,
          unitCost: prod.purchasePrice,
          relatedDocType: 'rep_item_transfer',
          referenceId: req.id,
          referenceNumber: req.requestNumber,
          notes: isCustodyDispatch
            ? `صرف عهدة بضاعة مرسلة للمندوب ${req.representativeName} (بانتظار تأكيد الاستلام)`
            : `تحويل عهدة بضاعة للمندوب ${req.representativeName}`,
          createdByUserId: actor.id,
          createdBy: actor.fullName,
          actorIdentityId: actorCtxJson.actorIdentityId,
          actorEmployeeId: actorCtxJson.actorEmployeeId,
          actingRole: actorCtxJson.actingRole,
          createdAt: now,
        });
      }
    }

    if (status === 'rejected' && isCustodyDispatch && req.status === 'executed') {
      for (const it of req.items || []) {
        const qty = Number(it.executedQty ?? it.approvedQty ?? it.requestedQty ?? 0);
        const prod = db.products.find((p) => p.id === it.productId);
        if (!prod || qty <= 0) continue;
        const unitName = String(it.unit || prod.baseUnit || 'قطعة');
        const unitObj = (prod.units || []).find((u) => u.name === unitName);
        const factor = unitObj ? Number(unitObj.conversionFactor || 1) : 1;
        const baseQty = round3(qty * factor);
        prod.stockPerWarehouse[req.sourceWarehouseId] = round3(Number(prod.stockPerWarehouse[req.sourceWarehouseId] || 0) + baseQty);
        const mvId = generateServerId('SM');
        db.stockMovements.unshift({
          id: mvId,
          movementNumber: mvId,
          date: dateStr,
          type: 'transfer_in',
          productId: prod.id,
          productName: prod.name,
          warehouseId: req.sourceWarehouseId,
          warehouseName: req.sourceWarehouseName,
          quantity: baseQty,
          unit: unitName,
          unitFactor: factor,
          unitCost: prod.purchasePrice,
          relatedDocType: 'rep_item_transfer',
          referenceId: req.id,
          referenceNumber: req.requestNumber,
          notes: `رد عهدة مرفوضة للمندوب ${req.representativeName}`,
          createdByUserId: actor.id,
          createdBy: actor.fullName,
          actorIdentityId: actorCtxJson.actorIdentityId,
          actorEmployeeId: actorCtxJson.actorEmployeeId,
          actingRole: actorCtxJson.actingRole,
          createdAt: now,
        });
      }
    }

    if (status === 'received' && isCustodyDispatch) {
      for (const it of req.items || []) {
        const qty = Number(it.executedQty ?? it.approvedQty ?? it.requestedQty ?? 0);
        const prod = db.products.find((p) => p.id === it.productId);
        if (!prod || qty <= 0) continue;
        const unitName = String(it.unit || prod.baseUnit || 'قطعة');
        const unitObj = (prod.units || []).find((u) => u.name === unitName);
        const factor = unitObj ? Number(unitObj.conversionFactor || 1) : 1;
        const baseQty = round3(qty * factor);
        prod.stockPerWarehouse[req.targetWarehouseId] = round3(Number(prod.stockPerWarehouse[req.targetWarehouseId] || 0) + baseQty);
        const mvId = generateServerId('SM');
        db.stockMovements.unshift({
          id: mvId,
          movementNumber: mvId,
          date: dateStr,
          type: 'transfer_in',
          productId: prod.id,
          productName: prod.name,
          warehouseId: req.targetWarehouseId,
          warehouseName: req.targetWarehouseName,
          targetWarehouseId: req.sourceWarehouseId,
          targetWarehouseName: req.sourceWarehouseName,
          quantity: baseQty,
          unit: unitName,
          unitFactor: factor,
          unitCost: prod.purchasePrice,
          relatedDocType: 'rep_item_transfer',
          referenceId: req.id,
          referenceNumber: req.requestNumber,
          notes: `تأكيد استلام عهدة المندوب ${req.representativeName}`,
          createdByUserId: actor.id,
          createdBy: actor.fullName,
          actorIdentityId: actorCtxJson.actorIdentityId,
          actorEmployeeId: actorCtxJson.actorEmployeeId,
          actingRole: actorCtxJson.actingRole,
          createdAt: now,
        });
      }
    }

    req.status = status;
    if (notes) req.notes = notes;
    if (status === 'received') {
      req.receivedBy = actor.fullName;
      req.receivedAt = now;
    } else {
      req.reviewedBy = actor.fullName;
      req.reviewedAt = now;
      if (status === 'executed') {
        req.executedAt = now;
        if (isCustodyDispatch) {
          req.dispatchedBy = actor.fullName;
          req.dispatchedAt = now;
        }
      }
      if (approvedItems) req.items = approvedItems;
    }
  });
  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `تحديث حالة طلب تحويل أصناف إلى (${status})`,
    module: 'المندوبون',
    recordId: requestId,
  });
  return { ok: true };
}

export async function getMobileNotifications(authContext) {
  const actor = authContext.user;
  const settings = await getSystemSettingsSafe();
  const mobileConfig = settings.mobileConfig;
  const notifications = [];

  if (actor.role === 'customer') {
    const cust = authContext.customerProfile;
    if (!cust) {
      return { notifications: [], mobileConfig };
    }
    const orders = await listOrders(authContext);
    for (const o of orders.slice(0, 15)) {
      if (o.status === 'under_review') {
        notifications.push({
          id: `notif-ord-rev-${o.id}-${o.updatedAt || o.createdAt}`,
          type: 'order_status',
          severity: 'info',
          title: `طلبك قيد المراجعة (${o.requestNumber})`,
          body: 'بدأت الإدارة بمراجعة طلبك وستصلك النتيجة قريباً.',
          relatedId: o.id,
          createdAt: o.reviewedAt || o.updatedAt || o.createdAt,
        });
      } else if (o.status === 'approved') {
        notifications.push({
          id: `notif-ord-app-${o.id}-${o.updatedAt || o.createdAt}`,
          type: 'order_status',
          severity: 'info',
          title: `تم قبول طلبك (${o.requestNumber})`,
          body: 'وافقت الإدارة على طلبك ومتاح لاستكمال إجراءات الفوترة.',
          relatedId: o.id,
          createdAt: o.reviewedAt || o.updatedAt || o.createdAt,
        });
      } else if (o.status === 'invoiced') {
        notifications.push({
          id: `notif-ord-inv-${o.id}`,
          type: 'order_status',
          severity: 'success',
          title: `تم تحويل طلبك لفاتورة (${o.invoiceNumber || o.requestNumber})`,
          body: `يمكنك مراجعة تفاصيل الفاتورة في تبويب فواتيري وحسابي.`,
          relatedId: o.invoiceId || o.id,
          createdAt: o.updatedAt || o.createdAt,
        });
      } else if (o.status === 'rejected') {
        notifications.push({
          id: `notif-ord-rej-${o.id}`,
          type: 'order_status',
          severity: 'warning',
          title: `تم رفض الطلب (${o.requestNumber})`,
          body: o.rejectionReason ? `السبب: ${o.rejectionReason}` : 'يرجى التواصل مع الإدارة.',
          relatedId: o.id,
          createdAt: o.reviewedAt || o.updatedAt || o.createdAt,
        });
      }
    }

    const invs = await listInvoices(actor, { customerId: cust.id });
    for (const inv of invs.slice(0, 10)) {
      if (inv.status === 'confirmed') {
        notifications.push({
          id: `notif-cust-inv-${inv.id}`,
          type: 'invoice',
          severity: 'success',
          title: `فاتورة جديدة (${inv.invoiceNumber})`,
          body: mobileConfig.allowCustomerPriceView
            ? `الإجمالي: ${round2(inv.grandTotal).toLocaleString()} ${settings.currency || 'ج.م'} — المتبقي: ${round2(inv.remainingAmount).toLocaleString()}`
            : 'صدرت فاتورة جديدة بحسابك.',
          relatedId: inv.id,
          createdAt: inv.createdAt || inv.date,
        });
      }
    }

    if (mobileConfig.allowCustomerPriceView && Number(cust.currentBalance || 0) > 0) {
      notifications.push({
        id: `notif-cust-bal-${cust.id}-${Math.round(Number(cust.currentBalance || 0))}`,
        type: 'balance',
        severity: 'warning',
        title: 'تذكير بالرصيد المستحق',
        body: `الرصيد القائم على الحساب: ${round2(cust.currentBalance).toLocaleString()} ${settings.currency || 'ج.م'}`,
        relatedId: cust.id,
        createdAt: new Date().toISOString().split('T')[0],
      });
    }
  } else if (actor.role === 'representative') {
    const rep = authContext.representativeProfile || (await getRepresentativeByUserId(actor.id));
    if (!rep) {
      return { notifications: [], mobileConfig };
    }
    const boot = await getStaffBootstrapData(actor);

    for (const rit of boot.repItemTransfers || []) {
      if (rit.status === 'executed') {
        const isDispatch = rit.transferMode === 'custody_dispatch';
        notifications.push({
          id: `notif-rit-exec-${rit.id}`,
          type: isDispatch ? 'custody_dispatch' : 'item_transfer',
          severity: 'success',
          title: isDispatch
            ? `عهدة بضاعة مرسلة من الإدارة بانتظار الاستلام (${rit.requestNumber})`
            : `تحويل أصناف منفّذ (${rit.requestNumber})`,
          body: isDispatch
            ? 'افتح شاشة التزامن REFRESH أو العهدة لتأكيد الاستلام وإضافتها إلى مخزون سيارتك.'
            : 'يرجى تأكيد استلام الأصناف في سيارتك ثم اعتماد الفاتورة المرتبطة إن وجدت.',
          relatedId: rit.id,
          targetTab: isDispatch ? 'refresh' : 'custody',
          createdAt: rit.dispatchedAt || rit.executedAt || rit.reviewedAt || rit.createdAt,
        });
      } else if (rit.status === 'approved') {
        notifications.push({
          id: `notif-rit-app-${rit.id}`,
          type: 'item_transfer',
          severity: 'info',
          title: `تمت الموافقة على تحويل (${rit.requestNumber})`,
          body: 'بانتظار تنفيذ التحويل المخزني من أمين المخزن.',
          relatedId: rit.id,
          createdAt: rit.reviewedAt || rit.createdAt,
        });
      } else if (rit.status === 'rejected') {
        notifications.push({
          id: `notif-rit-rej-${rit.id}`,
          type: 'item_transfer',
          severity: 'warning',
          title: `تم رفض طلب التحويل (${rit.requestNumber})`,
          body: rit.notes || 'راجع الإدارة للتفاصيل.',
          relatedId: rit.id,
          createdAt: rit.reviewedAt || rit.createdAt,
        });
      }
    }

    for (const inv of boot.invoices || []) {
      if (inv.status === 'draft' && inv.linkedRepTransferId) {
        const rit = (boot.repItemTransfers || []).find((r) => r.id === inv.linkedRepTransferId);
        if (rit && ['executed', 'received'].includes(rit.status)) {
          notifications.push({
            id: `notif-draft-ready-${inv.id}`,
            type: 'draft_ready',
            severity: 'success',
            title: `مسودة فاتورة جاهزة للاعتماد (${inv.invoiceNumber})`,
            body: `تم توفير أصناف التحويل ${rit.requestNumber} — اضغط لاعتماد الفاتورة النهائية.`,
            relatedId: inv.id,
            createdAt: rit.executedAt || inv.createdAt,
          });
        }
      }
    }

    for (const tr of boot.repTransfers || []) {
      if (tr.status === 'awaiting_receipt' && tr.receiverId === rep.id) {
        notifications.push({
          id: `notif-cash-wait-${tr.id}`,
          type: 'cash_transfer',
          severity: 'warning',
          title: `عهدة مالية مرسلة بانتظار استلامك (${tr.transferNumber})`,
          body: `المبلغ: ${round2(tr.amount).toLocaleString()} ${settings.currency || 'ج.م'}`,
          relatedId: tr.id,
          createdAt: tr.sentAt || tr.timestamp,
        });
      }
    }
    for (const ord of boot.customerItemOrders || []) {
      if (ord.status === 'under_review') {
        notifications.push({
          id: `notif-rep-ord-rev-${ord.id}-${ord.updatedAt || ord.createdAt}`,
          type: 'order_status',
          severity: 'info',
          title: `الطلب قيد المراجعة (${ord.requestNumber})`,
          body: `عميل: ${ord.customerName} — قيد مراجعة الإدارة`,
          relatedId: ord.id,
          targetTab: 'orders',
          createdAt: ord.reviewedAt || ord.updatedAt || ord.createdAt,
        });
      } else if (ord.status === 'approved') {
        notifications.push({
          id: `notif-rep-ord-app-${ord.id}-${ord.updatedAt || ord.createdAt}`,
          type: 'order_status',
          severity: 'success',
          title: `تم قبول طلبك (${ord.requestNumber})`,
          body: `عميل: ${ord.customerName} — تم قبول الطلب من الإدارة`,
          relatedId: ord.id,
          targetTab: 'orders',
          createdAt: ord.reviewedAt || ord.updatedAt || ord.createdAt,
        });
      } else if (ord.status === 'rejected') {
        notifications.push({
          id: `notif-rep-ord-rej-${ord.id}`,
          type: 'order_status',
          severity: 'warning',
          title: `تم رفض الطلب (${ord.requestNumber})`,
          body: ord.rejectionReason ? `السبب: ${ord.rejectionReason}` : 'يرجى التواصل مع الإدارة.',
          relatedId: ord.id,
          targetTab: 'orders',
          createdAt: ord.reviewedAt || ord.updatedAt || ord.createdAt,
        });
      } else if (ord.status === 'invoiced') {
        notifications.push({
          id: `notif-rep-ord-inv-${ord.id}`,
          type: 'order_status',
          severity: 'success',
          title: `تم إصدار فاتورة للطلب (${ord.invoiceNumber || ord.requestNumber})`,
          body: `عميل: ${ord.customerName}`,
          relatedId: ord.invoiceId || ord.id,
          targetTab: 'orders',
          createdAt: ord.updatedAt || ord.createdAt,
        });
      }
    }

    for (const inv of boot.invoices || []) {
      if (inv.type !== 'purchase') continue;
      if (inv.dispatchStatus === 'received' && inv.status === 'draft') {
        notifications.push({
          id: `notif-rep-pur-rec-${inv.id}-${inv.receivedAt || inv.updatedAt || inv.createdAt}`,
          type: 'purchase_invoice_status',
          severity: 'info',
          title: `تم استلام فاتورة الشراء (${inv.invoiceNumber})`,
          body: `استلمها: ${inv.receivedBy || 'الإدارة'} — بانتظار المراجعة والاعتماد النهائي`,
          relatedId: inv.id,
          targetTab: 'purchases-list',
          createdAt: inv.receivedAt || inv.updatedAt || inv.createdAt,
        });
      } else if (inv.dispatchStatus === 'rejected') {
        notifications.push({
          id: `notif-rep-pur-rej-${inv.id}-${inv.rejectedAt || inv.updatedAt || inv.createdAt}`,
          type: 'purchase_invoice_status',
          severity: 'warning',
          title: `تم رفض فاتورة الشراء (${inv.invoiceNumber})`,
          body: inv.rejectionReason ? `السبب: ${inv.rejectionReason}` : 'يرجى مراجعة الفاتورة وتعديلها ثم إعادة الإرسال.',
          relatedId: inv.id,
          targetTab: 'purchases-list',
          createdAt: inv.rejectedAt || inv.updatedAt || inv.createdAt,
        });
        } else if (inv.status === 'confirmed') {
        notifications.push({
          id: `notif-rep-pur-conf-${inv.id}`,
          type: 'purchase_invoice_status',
          severity: 'success',
          title: `تم اعتماد وترحيل فاتورة الشراء (${inv.invoiceNumber})`,
          body: `تم ترحيل الفاتورة للمخزون والحسابات (${round2(inv.grandTotal).toLocaleString()} ${settings.currency || 'ج.م'})`,
          relatedId: inv.id,
          targetTab: 'purchases-list',
          createdAt: inv.updatedAt || inv.createdAt,
        });
      }
    }

    for (const prr of boot.purchaseReturnRequests || []) {
      if (prr.status === 'approved') {
        notifications.push({
          id: `notif-rep-prr-app-${prr.id}-${prr.reviewedAt || prr.updatedAt}`,
          type: 'purchase_return_request',
          severity: 'success',
          title: `تم اعتماد طلب مرتجع الشراء (${prr.requestNumber})`,
          body: `فاتورة ${prr.originalInvoiceNumber} — المورد: ${prr.supplierName || '-'} · رقم المرتجع: ${prr.approvedReturnNumber || '-'}`,
          relatedId: prr.id,
          targetTab: 'purchases-list',
          createdAt: prr.reviewedAt || prr.updatedAt || prr.createdAt,
        });
      } else if (prr.status === 'rejected') {
        notifications.push({
          id: `notif-rep-prr-rej-${prr.id}-${prr.reviewedAt || prr.updatedAt}`,
          type: 'purchase_return_request',
          severity: 'warning',
          title: `تم رفض طلب مرتجع الشراء (${prr.requestNumber})`,
          body: prr.rejectionReason ? `السبب: ${prr.rejectionReason}` : 'يرجى مراجعة الإدارة للتفاصيل.',
          relatedId: prr.id,
          targetTab: 'purchases-list',
          createdAt: prr.reviewedAt || prr.updatedAt || prr.createdAt,
        });
      }
    }

    for (const srr of boot.salesReturnRequests || []) {
      if (srr.status === 'approved') {
        notifications.push({
          id: `notif-rep-srr-app-${srr.id}-${srr.reviewedAt || srr.updatedAt}`,
          type: 'sales_return_request',
          severity: 'success',
          title: `تم اعتماد طلب مرتجع المبيعات (${srr.requestNumber})`,
          body: `فاتورة ${srr.originalInvoiceNumber} — العميل: ${srr.customerName || '-'} · رقم المرتجع: ${srr.approvedReturnNumber || '-'}`,
          relatedId: srr.id,
          targetTab: 'sales-returns-list',
          createdAt: srr.reviewedAt || srr.updatedAt || srr.createdAt,
        });
      } else if (srr.status === 'rejected') {
        notifications.push({
          id: `notif-rep-srr-rej-${srr.id}-${srr.reviewedAt || srr.updatedAt}`,
          type: 'sales_return_request',
          severity: 'warning',
          title: `تم رفض طلب مرتجع المبيعات (${srr.requestNumber})`,
          body: srr.rejectionReason ? `السبب: ${srr.rejectionReason}` : 'يرجى مراجعة الإدارة للتفاصيل.',
          relatedId: srr.id,
          targetTab: 'sales-returns-list',
          createdAt: srr.reviewedAt || srr.updatedAt || srr.createdAt,
        });
      }
    }

    for (const batch of boot.syncDispatchBatches || []) {
      if (batch.receiptStatus === 'تم الاستلام') {
        notifications.push({
          id: `notif-rep-dsp-conf-${batch.id}`,
          type: 'sync_dispatch_confirmed',
          severity: 'success',
          title: `تم استلام وتأكيد دفعتك (${batch.batchNumber})`,
          body: `المستلم: ${batch.receivedByName || batch.recipientName} — فواتير: ${batch.salesCount} · تحصيلات: ${batch.collectionsCount}`,
          relatedId: batch.id,
          referenceNumber: batch.batchNumber,
          targetTab: 'refresh',
          createdAt: batch.receivedAt || batch.updatedAt || batch.createdAt,
        });
      } else if (batch.receiptStatus === 'تعذر الاستلام') {
        notifications.push({
          id: `notif-rep-dsp-fail-${batch.id}-${batch.updatedAt || batch.createdAt}`,
          type: 'sync_dispatch_failed',
          severity: 'warning',
          title: `تعذر استلام الدفعة (${batch.batchNumber})`,
          body: batch.errorMessage || 'يرجى مراجعة الإدارة وتأكيد التفاصيل.',
          relatedId: batch.id,
          referenceNumber: batch.batchNumber,
          targetTab: 'refresh',
          createdAt: batch.updatedAt || batch.createdAt,
        });
      }
    }
  } else {
    // Admin & staff mobile/desktop notifications scoped to actual permissions
    const boot = await getStaffBootstrapData(actor);
    const isAdmin = actor.role === 'admin';
    const perms = actor.permissions || {};

    if (isAdmin || perms.canManagePurchases || perms.canApprove || perms.canReceive) {
      for (const inv of boot.invoices || []) {
        if (inv.type === 'purchase' && inv.status === 'draft' && inv.dispatchStatus === 'sent') {
          notifications.push({
            id: `notif-staff-pur-sent-${inv.id}-${inv.sentAt || inv.createdAt}`,
            type: 'rep_purchase_invoice',
            severity: 'warning',
            title: `فاتورة شراء من المندوب بانتظار الاستلام (${inv.invoiceNumber})`,
            body: `المرسل: ${inv.sentBy || inv.representativeName || inv.createdBy} · المورد: ${inv.supplierName || '-'} · ${round2(inv.grandTotal).toLocaleString()} ${settings.currency || 'ج.م'}`,
            relatedId: inv.id,
            targetTab: 'purchase-invoices',
            createdAt: inv.sentAt || inv.updatedAt || inv.createdAt,
          });
        }
      }
    }

    if (isAdmin || perms.canManagePurchases) {
      for (const prr of boot.purchaseReturnRequests || []) {
        if (prr.status === 'pending') {
          notifications.push({
            id: `notif-staff-prr-pend-${prr.id}`,
            type: 'purchase_return_request',
            severity: 'warning',
            title: `طلب مرتجع شراء بانتظار الاعتماد (${prr.requestNumber})`,
            body: `المندوب: ${prr.representativeName || prr.createdBy} · المورد: ${prr.supplierName || '-'} · ${round2(prr.grandTotal).toLocaleString()} ${settings.currency || 'ج.م'}`,
            relatedId: prr.id,
            targetTab: 'purchase-invoices',
            createdAt: prr.createdAt,
          });
        }
      }
    }

    if (isAdmin || perms.canManageSales || perms.canManageCashboxes || perms.canManageAccounts || perms.canApprove) {
      for (const srr of boot.salesReturnRequests || []) {
        if (srr.status === 'pending') {
          notifications.push({
            id: `notif-staff-srr-pend-${srr.id}`,
            type: 'sales_return_request',
            severity: 'warning',
            title: `طلب مرتجع مبيعات بانتظار الاعتماد (${srr.requestNumber})`,
            body: `المندوب: ${srr.representativeName || srr.requestedByName} · العميل: ${srr.customerName || '-'} · ${round2(srr.grandTotal).toLocaleString()} ${settings.currency || 'ج.م'}`,
            relatedId: srr.id,
            targetTab: 'returns',
            createdAt: srr.createdAt,
          });
        }
      }
    }

    if (isAdmin || perms.canManageSales || perms.canReviewRepInvoices) {
      for (const inv of boot.invoices || []) {
        if (inv.type === 'sales' && inv.status === 'confirmed' && inv.reviewStatus === 'needs_review') {
          notifications.push({
            id: `notif-staff-inv-rev-${inv.id}`,
            type: 'rep_invoice_review',
            severity: 'info',
            title: `فاتورة مندوب جديدة للمراجعة (${inv.invoiceNumber})`,
            body: `المندوب: ${inv.representativeName || inv.createdBy} — العميل: ${inv.customerName || 'نقدي'} (${round2(inv.grandTotal).toLocaleString()} ${settings.currency || 'ج.م'})`,
            relatedId: inv.id,
            targetTab: 'sales',
            createdAt: inv.createdAt,
          });
        }
      }
    }

    if (isAdmin || perms.canManageSales) {
      for (const ord of boot.customerItemOrders || []) {
        if (ord.status === 'pending') {
          const isRepOrder = ord.requesterType === 'representative' || Boolean(ord.representativeId);
          notifications.push({
            id: `notif-staff-ord-${ord.id}`,
            type: 'customer_order',
            severity: 'warning',
            title: isRepOrder
              ? `طلب مندوب جديد بانتظار المراجعة (${ord.requestNumber})`
              : `طلب عميل جديد بانتظار المراجعة (${ord.requestNumber})`,
            body: isRepOrder
              ? `المندوب: ${ord.submittedByName || ord.representativeName || '-'} · العميل: ${ord.customerName || '-'}`
              : `${ord.customerName || 'عميل'} — ${(ord.items || []).length} صنف`,
            relatedId: ord.id,
            targetTab: 'customer-orders',
            createdAt: ord.createdAt,
          });
        }
      }
    }

    if (isAdmin || perms.canManageTransfers || perms.canManageInventory) {
      for (const rit of boot.repItemTransfers || []) {
        if (rit.status === 'pending' || rit.status === 'approved') {
          notifications.push({
            id: `notif-staff-rit-${rit.id}-${rit.status}`,
            type: 'item_transfer',
            severity: rit.status === 'pending' ? 'warning' : 'info',
            title:
              rit.status === 'pending'
                ? `طلب تحويل بضاعة للمندوب (${rit.requestNumber})`
                : `تحويل بضاعة معتمد بانتظار التنفيذ (${rit.requestNumber})`,
            body: `${rit.representativeName || 'مندوب'} — ${(rit.items || []).length} صنف`,
            relatedId: rit.id,
            targetTab: 'rep-item-transfers',
            createdAt: rit.reviewedAt || rit.createdAt,
          });
        }
      }
    }

    if (isAdmin || perms.canManageTransfers || perms.canManageCashboxes) {
      for (const tr of boot.repTransfers || []) {
        if (tr.status === 'awaiting_receipt' && tr.direction === 'rep_to_owner') {
          notifications.push({
            id: `notif-staff-repcash-${tr.id}`,
            type: 'cash_transfer',
            severity: 'warning',
            title: `توريد نقدي من المندوب بانتظار الاستلام (${tr.transferNumber})`,
            body: `${tr.senderName || 'مندوب'} — ${round2(tr.amount).toLocaleString()} ${settings.currency || 'ج.م'}`,
            relatedId: tr.id,
            targetTab: 'rep-transfers',
            createdAt: tr.sentAt || tr.timestamp,
          });
        }
      }
    }

    if (isAdmin || perms.canApproveStockCount || perms.canManageInventory) {
      for (const sc of boot.stockCounts || []) {
        if (sc.status === 'submitted') {
          notifications.push({
            id: `notif-staff-sc-${sc.id}`,
            type: 'stock_count',
            severity: 'warning',
            title: `جلسة جرد مرسلة للاعتماد (${sc.countNumber})`,
            body: `${sc.warehouseName} — بواسطة ${sc.counterName}`,
            relatedId: sc.id,
            targetTab: 'stock-counts',
            createdAt: sc.submittedAt || sc.createdAt,
          });
        }
      }
    }

    for (const batch of boot.syncDispatchBatches || []) {
      if (
        (batch.receiptStatus === 'في انتظار الاستلام' || batch.receiptStatus === 'جاري الاستلام') &&
        (isAdmin || actor.role === 'manager' || batch.recipientUserId === actor.id || perms.canApprove || perms.canReceive || perms.canManageReps || perms.canManageTransfers)
      ) {
        notifications.push({
          id: `notif-staff-dsp-in-${batch.id}-${batch.receiptStatus}`,
          type: 'sync_dispatch_incoming',
          severity: 'warning',
          title: `دفعة إرسال مندوب بانتظار الاستلام (${batch.batchNumber})`,
          body: `المرسل: ${batch.senderName} — فواتير: ${batch.salesCount} · تحصيلات: ${batch.collectionsCount} · الإجمالي النقدي: ${round2(batch.totalCashAmount).toLocaleString()} ${settings.currency || 'ج.م'}`,
          relatedId: batch.id,
          referenceNumber: batch.batchNumber,
          targetTab: 'refresh-sync',
          createdAt: batch.sentAt || batch.createdAt,
        });
      }
    }

    if (isAdmin || perms.canApproveStockTransfer || perms.canExecuteStockTransfer || perms.canManageWarehouses) {
      for (const st of boot.stockTransferRequests || []) {
        if (st.status === 'submitted' || st.status === 'approved') {
          notifications.push({
            id: `notif-staff-st-${st.id}-${st.status}`,
            type: 'stock_transfer',
            severity: st.status === 'submitted' ? 'warning' : 'info',
            title:
              st.status === 'submitted'
                ? `طلب تحويل مخزني بانتظار الموافقة (${st.transferNumber})`
                : `تحويل مخزني معتمد بانتظار التنفيذ (${st.transferNumber})`,
            body: `من ${st.sourceWarehouseName} إلى ${st.targetWarehouseName}`,
            relatedId: st.id,
            targetTab: 'stock-transfers-orders',
            createdAt: st.approvedAt || st.submittedAt || st.createdAt,
          });
        }
      }
    }

    if (isAdmin || perms.canManageInventory) {
      let lowStockCount = 0;
      for (const p of boot.products || []) {
        if (p.status !== 'active' || Number(p.minStockLevel || 0) <= 0) continue;
        const totalQty = Object.values(p.stockPerWarehouse || {}).reduce((s, q) => s + Number(q || 0), 0);
        if (totalQty <= Number(p.minStockLevel || 0)) {
          lowStockCount += 1;
          if (lowStockCount <= 5) {
            notifications.push({
              id: `notif-staff-low-${p.id}`,
              type: 'low_stock',
              severity: 'warning',
              title: `نقص رصيد صنف (${p.name})`,
              body: `الرصيد المتاح: ${round3(totalQty)} (الحد الأدنى: ${p.minStockLevel})`,
              relatedId: p.id,
              targetTab: 'products',
              createdAt: p.createdAt,
            });
          }
        }
      }
    }
  }

  notifications.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return { notifications: notifications.slice(0, 40), mobileConfig };
}

// ==============================================================================
// Users CRUD (bcrypt enforced, role hierarchy guarded, passwordHash NEVER returned)
// ==============================================================================

const ALLOWED_USER_ROLES = new Set(['admin', 'manager', 'accountant', 'sales', 'warehouse', 'purchases', 'representative', 'customer']);

function assertNoPermissionEscalation(requestedPermissions, actor) {
  if (!actor || actor.role === 'admin') return;
  if (!requestedPermissions || typeof requestedPermissions !== 'object') return;
  const actorPerms = actor.permissions || {};
  for (const [key, val] of Object.entries(requestedPermissions)) {
    if (val === true && actorPerms[key] !== true) {
      throw new AppError(403, `غير مصرح لك بمنح صلاحية (${key}) لأنها غير متاحة لحسابك`, 'FORBIDDEN_PERMISSION_ESCALATION');
    }
  }
}

export async function createAdminUser(payload, actor) {
  const username = String(payload.username || '').trim();
  const fullName = String(payload.fullName || '').trim();
  const password = String(payload.password || '');
  const targetRole = String(payload.role || 'sales').trim();
  if (!ALLOWED_USER_ROLES.has(targetRole)) {
    throw new AppError(400, 'الدور الوظيفي المحدد غير صالح', 'INVALID_ROLE');
  }
  if (actor?.role !== 'admin' && targetRole === 'admin') {
    throw new AppError(403, 'غير مصرح لغير المدير العام بإنشاء حساب مدير عام', 'FORBIDDEN_ADMIN_ESCALATION');
  }
  const liveSettings = await getSystemSettingsSafe();
  const hasExplicitPermissions =
    payload.permissions && typeof payload.permissions === 'object' && Object.keys(payload.permissions).length > 0;
  const rawResolvedPermissions = hasExplicitPermissions && !payload.applyRolePreset
    ? {
        ...EMPTY_PERMISSIONS,
        ...Object.fromEntries(Object.entries(payload.permissions).map(([k, v]) => [k, Boolean(v)])),
      }
    : resolveDefaultPermissionsForRole(targetRole, liveSettings.extraSettings || {});
  const resolvedPermissions = sanitizeEffectivePermissionsForRole(targetRole, rawResolvedPermissions);
  assertNoPermissionEscalation(resolvedPermissions, actor);
  if (!username || username.length < 3) throw new AppError(400, 'اسم المستخدم يجب أن لا يقل عن 3 أحرف', 'INVALID_USERNAME');
  if (!fullName) throw new AppError(400, 'الاسم الكامل مطلوب', 'INVALID_NAME');
  if (!password || password.length < 6) throw new AppError(400, 'كلمة المرور يجب أن لا تقل عن 6 أحرف', 'WEAK_PASSWORD');

  const passwordHash = await hashPasswordBcrypt(password);
  const id = generateServerId('USR');
  const now = nowIso();

  const requestedLinkedEmployeeId = String(payload.linkedEmployeeId || payload.employeeId || '').trim() || null;
  if (targetRole === 'customer' && requestedLinkedEmployeeId) {
    throw new AppError(400, 'لا يمكن ربط حساب عميل بملف موظف', 'INVALID_ROLE_EMPLOYEE_LINK');
  }

  if (await isPgMode()) {
    const user = await withTransaction(async (client) => {
      const dup = await client.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1', [username]);
      if (dup.rows[0]) throw new AppError(409, 'اسم المستخدم مسجل مسبقًا', 'DUPLICATE_USERNAME');

      const linkedEmployeeId = requestedLinkedEmployeeId;
      let linkedEmpRow = null;
      if (linkedEmployeeId) {
        const empRes = await client.query('SELECT * FROM employees WHERE id = $1 FOR UPDATE', [linkedEmployeeId]);
        linkedEmpRow = empRes.rows[0];
        if (!linkedEmpRow) {
          throw new AppError(404, 'سجل الموظف المحدد للربط غير موجود', 'EMPLOYEE_NOT_FOUND');
        }
        if (linkedEmpRow.user_id && linkedEmpRow.user_id !== id) {
          throw new AppError(409, 'ملف الموظف المختار مربوط مسبقًا بحساب مستخدم آخر', 'EMPLOYEE_ALREADY_LINKED');
        }
        const dupUserEmpRes = await client.query(
          'SELECT id FROM users WHERE employee_id = $1 AND id <> $2 LIMIT 1',
          [linkedEmployeeId, id]
        );
        if (dupUserEmpRes.rows[0]) {
          throw new AppError(409, 'ملف الموظف المختار مربوط مسبقًا بحساب مستخدم آخر', 'EMPLOYEE_ALREADY_LINKED');
        }
      }

      const activeRole = String(payload.activeRole || targetRole).trim() || targetRole;
      const additionalRoles = Array.isArray(payload.additionalRoles) ? payload.additionalRoles : [];

      await client.query(
        `INSERT INTO users (id, full_name, username, password_hash, password_algo, phone, normalized_phone, address, notes, role, job_title, department, employee_id, active_role, additional_roles, is_active, must_change_password, permissions, created_at)
         VALUES ($1,$2,$3,$4,'bcrypt',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          id,
          fullName,
          username,
          passwordHash,
          payload.phone || '',
          normalizePhoneDigits(payload.phone || ''),
          payload.address || '',
          payload.notes || '',
          targetRole,
          payload.jobTitle || (targetRole === 'representative' ? 'مندوب مبيعات' : targetRole === 'customer' ? 'عميل' : ''),
          payload.department || (targetRole === 'representative' ? 'المندوبون' : targetRole === 'customer' ? 'العملاء' : ''),
          linkedEmployeeId,
          activeRole,
          JSON.stringify(additionalRoles),
          payload.isActive ?? true,
          Boolean(payload.mustChangePassword),
          JSON.stringify(resolvedPermissions),
          now,
        ]
      );

      let resolvedLinkedCustomerId;
      let resolvedLinkedRepId;
      if (targetRole === 'customer') {
        if (payload.linkedCustomerId) {
          const targetCustRes = await client.query('SELECT id, user_id FROM customers WHERE id = $1 FOR UPDATE', [payload.linkedCustomerId]);
          const targetCust = targetCustRes.rows[0];
          if (!targetCust) {
            throw new AppError(404, 'ملف العميل المحدد للربط غير موجود', 'CUSTOMER_NOT_FOUND');
          }
          if (targetCust.user_id && targetCust.user_id !== id) {
            throw new AppError(409, 'ملف العميل المختار مربوط مسبقًا بحساب مستخدم آخر', 'CUSTOMER_ALREADY_LINKED');
          }
          await client.query('UPDATE customers SET user_id = $1, updated_at = $2 WHERE id = $3', [id, now, targetCust.id]);
          resolvedLinkedCustomerId = targetCust.id;
        } else if (payload.autoCreateCustomerProfile !== false) {
          const normPhone = normalizePhoneDigits(payload.phone);
          let matchedExisting = null;
          if (normPhone && payload.autoMatchExisting !== false && !payload.forceNewCustomerProfile) {
            const { variants: phoneVariants, suffixPattern } = buildPhoneLookupVariants(payload.phone);
            const whereParts = [`normalized_phone = $1`];
            const whereParams = [normPhone];
            if (phoneVariants.length > 0) {
              const ph = phoneVariants
                .map((v) => {
                  whereParams.push(v);
                  return `$${whereParams.length}`;
                })
                .join(', ');
              whereParts.push(`phone IN (${ph})`);
              whereParts.push(`secondary_phone IN (${ph})`);
            }
            if (suffixPattern) {
              whereParams.push(suffixPattern);
              whereParts.push(`CAST(phones AS TEXT) LIKE $${whereParams.length}`);
            }
            const unlinkedCandRes = await client.query(
              `SELECT id, phone, secondary_phone, phones FROM customers WHERE user_id IS NULL AND (${whereParts.join(' OR ')}) ORDER BY id ASC`,
              whereParams
            );
            const candIds = unlinkedCandRes.rows
              .filter((c) => customerMatchesPhoneDigits(mapPgCustomerRow(c), normPhone))
              .map((c) => c.id)
              .sort();
            const matches = [];
            for (const cid of candIds) {
              const r = await client.query('SELECT * FROM customers WHERE id = $1 AND user_id IS NULL FOR UPDATE', [cid]);
              if (r.rows[0] && customerMatchesPhoneDigits(mapPgCustomerRow(r.rows[0]), normPhone)) {
                matches.push(r.rows[0]);
              }
            }
            if (matches.length > 1) {
              throw new AppError(
                409,
                `رقم الهاتف (${payload.phone}) مسجل لأكثر من عميل غير مربوط (${matches.map((m) => m.name).join('، ')}). يرجى اختيار ملف العميل المراد ربطه يدوياً لتجنب التكرار.`,
                'AMBIGUOUS_CUSTOMER_PHONE'
              );
            }
            if (matches.length === 1) {
              matchedExisting = matches[0];
            }
          }

          if (matchedExisting) {
            await client.query('UPDATE customers SET user_id = $1, updated_at = $2 WHERE id = $3', [id, now, matchedExisting.id]);
            resolvedLinkedCustomerId = matchedExisting.id;
          } else {
            const autoCustId = generateServerId('CUS');
            const autoCode = `CUS-${String(Date.now()).slice(-5)}-${Math.floor(10 + Math.random() * 89)}`;
            const initPhones = normalizeCustomerPhonesList([], payload.phone || '', '');
            await client.query(
              `INSERT INTO customers (id, code, user_id, name, phone, normalized_phone, phones, address, shop_address, opening_balance, current_balance, notes, status, created_at, updated_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,0,0,$9,$10,$11,$11)`,
              [
                autoCustId,
                autoCode,
                id,
                fullName,
                payload.phone || '',
                normPhone,
                JSON.stringify(initPhones),
                payload.address || '',
                payload.notes || 'ملف عميل مُنشأ ومربوط تلقائيًا عند إنشاء حساب الدخول',
                payload.isActive === false ? 'blocked' : 'active',
                now,
              ]
            );
            resolvedLinkedCustomerId = autoCustId;
          }
        }
      } else if (targetRole === 'representative' && payload.linkedRepId) {
        const repRes = await client.query('SELECT * FROM representatives WHERE id = $1 FOR UPDATE', [payload.linkedRepId]);
        const targetRep = repRes.rows[0];
        if (!targetRep) throw new AppError(404, 'سجل المندوب المحدد للربط غير موجود', 'REP_NOT_FOUND');
        if (targetRep.user_id && targetRep.user_id !== id) {
          throw new AppError(409, 'سجل المندوب المختار مربوط مسبقًا بحساب مستخدم آخر', 'REP_ALREADY_LINKED');
        }
        await client.query('UPDATE representatives SET user_id = $1 WHERE id = $2', [id, targetRep.id]);
        resolvedLinkedRepId = targetRep.id;
      } else if (targetRole === 'representative' && payload.autoCreateRepProfile !== false) {
        const vanId = generateServerId('WH');
        const vanCode = `VAN-${String(Date.now()).slice(-4)}-${Math.floor(10 + Math.random() * 89)}`;
        await client.query(
          `INSERT INTO warehouses (id, name, code, location, manager_name, phone, is_default, status, created_at)
           VALUES ($1,$2,$3,'مخزون سيارة مندوب',$4,$5,FALSE,'active',$6)`,
          [vanId, `سيارة المندوب - ${fullName}`, vanCode, fullName, payload.phone || '', now]
        );
        const autoRepId = generateServerId('REP');
        const autoRepCode = `REP-${String(Date.now()).slice(-5)}-${Math.floor(10 + Math.random() * 89)}`;
        await client.query(
          `INSERT INTO representatives (id, code, user_id, name, phone, normalized_phone, vehicle_number, address, opening_balance, current_balance, commission_rate, warehouse_id, notes, status, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,0,0,$9,$10,$11,$12)`,
          [
            autoRepId,
            autoRepCode,
            id,
            fullName,
            payload.phone || '',
            normalizePhoneDigits(payload.phone || ''),
            payload.vehicleNumber || '',
            payload.address || '',
            vanId,
            payload.notes || 'ملف مندوب ومستودع سيارة مُنشأ تلقائيًا عند إنشاء الحساب',
            payload.isActive === false ? 'inactive' : 'active',
            now,
          ]
        );
        resolvedLinkedRepId = autoRepId;
      }

      let sharedIdentityId;
      if (linkedEmployeeId) {
        await client.query('UPDATE employees SET user_id = $1 WHERE id = $2', [id, linkedEmployeeId]);
        sharedIdentityId = await alignEmployeeUserIdentityPgTx(client, {
          userId: id,
          employeeId: linkedEmployeeId,
          preferredIdentityId: payload.identityId || payload.explicitIdentityId || null,
          now,
        });
      } else {
        sharedIdentityId = await attachRecordToIdentityPgTx(client, {
          entityType: 'user',
          entityId: id,
          roleKey: 'user',
          fullName,
          phone: payload.phone || '',
          nationalId: '',
          address: payload.address || '',
          explicitIdentityId: payload.identityId || payload.explicitIdentityId || null,
          isPrimary: true,
          now,
        });
      }
      if (resolvedLinkedCustomerId) {
        await attachRecordToIdentityPgTx(client, {
          entityType: 'customer',
          entityId: resolvedLinkedCustomerId,
          roleKey: 'customer',
          fullName,
          phone: payload.phone || '',
          address: payload.address || '',
          explicitIdentityId: sharedIdentityId,
          matchByUniquePhone: false,
          now,
        });
      }
      if (resolvedLinkedRepId) {
        await attachRecordToIdentityPgTx(client, {
          entityType: 'representative',
          entityId: resolvedLinkedRepId,
          roleKey: 'representative',
          fullName,
          phone: payload.phone || '',
          address: payload.address || '',
          explicitIdentityId: sharedIdentityId,
          now,
        });
      }

      const r = await client.query('SELECT * FROM users WHERE id = $1', [id]);
      const sanitized = sanitizeUser(mapPgUserRow(r.rows[0]));
      return {
        ...sanitized,
        identityId: sanitized.identityId || sharedIdentityId,
        employeeId: sanitized.employeeId || linkedEmployeeId || undefined,
        ...(linkedEmployeeId ? { linkedEmployeeId } : {}),
        ...(resolvedLinkedCustomerId ? { linkedCustomerId: resolvedLinkedCustomerId } : {}),
        ...(resolvedLinkedRepId ? { linkedRepresentativeId: resolvedLinkedRepId } : {}),
      };
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إنشاء حساب مستخدم (${username})`, module: 'المستخدمون', recordId: id });
    return user;
  }

  const user = await withJsonTransaction(async (db) => {
    if (db.users.some((u) => String(u.username || '').toLowerCase() === username.toLowerCase())) {
      throw new AppError(409, 'اسم المستخدم مسجل مسبقًا', 'DUPLICATE_USERNAME');
    }

    const linkedEmployeeId = requestedLinkedEmployeeId || undefined;
    let linkedEmpObj = null;
    if (linkedEmployeeId) {
      linkedEmpObj = (db.employees || []).find((e) => e.id === linkedEmployeeId);
      if (!linkedEmpObj) {
        throw new AppError(404, 'سجل الموظف المحدد للربط غير موجود', 'EMPLOYEE_NOT_FOUND');
      }
      if (linkedEmpObj.userId && linkedEmpObj.userId !== id) {
        throw new AppError(409, 'ملف الموظف المختار مربوط مسبقًا بحساب مستخدم آخر', 'EMPLOYEE_ALREADY_LINKED');
      }
      if ((db.users || []).some((u) => u.id !== id && u.employeeId === linkedEmployeeId)) {
        throw new AppError(409, 'ملف الموظف المختار مربوط مسبقًا بحساب مستخدم آخر', 'EMPLOYEE_ALREADY_LINKED');
      }
    }

    const newUser = {
      id,
      fullName,
      username,
      passwordHash,
      passwordAlgo: 'bcrypt',
      phone: payload.phone || '',
      address: payload.address || '',
      notes: payload.notes || '',
      role: targetRole,
      jobTitle: payload.jobTitle || (targetRole === 'representative' ? 'مندوب مبيعات' : targetRole === 'customer' ? 'عميل' : ''),
      department: payload.department || (targetRole === 'representative' ? 'المندوبون' : targetRole === 'customer' ? 'العملاء' : ''),
      employeeId: linkedEmployeeId,
      activeRole: String(payload.activeRole || targetRole).trim() || targetRole,
      additionalRoles: Array.isArray(payload.additionalRoles) ? payload.additionalRoles : [],
      isActive: payload.isActive ?? true,
      mustChangePassword: Boolean(payload.mustChangePassword),
      permissions: resolvedPermissions,
      createdAt: now,
    };
    db.users.push(newUser);

    let resolvedLinkedCustomerId;
    let resolvedLinkedRepId;
    if (targetRole === 'customer') {
      if (payload.linkedCustomerId) {
        const cust = db.customers.find((c) => c.id === payload.linkedCustomerId);
        if (!cust) {
          throw new AppError(404, 'ملف العميل المحدد للربط غير موجود', 'CUSTOMER_NOT_FOUND');
        }
        if (cust.userId && cust.userId !== id) {
          throw new AppError(409, 'ملف العميل المختار مربوط مسبقًا بحساب مستخدم آخر', 'CUSTOMER_ALREADY_LINKED');
        }
        cust.userId = id;
        resolvedLinkedCustomerId = cust.id;
      } else if (payload.autoCreateCustomerProfile !== false) {
        const normPhone = normalizePhoneDigits(payload.phone);
        let matchedExisting = null;
        if (normPhone && payload.autoMatchExisting !== false && !payload.forceNewCustomerProfile) {
          const matches = (db.customers || []).filter((c) => !c.userId && customerMatchesPhoneDigits(c, normPhone));
          if (matches.length > 1) {
            throw new AppError(
              409,
              `رقم الهاتف (${payload.phone}) مسجل لأكثر من عميل غير مربوط (${matches.map((m) => m.name).join('، ')}). يرجى اختيار ملف العميل المراد ربطه يدوياً لتجنب التكرار.`,
              'AMBIGUOUS_CUSTOMER_PHONE'
            );
          }
          if (matches.length === 1) {
            matchedExisting = matches[0];
          }
        }
        if (matchedExisting) {
          matchedExisting.userId = id;
          matchedExisting.updatedAt = now;
          resolvedLinkedCustomerId = matchedExisting.id;
        } else {
          const autoCustId = generateServerId('CUS');
          const autoCode = `CUS-${String(Date.now()).slice(-5)}-${Math.floor(10 + Math.random() * 89)}`;
          db.customers.unshift({
            id: autoCustId,
            code: autoCode,
            userId: id,
            name: fullName,
            phone: payload.phone || '',
            phones: normalizeCustomerPhonesList([], payload.phone || '', ''),
            address: payload.address || '',
            openingBalance: 0,
            currentBalance: 0,
            priceHistory: {},
            notes: payload.notes || 'ملف عميل مُنشأ ومربوط تلقائيًا عند إنشاء حساب الدخول',
            status: payload.isActive === false ? 'blocked' : 'active',
            createdAt: now,
          });
          resolvedLinkedCustomerId = autoCustId;
        }
      }
    } else if (targetRole === 'representative' && payload.linkedRepId) {
      const targetRep = (db.representatives || []).find((r) => r.id === payload.linkedRepId);
      if (!targetRep) throw new AppError(404, 'سجل المندوب المحدد للربط غير موجود', 'REP_NOT_FOUND');
      if (targetRep.userId && targetRep.userId !== id) {
        throw new AppError(409, 'سجل المندوب المختار مربوط مسبقًا بحساب مستخدم آخر', 'REP_ALREADY_LINKED');
      }
      targetRep.userId = id;
      resolvedLinkedRepId = targetRep.id;
    } else if (targetRole === 'representative' && payload.autoCreateRepProfile !== false) {
      const vanId = generateServerId('WH');
      const vanCode = `VAN-${String(Date.now()).slice(-4)}-${Math.floor(10 + Math.random() * 89)}`;
      db.warehouses.push({
        id: vanId,
        name: `سيارة المندوب - ${fullName}`,
        code: vanCode,
        location: 'مخزون سيارة مندوب',
        managerName: fullName,
        phone: payload.phone || '',
        isDefault: false,
        status: 'active',
      });
      const autoRepId = generateServerId('REP');
      db.representatives.push({
        id: autoRepId,
        userId: id,
        name: fullName,
        phone: payload.phone || '',
        vehicleNumber: payload.vehicleNumber || '',
        warehouseId: vanId,
        openingBalance: 0,
        currentBalance: 0,
        commissionRate: 0,
        notes: payload.notes || 'ملف مندوب ومستودع سيارة مُنشأ تلقائيًا عند إنشاء الحساب',
        status: payload.isActive === false ? 'inactive' : 'active',
      });
      resolvedLinkedRepId = autoRepId;
    }

    let sharedIdentityIdJson;
    if (linkedEmployeeId && linkedEmpObj) {
      linkedEmpObj.userId = id;
      sharedIdentityIdJson = alignEmployeeUserIdentityJsonTx(db, {
        userId: id,
        employeeId: linkedEmployeeId,
        preferredIdentityId: payload.identityId || payload.explicitIdentityId || null,
        now,
      });
    } else {
      sharedIdentityIdJson = attachRecordToIdentityJsonTx(db, {
        entityType: 'user',
        entityId: id,
        roleKey: 'user',
        fullName,
        phone: payload.phone || '',
        nationalId: '',
        address: payload.address || '',
        explicitIdentityId: payload.identityId || payload.explicitIdentityId || null,
        isPrimary: true,
        now,
      });
      newUser.identityId = sharedIdentityIdJson;
    }
    if (resolvedLinkedCustomerId) {
      attachRecordToIdentityJsonTx(db, {
        entityType: 'customer',
        entityId: resolvedLinkedCustomerId,
        roleKey: 'customer',
        fullName,
        phone: payload.phone || '',
        address: payload.address || '',
        explicitIdentityId: sharedIdentityIdJson,
        matchByUniquePhone: false,
        now,
      });
    }
    if (resolvedLinkedRepId) {
      attachRecordToIdentityJsonTx(db, {
        entityType: 'representative',
        entityId: resolvedLinkedRepId,
        roleKey: 'representative',
        fullName,
        phone: payload.phone || '',
        address: payload.address || '',
        explicitIdentityId: sharedIdentityIdJson,
        now,
      });
    }

    const sanitized = sanitizeUser(newUser);
    return {
      ...sanitized,
      identityId: sharedIdentityIdJson,
      ...(linkedEmployeeId ? { linkedEmployeeId, employeeId: linkedEmployeeId } : {}),
      ...(resolvedLinkedCustomerId ? { linkedCustomerId: resolvedLinkedCustomerId } : {}),
      ...(resolvedLinkedRepId ? { linkedRepresentativeId: resolvedLinkedRepId } : {}),
    };
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إنشاء حساب مستخدم (${username})`, module: 'المستخدمون', recordId: id });
  return user;
}

export async function updateAdminUser(userId, updates, actor) {
  const now = nowIso();
  if (updates.role !== undefined) {
    const cleanRole = String(updates.role || '').trim();
    if (!ALLOWED_USER_ROLES.has(cleanRole)) {
      throw new AppError(400, 'الدور الوظيفي المحدد غير صالح', 'INVALID_ROLE');
    }
    if (actor?.role !== 'admin' && cleanRole === 'admin') {
      throw new AppError(403, 'غير مصرح لغير المدير العام بترقية أي حساب إلى مدير عام', 'FORBIDDEN_ADMIN_ESCALATION');
    }
  }
  assertNoPermissionEscalation(updates.permissions, actor);
  const nextPasswordHash = updates.newPassword && String(updates.newPassword).length >= 6 ? await hashPasswordBcrypt(updates.newPassword) : null;

  const liveSettings = await getSystemSettingsSafe();
  const liveExtraSettings = liveSettings.extraSettings || {};

  if (await isPgMode()) {
    const user = await withTransaction(async (client) => {
      const r = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]);
      if (!r.rows[0]) throw new AppError(404, 'المستخدم غير موجود', 'USER_NOT_FOUND');
      const cur = r.rows[0];
      if (actor?.role !== 'admin' && cur.role === 'admin') {
        throw new AppError(403, 'غير مصرح لغير المدير العام بتعديل بيانات أو صلاحيات حساب المدير العام', 'FORBIDDEN_ADMIN_ESCALATION');
      }
      const effectiveRole = updates.role ?? cur.role;
      const rawPerms =
        updates.applyRolePreset === true
          ? resolveDefaultPermissionsForRole(effectiveRole, liveExtraSettings)
          : updates.permissions !== undefined
          ? updates.permissions
          : updates.role !== undefined && updates.role !== cur.role
          ? resolveDefaultPermissionsForRole(effectiveRole, liveExtraSettings)
          : (cur.permissions || resolveDefaultPermissionsForRole(effectiveRole, liveExtraSettings));
      const resolvedPerms = sanitizeEffectivePermissionsForRole(effectiveRole, rawPerms);
      const nextPhoneVal = updates.phone ?? cur.phone ?? '';
      const hasEmpUpdate = updates.linkedEmployeeId !== undefined || updates.employeeId !== undefined;
      const requestedEmpVal = hasEmpUpdate
        ? (String(updates.linkedEmployeeId ?? updates.employeeId ?? '').trim() || null)
        : null;
      if (effectiveRole === 'customer' && requestedEmpVal) {
        throw new AppError(400, 'لا يمكن ربط حساب عميل بملف موظف', 'INVALID_ROLE_EMPLOYEE_LINK');
      }
      const nextEmployeeId =
        effectiveRole === 'customer'
          ? null
          : hasEmpUpdate
          ? requestedEmpVal
          : (cur.employee_id || null);
      const empLinkChanged = (cur.employee_id || null) !== (nextEmployeeId || null);
      let nextEmpRow = null;
      if (nextEmployeeId) {
        const empRes = await client.query('SELECT * FROM employees WHERE id = $1 FOR UPDATE', [nextEmployeeId]);
        nextEmpRow = empRes.rows[0];
        if (!nextEmpRow) throw new AppError(404, 'سجل الموظف المحدد للربط غير موجود', 'EMPLOYEE_NOT_FOUND');
        if (nextEmpRow.user_id && nextEmpRow.user_id !== userId) {
          throw new AppError(409, 'ملف الموظف المختار مربوط مسبقًا بحساب مستخدم آخر', 'EMPLOYEE_ALREADY_LINKED');
        }
        const dupUserEmpRes = await client.query(
          'SELECT id FROM users WHERE employee_id = $1 AND id <> $2 LIMIT 1',
          [nextEmployeeId, userId]
        );
        if (dupUserEmpRes.rows[0]) {
          throw new AppError(409, 'ملف الموظف المختار مربوط مسبقًا بحساب مستخدم آخر', 'EMPLOYEE_ALREADY_LINKED');
        }
      }
      const nextActiveRole = updates.activeRole !== undefined ? updates.activeRole : (cur.active_role || effectiveRole);
      const nextAdditionalRoles =
        updates.additionalRoles !== undefined
          ? (Array.isArray(updates.additionalRoles) ? updates.additionalRoles : [])
          : (Array.isArray(cur.additional_roles) ? cur.additional_roles : []);

      await client.query(
        `UPDATE users SET full_name = $1, phone = $2, normalized_phone = $3, address = $4, notes = $5, role = $6, job_title = $7, department = $8, employee_id = $9, active_role = $10, additional_roles = $11, is_active = $12, must_change_password = $13, permissions = $14, updated_at = $15 WHERE id = $16`,
        [
          updates.fullName ?? cur.full_name,
          nextPhoneVal,
          normalizePhoneDigits(nextPhoneVal),
          updates.address ?? cur.address,
          updates.notes ?? cur.notes,
          effectiveRole,
          updates.jobTitle ?? cur.job_title,
          updates.department ?? cur.department,
          nextEmployeeId,
          nextActiveRole,
          JSON.stringify(nextAdditionalRoles),
          updates.isActive ?? cur.is_active,
          updates.mustChangePassword ?? cur.must_change_password,
          JSON.stringify(resolvedPerms),
          now,
          userId,
        ]
      );
      if (empLinkChanged) {
        if (cur.employee_id && cur.employee_id !== nextEmployeeId) {
          await client.query('UPDATE employees SET user_id = NULL WHERE id = $1 AND user_id = $2', [cur.employee_id, userId]);
          await splitDetachedEmployeeUserIdentityPgTx(client, {
            detachType: 'employee',
            detachId: cur.employee_id,
            sharedIdentityId: cur.identity_id,
            now,
          });
        }
        await client.query('UPDATE employees SET user_id = NULL WHERE user_id = $1 AND ($2::varchar IS NULL OR id <> $2)', [
          userId,
          nextEmployeeId,
        ]);
      }
      if (nextEmployeeId) {
        await client.query('UPDATE employees SET user_id = $1 WHERE id = $2', [userId, nextEmployeeId]);
      }
      if (nextPasswordHash) {
        await client.query(`UPDATE users SET password_hash = $1, password_algo = 'bcrypt' WHERE id = $2`, [nextPasswordHash, userId]);
      }
      if (updates.isActive === false) {
        await client.query(`UPDATE user_sessions SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL`, [now, userId]);
      }
      let resolvedLinkedCustomerId;
      if (effectiveRole === 'customer' && updates.linkedCustomerId) {
        const targetRes = await client.query('SELECT id, user_id FROM customers WHERE id = $1 FOR UPDATE', [updates.linkedCustomerId]);
        const target = targetRes.rows[0];
        if (!target) throw new AppError(404, 'ملف العميل المحدد للربط غير موجود', 'CUSTOMER_NOT_FOUND');
        if (target.user_id && target.user_id !== userId) {
          throw new AppError(409, 'ملف العميل المختار مربوط مسبقًا بحساب مستخدم آخر', 'CUSTOMER_ALREADY_LINKED');
        }
        await client.query('UPDATE customers SET user_id = NULL, updated_at = $1 WHERE user_id = $2 AND id <> $3', [now, userId, target.id]);
        await client.query('UPDATE customers SET user_id = $1, updated_at = $2 WHERE id = $3', [userId, now, target.id]);
        resolvedLinkedCustomerId = target.id;
      } else if (effectiveRole === 'customer' && updates.autoCreateCustomerProfile === true) {
        const curLinked = await client.query('SELECT id FROM customers WHERE user_id = $1 LIMIT 1', [userId]);
        if (!curLinked.rows[0]) {
          const targetPhone = updates.phone ?? cur.phone ?? '';
          const normPhone = normalizePhoneDigits(targetPhone);
          let matchedExisting = null;
          if (normPhone && updates.autoMatchExisting !== false && !updates.forceNewCustomerProfile) {
            const { variants: phoneVariants, suffixPattern } = buildPhoneLookupVariants(targetPhone);
            const whereParts = [`normalized_phone = $1`];
            const whereParams = [normPhone];
            if (phoneVariants.length > 0) {
              const ph = phoneVariants
                .map((v) => {
                  whereParams.push(v);
                  return `$${whereParams.length}`;
                })
                .join(', ');
              whereParts.push(`phone IN (${ph})`);
              whereParts.push(`secondary_phone IN (${ph})`);
            }
            if (suffixPattern) {
              whereParams.push(suffixPattern);
              whereParts.push(`CAST(phones AS TEXT) LIKE $${whereParams.length}`);
            }
            const unlinkedCandRes = await client.query(
              `SELECT id, phone, secondary_phone, phones FROM customers WHERE user_id IS NULL AND (${whereParts.join(' OR ')}) ORDER BY id ASC`,
              whereParams
            );
            const candIds = unlinkedCandRes.rows
              .filter((c) => customerMatchesPhoneDigits(mapPgCustomerRow(c), normPhone))
              .map((c) => c.id)
              .sort();
            const matches = [];
            for (const cid of candIds) {
              const r = await client.query('SELECT * FROM customers WHERE id = $1 AND user_id IS NULL FOR UPDATE', [cid]);
              if (r.rows[0] && customerMatchesPhoneDigits(mapPgCustomerRow(r.rows[0]), normPhone)) {
                matches.push(r.rows[0]);
              }
            }
            if (matches.length > 1) {
              throw new AppError(
                409,
                `رقم الهاتف (${targetPhone}) مسجل لأكثر من عميل غير مربوط (${matches.map((m) => m.name).join('، ')}). يرجى اختيار ملف العميل المراد ربطه يدوياً لتجنب التكرار.`,
                'AMBIGUOUS_CUSTOMER_PHONE'
              );
            }
            if (matches.length === 1) {
              matchedExisting = matches[0];
            }
          }

          if (matchedExisting) {
            await client.query('UPDATE customers SET user_id = $1, updated_at = $2 WHERE id = $3', [userId, now, matchedExisting.id]);
            resolvedLinkedCustomerId = matchedExisting.id;
          } else {
            const autoCustId = generateServerId('CUS');
            const autoCode = `CUS-${String(Date.now()).slice(-5)}-${Math.floor(10 + Math.random() * 89)}`;
            const initPhones = normalizeCustomerPhonesList([], targetPhone, '');
            await client.query(
              `INSERT INTO customers (id, code, user_id, name, phone, normalized_phone, phones, address, shop_address, opening_balance, current_balance, notes, status, created_at, updated_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,0,0,$9,$10,$11,$11)`,
              [
                autoCustId,
                autoCode,
                userId,
                updates.fullName ?? cur.full_name,
                targetPhone,
                normPhone,
                JSON.stringify(initPhones),
                updates.address ?? cur.address ?? '',
                'ملف عميل مُنشأ تلقائيًا',
                (updates.isActive ?? cur.is_active) === false ? 'blocked' : 'active',
                now,
              ]
            );
            resolvedLinkedCustomerId = autoCustId;
          }
        }
      }
      let resolvedLinkedRepId;
      const shouldEnsureRepProfile =
        effectiveRole === 'representative' &&
        (updates.autoCreateRepProfile === true ||
          (updates.role === 'representative' && cur.role !== 'representative' && updates.autoCreateRepProfile !== false));
      if (shouldEnsureRepProfile) {
        const curLinkedRep = await client.query('SELECT * FROM representatives WHERE user_id = $1 LIMIT 1', [userId]);
        if (curLinkedRep.rows[0]) {
          resolvedLinkedRepId = curLinkedRep.rows[0].id;
          if (!curLinkedRep.rows[0].warehouse_id) {
            const vanId = generateServerId('WH');
            const vanCode = `VAN-${String(Date.now()).slice(-4)}-${Math.floor(10 + Math.random() * 89)}`;
            const repDisplayName = curLinkedRep.rows[0].name || updates.fullName || cur.full_name;
            await client.query(
              `INSERT INTO warehouses (id, name, code, location, manager_name, phone, is_default, status, created_at)
               VALUES ($1,$2,$3,'مخزون سيارة مندوب',$4,$5,FALSE,'active',$6)`,
              [vanId, `سيارة المندوب - ${repDisplayName}`, vanCode, repDisplayName, updates.phone ?? cur.phone ?? '', now]
            );
            await client.query('UPDATE representatives SET warehouse_id = $1 WHERE id = $2', [vanId, resolvedLinkedRepId]);
          }
        } else {
          const repPhone = updates.phone ?? cur.phone ?? '';
          const normPhone = normalizePhoneDigits(repPhone);
          let matchedRep = null;
          if (normPhone && updates.autoMatchExisting !== false) {
            const { variants: repPhoneVariants } = buildPhoneLookupVariants(repPhone);
            const repWhereParts = [`normalized_phone = $1`];
            const repWhereParams = [normPhone];
            if (repPhoneVariants.length > 0) {
              const ph = repPhoneVariants
                .map((v) => {
                  repWhereParams.push(v);
                  return `$${repWhereParams.length}`;
                })
                .join(', ');
              repWhereParts.push(`phone IN (${ph})`);
            }
            const unlinkedRepsCandRes = await client.query(
              `SELECT id, phone FROM representatives WHERE user_id IS NULL AND (${repWhereParts.join(' OR ')}) ORDER BY id ASC`,
              repWhereParams
            );
            const repCandIds = unlinkedRepsCandRes.rows
              .filter((rp) => normalizePhoneDigits(rp.phone) === normPhone)
              .map((rp) => rp.id)
              .sort();
            const matches = [];
            for (const rid of repCandIds) {
              const r = await client.query('SELECT * FROM representatives WHERE id = $1 AND user_id IS NULL FOR UPDATE', [rid]);
              if (r.rows[0] && normalizePhoneDigits(r.rows[0].phone) === normPhone) {
                matches.push(r.rows[0]);
              }
            }
            if (matches.length === 1) matchedRep = matches[0];
          }
          if (matchedRep) {
            let targetWhId = matchedRep.warehouse_id || null;
            if (!targetWhId) {
              targetWhId = generateServerId('WH');
              const vanCode = `VAN-${String(Date.now()).slice(-4)}-${Math.floor(10 + Math.random() * 89)}`;
              const repDisplayName = matchedRep.name || updates.fullName || cur.full_name;
              await client.query(
                `INSERT INTO warehouses (id, name, code, location, manager_name, phone, is_default, status, created_at)
                 VALUES ($1,$2,$3,'مخزون سيارة مندوب',$4,$5,FALSE,'active',$6)`,
                [targetWhId, `سيارة المندوب - ${repDisplayName}`, vanCode, repDisplayName, repPhone, now]
              );
            }
            await client.query('UPDATE representatives SET user_id = $1, warehouse_id = $2 WHERE id = $3', [
              userId,
              targetWhId,
              matchedRep.id,
            ]);
            resolvedLinkedRepId = matchedRep.id;
          } else {
            const repDisplayName = updates.fullName ?? cur.full_name;
            const vanId = generateServerId('WH');
            const vanCode = `VAN-${String(Date.now()).slice(-4)}-${Math.floor(10 + Math.random() * 89)}`;
            await client.query(
              `INSERT INTO warehouses (id, name, code, location, manager_name, phone, is_default, status, created_at)
               VALUES ($1,$2,$3,'مخزون سيارة مندوب',$4,$5,FALSE,'active',$6)`,
              [vanId, `سيارة المندوب - ${repDisplayName}`, vanCode, repDisplayName, repPhone, now]
            );
            const autoRepId = generateServerId('REP');
            const repCode = `REP-${String(Date.now()).slice(-5)}`;
            await client.query(
              `INSERT INTO representatives (id, code, user_id, name, phone, normalized_phone, vehicle_number, address, opening_balance, current_balance, commission_rate, warehouse_id, notes, status, created_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,0,0,$9,$10,$11,$12)`,
              [
                autoRepId,
                repCode,
                userId,
                repDisplayName,
                repPhone,
                normPhone,
                updates.vehicleNumber || '',
                updates.address ?? cur.address ?? '',
                vanId,
                updates.notes || 'ملف مندوب ومستودع سيارة مُنشأ تلقائيًا عند تحديث الحساب',
                (updates.isActive ?? cur.is_active) === false ? 'inactive' : 'active',
                now,
              ]
            );
            resolvedLinkedRepId = autoRepId;
          }
        }
      } else if (effectiveRole === 'representative') {
        const curLinkedRep = await client.query('SELECT id FROM representatives WHERE user_id = $1 LIMIT 1', [userId]);
        if (curLinkedRep.rows[0]) resolvedLinkedRepId = curLinkedRep.rows[0].id;
      }
      let sharedUpdIdentityId;
      if (nextEmployeeId) {
        sharedUpdIdentityId = await alignEmployeeUserIdentityPgTx(client, {
          userId,
          employeeId: nextEmployeeId,
          preferredIdentityId: updates.identityId || updates.explicitIdentityId || null,
          now,
        });
      } else {
        sharedUpdIdentityId = await attachRecordToIdentityPgTx(client, {
          entityType: 'user',
          entityId: userId,
          roleKey: 'user',
          fullName: updates.fullName ?? cur.full_name,
          phone: nextPhoneVal,
          nationalId: '',
          address: updates.address ?? cur.address ?? '',
          explicitIdentityId: updates.identityId || updates.explicitIdentityId || cur.identity_id || null,
          isPrimary: true,
          now,
        });
      }
      if (resolvedLinkedCustomerId) {
        await attachRecordToIdentityPgTx(client, {
          entityType: 'customer',
          entityId: resolvedLinkedCustomerId,
          roleKey: 'customer',
          fullName: updates.fullName ?? cur.full_name,
          phone: nextPhoneVal,
          explicitIdentityId: sharedUpdIdentityId,
          matchByUniquePhone: false,
          now,
        });
      }
      if (resolvedLinkedRepId) {
        await attachRecordToIdentityPgTx(client, {
          entityType: 'representative',
          entityId: resolvedLinkedRepId,
          roleKey: 'representative',
          fullName: updates.fullName ?? cur.full_name,
          phone: nextPhoneVal,
          explicitIdentityId: sharedUpdIdentityId,
          now,
        });
      }

      const next = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
      const sanitized = sanitizeUser(mapPgUserRow(next.rows[0]));
      return {
        ...sanitized,
        identityId: sanitized.identityId || sharedUpdIdentityId,
        ...(resolvedLinkedCustomerId ? { linkedCustomerId: resolvedLinkedCustomerId } : {}),
        ...(resolvedLinkedRepId ? { linkedRepresentativeId: resolvedLinkedRepId } : {}),
      };
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تحديث حساب مستخدم (${user.username})`, module: 'المستخدمون', recordId: userId });
    return user;
  }

  const user = await withJsonTransaction(async (db) => {
    const idx = db.users.findIndex((u) => u.id === userId);
    if (idx === -1) throw new AppError(404, 'المستخدم غير موجود', 'USER_NOT_FOUND');
    const cur = db.users[idx];
    if (actor?.role !== 'admin' && cur.role === 'admin') {
      throw new AppError(403, 'غير مصرح لغير المدير العام بتعديل بيانات أو صلاحيات حساب المدير العام', 'FORBIDDEN_ADMIN_ESCALATION');
    }
    const {
      newPassword,
      passwordHash: _ignoredHash,
      linkedCustomerId,
      linkedEmployeeId: rawLinkedEmployeeId,
      employeeId: rawEmployeeId,
      linkedRepId,
      identityId: rawIdentityId,
      explicitIdentityId: rawExplicitIdentityId,
      autoCreateCustomerProfile,
      autoCreateRepProfile,
      autoMatchExisting,
      forceNewCustomerProfile,
      applyRolePreset,
      ...rest
    } = updates;
    const effectiveRole = rest.role ?? cur.role;
    const hasEmpUpdate = rawLinkedEmployeeId !== undefined || rawEmployeeId !== undefined;
    const requestedEmpVal = hasEmpUpdate ? (String(rawLinkedEmployeeId ?? rawEmployeeId ?? '').trim() || undefined) : undefined;
    if (effectiveRole === 'customer' && requestedEmpVal) {
      throw new AppError(400, 'لا يمكن ربط حساب عميل بملف موظف', 'INVALID_ROLE_EMPLOYEE_LINK');
    }
    const nextEmployeeId =
      effectiveRole === 'customer'
        ? undefined
        : hasEmpUpdate
        ? requestedEmpVal
        : cur.employeeId;
    const empLinkChanged = (cur.employeeId || null) !== (nextEmployeeId || null);
    let nextEmpObj = null;
    if (nextEmployeeId) {
      nextEmpObj = (db.employees || []).find((e) => e.id === nextEmployeeId);
      if (!nextEmpObj) throw new AppError(404, 'سجل الموظف المحدد للربط غير موجود', 'EMPLOYEE_NOT_FOUND');
      if (nextEmpObj.userId && nextEmpObj.userId !== userId) {
        throw new AppError(409, 'ملف الموظف المختار مربوط مسبقًا بحساب مستخدم آخر', 'EMPLOYEE_ALREADY_LINKED');
      }
      if ((db.users || []).some((u) => u.id !== userId && u.employeeId === nextEmployeeId)) {
        throw new AppError(409, 'ملف الموظف المختار مربوط مسبقًا بحساب مستخدم آخر', 'EMPLOYEE_ALREADY_LINKED');
      }
    }
    const rawPerms =
      applyRolePreset === true
        ? resolveDefaultPermissionsForRole(effectiveRole, liveExtraSettings)
        : updates.permissions !== undefined
        ? updates.permissions
        : updates.role !== undefined && updates.role !== cur.role
        ? resolveDefaultPermissionsForRole(effectiveRole, liveExtraSettings)
        : (cur.permissions || resolveDefaultPermissionsForRole(effectiveRole, liveExtraSettings));
    const resolvedPerms = sanitizeEffectivePermissionsForRole(effectiveRole, rawPerms);
    db.users[idx] = {
      ...cur,
      ...rest,
      id: cur.id,
      employeeId: nextEmployeeId,
      activeRole: rest.activeRole ?? cur.activeRole ?? effectiveRole,
      additionalRoles: Array.isArray(rest.additionalRoles) ? rest.additionalRoles : cur.additionalRoles,
      permissions: resolvedPerms,
      passwordHash: nextPasswordHash || cur.passwordHash,
      passwordAlgo: nextPasswordHash ? 'bcrypt' : cur.passwordAlgo,
    };
    if (empLinkChanged) {
      if (cur.employeeId && cur.employeeId !== nextEmployeeId) {
        const oldEmp = (db.employees || []).find((e) => e.id === cur.employeeId);
        if (oldEmp && oldEmp.userId === userId) oldEmp.userId = undefined;
        splitDetachedEmployeeUserIdentityJsonTx(db, {
          detachType: 'employee',
          detachId: cur.employeeId,
          sharedIdentityId: cur.identityId,
          now,
        });
      }
      for (const emp of db.employees || []) {
        if (emp.userId === userId && emp.id !== nextEmployeeId) emp.userId = undefined;
      }
    }
    if (nextEmployeeId && nextEmpObj) {
      nextEmpObj.userId = userId;
    }
    let resolvedLinkedCustomerId;
    if (effectiveRole === 'customer' && linkedCustomerId) {
      const target = db.customers.find((c) => c.id === linkedCustomerId);
      if (!target) throw new AppError(404, 'ملف العميل المحدد للربط غير موجود', 'CUSTOMER_NOT_FOUND');
      if (target.userId && target.userId !== userId) {
        throw new AppError(409, 'ملف العميل المختار مربوط مسبقًا بحساب مستخدم آخر', 'CUSTOMER_ALREADY_LINKED');
      }
      db.customers.forEach((c) => {
        if (c.userId === userId && c.id !== target.id) c.userId = undefined;
      });
      target.userId = userId;
      resolvedLinkedCustomerId = target.id;
    } else if (effectiveRole === 'customer' && autoCreateCustomerProfile === true) {
      const existing = db.customers.find((c) => c.userId === userId);
      if (!existing) {
        const targetPhone = db.users[idx].phone || '';
        const normPhone = normalizePhoneDigits(targetPhone);
        let matchedExisting = null;
        if (normPhone && autoMatchExisting !== false && !forceNewCustomerProfile) {
          const matches = (db.customers || []).filter((c) => !c.userId && customerMatchesPhoneDigits(c, normPhone));
          if (matches.length > 1) {
            throw new AppError(
              409,
              `رقم الهاتف (${targetPhone}) مسجل لأكثر من عميل غير مربوط (${matches.map((m) => m.name).join('، ')}). يرجى اختيار ملف العميل المراد ربطه يدوياً لتجنب التكرار.`,
              'AMBIGUOUS_CUSTOMER_PHONE'
            );
          }
          if (matches.length === 1) {
            matchedExisting = matches[0];
          }
        }
        if (matchedExisting) {
          matchedExisting.userId = userId;
          matchedExisting.updatedAt = now;
          resolvedLinkedCustomerId = matchedExisting.id;
        } else {
          const autoCustId = generateServerId('CUS');
          const autoCode = `CUS-${String(Date.now()).slice(-5)}-${Math.floor(10 + Math.random() * 89)}`;
          db.customers.unshift({
            id: autoCustId,
            code: autoCode,
            userId,
            name: db.users[idx].fullName,
            phone: targetPhone,
            phones: normalizeCustomerPhonesList([], targetPhone, ''),
            address: db.users[idx].address || '',
            openingBalance: 0,
            currentBalance: 0,
            priceHistory: {},
            notes: 'ملف عميل مُنشأ تلقائيًا',
            status: db.users[idx].isActive === false ? 'blocked' : 'active',
            createdAt: now,
          });
          resolvedLinkedCustomerId = autoCustId;
        }
      }
    }
    let resolvedLinkedRepId;
    const shouldEnsureRepProfile =
      effectiveRole === 'representative' &&
      (autoCreateRepProfile === true ||
        (updates.role === 'representative' && cur.role !== 'representative' && autoCreateRepProfile !== false));
    if (shouldEnsureRepProfile) {
      const existingRep = (db.representatives || []).find((rp) => rp.userId === userId);
      if (existingRep) {
        resolvedLinkedRepId = existingRep.id;
        if (!existingRep.warehouseId) {
          const vanId = generateServerId('WH');
          const vanCode = `VAN-${String(Date.now()).slice(-4)}-${Math.floor(10 + Math.random() * 89)}`;
          const repDisplayName = existingRep.name || db.users[idx].fullName;
          db.warehouses.push({
            id: vanId,
            name: `سيارة المندوب - ${repDisplayName}`,
            code: vanCode,
            location: 'مخزون سيارة مندوب',
            managerName: repDisplayName,
            phone: db.users[idx].phone || '',
            isDefault: false,
            status: 'active',
          });
          existingRep.warehouseId = vanId;
        }
      } else {
        const repPhone = db.users[idx].phone || '';
        const normPhone = normalizePhoneDigits(repPhone);
        const unlinkedMatches = normPhone
          ? (db.representatives || []).filter((rp) => !rp.userId && normalizePhoneDigits(rp.phone) === normPhone)
          : [];
        if (unlinkedMatches.length === 1) {
          const matchedRep = unlinkedMatches[0];
          if (!matchedRep.warehouseId) {
            const vanId = generateServerId('WH');
            const vanCode = `VAN-${String(Date.now()).slice(-4)}-${Math.floor(10 + Math.random() * 89)}`;
            const repDisplayName = matchedRep.name || db.users[idx].fullName;
            db.warehouses.push({
              id: vanId,
              name: `سيارة المندوب - ${repDisplayName}`,
              code: vanCode,
              location: 'مخزون سيارة مندوب',
              managerName: repDisplayName,
              phone: repPhone,
              isDefault: false,
              status: 'active',
            });
            matchedRep.warehouseId = vanId;
          }
          matchedRep.userId = userId;
          resolvedLinkedRepId = matchedRep.id;
        } else {
          const vanId = generateServerId('WH');
          const vanCode = `VAN-${String(Date.now()).slice(-4)}-${Math.floor(10 + Math.random() * 89)}`;
          const repDisplayName = db.users[idx].fullName;
          db.warehouses.push({
            id: vanId,
            name: `سيارة المندوب - ${repDisplayName}`,
            code: vanCode,
            location: 'مخزون سيارة مندوب',
            managerName: repDisplayName,
            phone: repPhone,
            isDefault: false,
            status: 'active',
          });
          const autoRepId = generateServerId('REP');
          db.representatives.push({
            id: autoRepId,
            userId,
            name: repDisplayName,
            phone: repPhone,
            vehicleNumber: updates.vehicleNumber || '',
            warehouseId: vanId,
            openingBalance: 0,
            currentBalance: 0,
            commissionRate: 0,
            notes: updates.notes || 'ملف مندوب ومستودع سيارة مُنشأ تلقائيًا عند تحديث الحساب',
            status: db.users[idx].isActive === false ? 'inactive' : 'active',
          });
          resolvedLinkedRepId = autoRepId;
        }
      }
    } else if (effectiveRole === 'representative') {
      const existingRep = (db.representatives || []).find((rp) => rp.userId === userId);
      if (existingRep) resolvedLinkedRepId = existingRep.id;
    }
    let sharedUpdJsonIdentityId;
    if (nextEmployeeId && nextEmpObj) {
      sharedUpdJsonIdentityId = alignEmployeeUserIdentityJsonTx(db, {
        userId,
        employeeId: nextEmployeeId,
        preferredIdentityId: rawIdentityId || rawExplicitIdentityId || null,
        now,
      });
    } else {
      sharedUpdJsonIdentityId = attachRecordToIdentityJsonTx(db, {
        entityType: 'user',
        entityId: userId,
        roleKey: 'user',
        fullName: db.users[idx].fullName,
        phone: db.users[idx].phone || '',
        nationalId: '',
        address: db.users[idx].address || '',
        explicitIdentityId: rawIdentityId || rawExplicitIdentityId || cur.identityId || null,
        isPrimary: true,
        now,
      });
      db.users[idx].identityId = sharedUpdJsonIdentityId;
    }
    if (resolvedLinkedCustomerId) {
      attachRecordToIdentityJsonTx(db, {
        entityType: 'customer',
        entityId: resolvedLinkedCustomerId,
        roleKey: 'customer',
        fullName: db.users[idx].fullName,
        phone: db.users[idx].phone || '',
        explicitIdentityId: sharedUpdJsonIdentityId,
        matchByUniquePhone: false,
        now,
      });
    }
    if (resolvedLinkedRepId) {
      attachRecordToIdentityJsonTx(db, {
        entityType: 'representative',
        entityId: resolvedLinkedRepId,
        roleKey: 'representative',
        fullName: db.users[idx].fullName,
        phone: db.users[idx].phone || '',
        explicitIdentityId: sharedUpdJsonIdentityId,
        now,
      });
    }

    const sanitized = sanitizeUser(db.users[idx]);
    return {
      ...sanitized,
      identityId: sharedUpdJsonIdentityId,
      ...(resolvedLinkedCustomerId ? { linkedCustomerId: resolvedLinkedCustomerId } : {}),
      ...(resolvedLinkedRepId ? { linkedRepresentativeId: resolvedLinkedRepId } : {}),
    };
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تحديث حساب مستخدم (${user.username})`, module: 'المستخدمون', recordId: userId });
  return user;
}

export async function deleteAdminUser(userId, actor) {
  if (userId === actor.id) throw new AppError(400, 'لا يمكنك حذف حسابك النشط حاليًا', 'CANNOT_DELETE_SELF');

  if (await isPgMode()) {
    const uname = await withTransaction(async (client) => {
      const r = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]);
      if (!r.rows[0]) throw new AppError(404, 'المستخدم غير موجود', 'USER_NOT_FOUND');
      if (actor?.role !== 'admin' && r.rows[0].role === 'admin') {
        throw new AppError(403, 'غير مصرح لغير المدير العام بحذف حساب المدير العام', 'FORBIDDEN_ADMIN_ESCALATION');
      }
      if (r.rows[0].role === 'admin') {
        const cntRes = await client.query(`SELECT COUNT(*)::int AS cnt FROM users WHERE role = 'admin' AND is_active = TRUE`);
        if (Number(cntRes.rows[0]?.cnt || 0) <= 1) {
          throw new AppError(409, 'لا يمكن حذف آخر حساب مدير عام نشط في النظام', 'LAST_ADMIN');
        }
      }
      await client.query(`DELETE FROM identity_roles WHERE linked_record_type = 'user' AND linked_record_id = $1`, [userId]);
      await client.query('UPDATE employees SET user_id = NULL WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM users WHERE id = $1', [userId]);
      return r.rows[0].username;
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `حذف مستخدم (${uname})`, module: 'المستخدمون', recordId: userId });
    return { ok: true };
  }

  const uname = await withJsonTransaction(async (db) => {
    const target = db.users.find((u) => u.id === userId);
    if (!target) throw new AppError(404, 'المستخدم غير موجود', 'USER_NOT_FOUND');
    if (actor?.role !== 'admin' && target.role === 'admin') {
      throw new AppError(403, 'غير مصرح لغير المدير العام بحذف حساب المدير العام', 'FORBIDDEN_ADMIN_ESCALATION');
    }
    if (target.role === 'admin' && db.users.filter((u) => u.role === 'admin' && u.isActive).length <= 1) {
      throw new AppError(409, 'لا يمكن حذف آخر حساب مدير عام نشط في النظام', 'LAST_ADMIN');
    }
    db.customers = (db.customers || []).map((c) => (c.userId === userId ? { ...c, userId: undefined } : c));
    db.employees = (db.employees || []).map((e) => (e.userId === userId ? { ...e, userId: undefined } : e));
    db.representatives = (db.representatives || []).map((r) => (r.userId === userId ? { ...r, userId: undefined } : r));
    db.identityRoles = (db.identityRoles || []).filter(
      (ir) => !(ir.linkedRecordType === 'user' && ir.linkedRecordId === userId)
    );
    db.users = db.users.filter((u) => u.id !== userId);
    return target.username;
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `حذف مستخدم (${uname})`, module: 'المستخدمون', recordId: userId });
  return { ok: true };
}

// ==============================================================================
// Suppliers, Cashboxes, Expenses, Cheques, Installments, HR, Reps, Settings
// ==============================================================================

export async function createSupplier(payload, actor) {
  const id = generateServerId('SUPP');
  const code = String(payload.code || `S-${Date.now().toString().slice(-5)}`).trim();
  const opening = round2(payload.openingBalance || 0);
  const now = nowIso();
  const phone = String(payload.phone || '').trim();
  const normPhone = normalizePhoneDigits(phone);
  let resolvedIdentityId;

  if (await isPgMode()) {
    resolvedIdentityId = await withTransaction(async (client) => {
      await assertNoSameRoleDuplicatesPgTx(client, {
        entityType: 'supplier',
        phone,
        allowPhoneOverlap: Boolean(payload.allowPhoneOverlap),
      });
      await client.query(
        `INSERT INTO suppliers (id, code, name, phone, normalized_phone, address, opening_balance, current_balance, notes, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10)`,
        [id, code, payload.name, phone, normPhone, payload.address || '', opening, payload.notes || '', payload.status || 'active', now]
      );
      return attachRecordToIdentityPgTx(client, {
        entityType: 'supplier',
        entityId: id,
        roleKey: 'supplier',
        fullName: payload.name,
        phone,
        address: payload.address || '',
        notes: payload.notes || '',
        identityType: payload.companyName ? 'organization' : 'person',
        explicitIdentityId: payload.identityId || null,
        linkedUserId: payload.userId || null,
        now,
      });
    });
  } else {
    resolvedIdentityId = await withJsonTransaction((db) => {
      assertNoSameRoleDuplicatesJsonTx(db, {
        entityType: 'supplier',
        phone,
        allowPhoneOverlap: Boolean(payload.allowPhoneOverlap),
      });
      const item = { ...payload, id, code, phone, openingBalance: opening, currentBalance: opening, createdAt: now };
      db.suppliers.unshift(item);
      const idnId = attachRecordToIdentityJsonTx(db, {
        entityType: 'supplier',
        entityId: id,
        roleKey: 'supplier',
        fullName: payload.name,
        phone,
        address: payload.address || '',
        notes: payload.notes || '',
        identityType: payload.companyName ? 'organization' : 'person',
        explicitIdentityId: payload.identityId || null,
        linkedUserId: payload.userId || null,
        now,
      });
      item.identityId = idnId;
      return idnId;
    });
  }
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إضافة مورد (${payload.name})`, module: 'الموردون', recordId: id });
  return { ...payload, id, code, identityId: resolvedIdentityId, openingBalance: opening, currentBalance: opening, createdAt: now };
}

export async function updateSupplier(id, updates, actor) {
  const now = nowIso();
  if (await isPgMode()) {
    await withTransaction(async (client) => {
      const existing = await client.query('SELECT * FROM suppliers WHERE id = $1 FOR UPDATE', [id]);
      const cur = existing.rows[0];
      if (!cur) throw new AppError(404, 'المورد غير موجود', 'SUPPLIER_NOT_FOUND');
      if (updates.phone !== undefined) {
        await assertNoSameRoleDuplicatesPgTx(client, {
          entityType: 'supplier',
          excludeEntityId: id,
          phone: updates.phone,
          allowPhoneOverlap: Boolean(updates.allowPhoneOverlap),
        });
      }
      const nextPhone = updates.phone !== undefined ? String(updates.phone || '') : cur.phone;
      await client.query(
        `UPDATE suppliers SET name = COALESCE($1, name), phone = $2, normalized_phone = $3, address = COALESCE($4, address), notes = COALESCE($5, notes), status = COALESCE($6, status) WHERE id = $7`,
        [updates.name ?? null, nextPhone, normalizePhoneDigits(nextPhone), updates.address ?? null, updates.notes ?? null, updates.status ?? null, id]
      );
      await attachRecordToIdentityPgTx(client, {
        entityType: 'supplier',
        entityId: id,
        roleKey: 'supplier',
        fullName: updates.name ?? cur.name,
        phone: nextPhone || '',
        address: updates.address ?? cur.address ?? '',
        notes: updates.notes ?? cur.notes ?? '',
        explicitIdentityId: updates.identityId || cur.identity_id || null,
        now,
      });
    });
  } else {
    await withJsonTransaction((db) => {
      if (updates.phone !== undefined) {
        assertNoSameRoleDuplicatesJsonTx(db, {
          entityType: 'supplier',
          excludeEntityId: id,
          phone: updates.phone,
          allowPhoneOverlap: Boolean(updates.allowPhoneOverlap),
        });
      }
      let targetSupp = null;
      db.suppliers = db.suppliers.map((s) => {
        if (s.id !== id) return s;
        targetSupp = { ...s, ...updates, id };
        return targetSupp;
      });
      if (targetSupp) {
        targetSupp.identityId = attachRecordToIdentityJsonTx(db, {
          entityType: 'supplier',
          entityId: id,
          roleKey: 'supplier',
          fullName: targetSupp.name,
          phone: targetSupp.phone || '',
          address: targetSupp.address || '',
          notes: targetSupp.notes || '',
          explicitIdentityId: updates.identityId || targetSupp.identityId || null,
          now,
        });
      }
    });
  }
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تحديث مورد`, module: 'الموردون', recordId: id });
  return { ok: true };
}

export async function deleteSupplier(id, actor) {
  if (await isPgMode()) {
    const used = await getPool().query('SELECT id FROM invoices WHERE supplier_id = $1 LIMIT 1', [id]);
    if (used.rows[0]) throw new AppError(409, 'لا يمكن حذف مورد مرتبط بفواتير مشتريات', 'SUPPLIER_IN_USE');
    await getPool().query('DELETE FROM suppliers WHERE id = $1', [id]);
  } else {
    await withJsonTransaction((db) => {
      if (db.invoices.some((i) => i.supplierId === id)) throw new AppError(409, 'لا يمكن حذف مورد مرتبط بفواتير', 'SUPPLIER_IN_USE');
      db.suppliers = db.suppliers.filter((s) => s.id !== id);
    });
  }
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `حذف مورد`, module: 'الموردون', recordId: id });
  return { ok: true };
}

export async function recordSupplierPayment({ supplierId, amount, cashboxId, notes = '', date }, actor, idempotencyKey = '') {
  if (actor?.role === 'representative' || actor?.role === 'customer') {
    throw new AppError(403, 'العمليات الإدارية للخزائن والموردين غير متاحة للمندوبين', 'FORBIDDEN_REP_CASHBOX_OP');
  }
  const payAmount = round2(amount);
  if (!Number.isFinite(payAmount) || payAmount <= 0) throw new AppError(400, 'المبلغ يجب أن يكون أكبر من صفر', 'INVALID_AMOUNT');
  const canApproveOverpayment =
    actor?.role === 'admin' || actor?.role === 'manager' || Boolean(actor?.permissions?.canApprove);
  const now = nowIso();
  const txDate = date || todayIso();
  const txId = generateServerId('FT');
  const txNo = `TRX-${Date.now().toString().slice(-6)}`;
  const endpoint = 'POST /api/admin/suppliers/payment';
  const scopedIdem = buildScopedIdemKey(endpoint, actor, idempotencyKey);

  if (await isPgMode()) {
    const result = await withTransaction(async (client) => {
      const dup = await findPgIdempotency(client, scopedIdem);
      if (dup) return { deduplicated: true, ...dup };

      const sRes = await client.query('SELECT * FROM suppliers WHERE id = $1 FOR UPDATE', [supplierId]);
      if (!sRes.rows[0]) throw new AppError(404, 'المورد غير موجود', 'SUPPLIER_NOT_FOUND');
      const cbRes = await client.query('SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE', [cashboxId]);
      if (!cbRes.rows[0]) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');
      const curSuppBal = round2(sRes.rows[0].current_balance || 0);
      const overpaymentAmount = round2(Math.max(0, payAmount - Math.max(0, curSuppBal)));
      const isAdvance = overpaymentAmount > 0.009;
      if (isAdvance && !canApproveOverpayment) {
        throw new AppError(
          403,
          'دفع مبلغ يتجاوز المستحق للمورد (دفعة مقدمة / رصيد لنا) يتطلب موافقة المدير العام أو صاحب الصلاحية',
          'SUPPLIER_OVERPAYMENT_APPROVAL_REQUIRED'
        );
      }
      const nextSupp = round2(curSuppBal - payAmount);
      const nextCb = round2(Number(cbRes.rows[0].current_balance || 0) - payAmount);
      const desc = `سداد للمورد ${sRes.rows[0].name}${isAdvance ? ' (دفعة مقدمة / رصيد لنا)' : ''}`;
      await client.query('UPDATE suppliers SET current_balance = $1 WHERE id = $2', [nextSupp, supplierId]);
      await client.query('UPDATE cashboxes SET current_balance = $1 WHERE id = $2', [nextCb, cashboxId]);
      const actorCtx = await resolveActorIdentityPgTx(client, actor);
      await client.query(
        `INSERT INTO financial_transactions (id, transaction_number, date, type, amount, cashbox_id, cashbox_name, balance_after, category, related_entity_id, related_entity_name, description, notes, created_by_user_id, created_by, actor_identity_id, actor_employee_id, acting_role, created_at)
         VALUES ($1,$2,$3,'supplier_payment',$4,$5,$6,$7,'سداد لمورد',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [txId, txNo, txDate, payAmount, cbRes.rows[0].id, cbRes.rows[0].name, nextCb, supplierId, sRes.rows[0].name, desc, notes, actor.id, actor.fullName, actorCtx.actorIdentityId || null, actorCtx.actorEmployeeId || null, actorCtx.actingRole || actor.role || null, now]
      );
      const payloadOut = {
        ok: true,
        transactionId: txId,
        transactionNumber: txNo,
        supplierBalance: nextSupp,
        cashboxBalance: nextCb,
        supplierName: sRes.rows[0].name,
        isAdvancePayment: nextSupp < 0,
        overpaymentAmount,
        advanceCreditBalance: nextSupp < 0 ? round2(Math.abs(nextSupp)) : 0,
      };
      await savePgIdempotency(client, scopedIdem, actor, endpoint, payloadOut);
      return { deduplicated: false, ...payloadOut };
    });
    if (!result.deduplicated) {
      await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `سداد مبلغ (${payAmount}) للمورد ${result.supplierName}`, module: 'الموردون', recordId: supplierId });
    }
    return result;
  }

  const result = await withJsonTransaction((db) => {
    const dup = findJsonIdempotency(scopedIdem);
    if (dup) return { deduplicated: true, ...dup };

    const supp = db.suppliers.find((s) => s.id === supplierId);
    const cb = db.cashboxes.find((c) => c.id === cashboxId);
    if (!supp || !cb) throw new AppError(404, 'المورد أو الخزينة غير موجودة', 'NOT_FOUND');
    const curSuppBal = round2(supp.currentBalance || 0);
    const overpaymentAmount = round2(Math.max(0, payAmount - Math.max(0, curSuppBal)));
    const isAdvance = overpaymentAmount > 0.009;
    if (isAdvance && !canApproveOverpayment) {
      throw new AppError(
        403,
        'دفع مبلغ يتجاوز المستحق للمورد (دفعة مقدمة / رصيد لنا) يتطلب موافقة المدير العام أو صاحب الصلاحية',
        'SUPPLIER_OVERPAYMENT_APPROVAL_REQUIRED'
      );
    }
    supp.currentBalance = round2(curSuppBal - payAmount);
    cb.currentBalance = round2(Number(cb.currentBalance || 0) - payAmount);
    const desc = `سداد للمورد ${supp.name}${isAdvance ? ' (دفعة مقدمة / رصيد لنا)' : ''}`;
    const actorCtxJson = resolveActorIdentityJsonTx(db, actor);
    db.financialTransactions.unshift({
      id: txId,
      transactionNumber: txNo,
      date: txDate,
      type: 'supplier_payment',
      cashboxId: cb.id,
      cashboxName: cb.name,
      balanceAfter: cb.currentBalance,
      amount: payAmount,
      category: 'سداد لمورد',
      relatedEntityId: supp.id,
      partyId: supp.id,
      partyName: supp.name,
      description: desc,
      notes,
      createdByUserId: actor.id,
      createdBy: actor.fullName,
      actorIdentityId: actorCtxJson.actorIdentityId,
      actorEmployeeId: actorCtxJson.actorEmployeeId,
      actingRole: actorCtxJson.actingRole,
      createdAt: now,
    });
    const payloadOut = {
      ok: true,
      transactionId: txId,
      transactionNumber: txNo,
      supplierBalance: supp.currentBalance,
      cashboxBalance: cb.currentBalance,
      supplierName: supp.name,
      isAdvancePayment: supp.currentBalance < 0,
      overpaymentAmount,
      advanceCreditBalance: supp.currentBalance < 0 ? round2(Math.abs(supp.currentBalance)) : 0,
    };
    saveJsonIdempotency(scopedIdem, payloadOut);
    return { deduplicated: false, ...payloadOut };
  });
  if (!result.deduplicated) {
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `سداد مبلغ (${payAmount}) للمورد ${result.supplierName}`, module: 'الموردون', recordId: supplierId });
  }
  return result;
}

export async function settleSupplierAdvance({ supplierId, invoiceId, amount, notes = '', date }, actor, idempotencyKey = '') {
  if (actor?.role === 'representative' || actor?.role === 'customer') {
    throw new AppError(403, 'العمليات الإدارية للخزائن والموردين غير متاحة للمندوبين', 'FORBIDDEN_REP_CASHBOX_OP');
  }
  const settleAmount = round2(amount);
  if (!Number.isFinite(settleAmount) || settleAmount <= 0) {
    throw new AppError(400, 'مبلغ التسوية يجب أن يكون أكبر من الصفر', 'INVALID_AMOUNT');
  }
  if (!supplierId || !invoiceId) {
    throw new AppError(400, 'المورد وفاتورة المشتريات مطلوبان لتنفيذ التسوية', 'MISSING_FIELDS');
  }

  const now = nowIso();
  const settleDate = date || todayIso();
  const payId = generateServerId('PAY');
  const endpoint = `POST /api/admin/suppliers/${supplierId}/settle-advance`;
  const scopedIdem = buildScopedIdemKey(endpoint, actor, idempotencyKey);

  if (await isPgMode()) {
    const out = await withTransaction(async (client) => {
      const dup = await findPgIdempotency(client, scopedIdem);
      if (dup) return { deduplicated: true, ...dup };

      const sRes = await client.query('SELECT * FROM suppliers WHERE id = $1 FOR UPDATE', [supplierId]);
      const supp = sRes.rows[0];
      if (!supp) throw new AppError(404, 'المورد غير موجود', 'SUPPLIER_NOT_FOUND');

      const invRes = await client.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [invoiceId]);
      const inv = invRes.rows[0];
      if (!inv) throw new AppError(404, 'فاتورة المشتريات غير موجودة', 'INVOICE_NOT_FOUND');
      if (inv.type !== 'purchase' || inv.supplier_id !== supplierId) {
        throw new AppError(400, 'الفاتورة المختارة لا تتبع هذا المورد كفاتورة مشتريات', 'INVOICE_SUPPLIER_MISMATCH');
      }
      if (inv.status !== 'confirmed') {
        throw new AppError(409, 'لا يمكن تسوية الدفعة المقدمة إلا على فاتورة مشتريات معتمدة', 'INVOICE_NOT_CONFIRMED');
      }

      const invRemaining = round2(inv.remaining_amount);
      if (settleAmount > invRemaining + 0.01) {
        throw new AppError(400, `مبلغ التسوية (${settleAmount}) يتجاوز المتبقي على الفاتورة (${invRemaining})`, 'EXCEEDS_REMAINING');
      }

      const openRes = await client.query(
        `SELECT COALESCE(SUM(remaining_amount), 0) AS open_rem FROM invoices WHERE supplier_id = $1 AND type = 'purchase' AND status = 'confirmed' AND remaining_amount > 0`,
        [supplierId]
      );
      const openInvoicesRemaining = round2(openRes.rows[0]?.open_rem || 0);
      const availableAdvance = round2(Math.max(0, openInvoicesRemaining - Number(supp.current_balance || 0)));

      if (availableAdvance <= 0.009) {
        throw new AppError(409, 'لا يوجد رصيد دفعة مقدمة متاح لدى هذا المورد للتسوية', 'NO_ADVANCE_AVAILABLE');
      }
      if (settleAmount > availableAdvance + 0.01) {
        throw new AppError(400, `مبلغ التسوية (${settleAmount}) يتجاوز الرصيد المقدم المتاح (${availableAdvance})`, 'EXCEEDS_AVAILABLE_ADVANCE');
      }

      let validCashboxId = inv.cashbox_id;
      if (!validCashboxId) {
        const defCb = await client.query('SELECT id FROM cashboxes ORDER BY is_default DESC LIMIT 1');
        validCashboxId = defCb.rows[0]?.id;
      }
      if (!validCashboxId) throw new AppError(400, 'لا توجد خزينة مرجعية متاحة', 'CASHBOX_REQUIRED');

      const newPaid = round2(Number(inv.paid_amount || 0) + settleAmount);
      const newRem = round2(Math.max(0, Number(inv.grand_total || 0) - newPaid));
      const newPayType = newRem <= 0 ? 'cash' : 'partial';

      await client.query(
        `UPDATE invoices SET paid_amount = $1, remaining_amount = $2, payment_type = $3, updated_at = $4 WHERE id = $5`,
        [newPaid, newRem, newPayType, now, invoiceId]
      );
      const actorCtx = await resolveActorIdentityPgTx(client, actor);
      await client.query(
        `INSERT INTO invoice_payments (id, invoice_id, invoice_number, amount, date, payment_method, cashbox_id, cashbox_name, notes, collection_location, created_by_user_id, created_by, actor_identity_id, actor_employee_id, acting_role, created_at)
         VALUES ($1,$2,$3,$4,$5,'advance_settlement',$6,$7,$8,'branch',$9,$10,$11,$12,$13,$14)`,
        [
          payId,
          invoiceId,
          inv.invoice_number,
          settleAmount,
          settleDate,
          validCashboxId,
          'تسوية داخلية من دفعة مقدمة (بدون حركة خزينة)',
          notes || 'تسوية رصيد دفعة مقدمة على فاتورة المشتريات',
          actor.id,
          actor.fullName,
          actorCtx.actorIdentityId || null,
          actorCtx.actorEmployeeId || null,
          actorCtx.actingRole || actor.role || null,
          now,
        ]
      );

      const itemsRes = await client.query('SELECT * FROM invoice_items WHERE invoice_id = $1', [invoiceId]);
      const paysRes = await client.query('SELECT * FROM invoice_payments WHERE invoice_id = $1 ORDER BY created_at ASC', [invoiceId]);
      const nextInvRes = await client.query('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
      const updatedInvoice = mapPgInvoiceRow(nextInvRes.rows[0], itemsRes.rows, paysRes.rows);

      const payloadOut = {
        invoice: updatedInvoice,
        supplierBalance: round2(supp.current_balance || 0),
        availableAdvanceAfter: round2(Math.max(0, availableAdvance - settleAmount)),
        settledAmount: settleAmount,
      };
      await savePgIdempotency(client, scopedIdem, actor, endpoint, payloadOut);
      return { deduplicated: false, ...payloadOut };
    });

    if (!out.deduplicated) {
      await recordAuditLog({
        userId: actor.id,
        userName: actor.fullName,
        action: `تسوية دفعة مقدمة بمبلغ (${settleAmount}) على فاتورة مشتريات ${out.invoice.invoiceNumber}`,
        module: 'الموردون',
        recordId: invoiceId,
      });
    }
    return out;
  }

  const out = await withJsonTransaction((db) => {
    const dup = findJsonIdempotency(scopedIdem);
    if (dup) return { deduplicated: true, ...dup };

    const supp = (db.suppliers || []).find((s) => s.id === supplierId);
    if (!supp) throw new AppError(404, 'المورد غير موجود', 'SUPPLIER_NOT_FOUND');

    const inv = (db.invoices || []).find((i) => i.id === invoiceId);
    if (!inv) throw new AppError(404, 'فاتورة المشتريات غير موجودة', 'INVOICE_NOT_FOUND');
    if (inv.type !== 'purchase' || inv.supplierId !== supplierId) {
      throw new AppError(400, 'الفاتورة المختارة لا تتبع هذا المورد كفاتورة مشتريات', 'INVOICE_SUPPLIER_MISMATCH');
    }
    if (inv.status !== 'confirmed') {
      throw new AppError(409, 'لا يمكن تسوية الدفعة المقدمة إلا على فاتورة مشتريات معتمدة', 'INVOICE_NOT_CONFIRMED');
    }

    const invRemaining = round2(inv.remainingAmount || 0);
    if (settleAmount > invRemaining + 0.01) {
      throw new AppError(400, `مبلغ التسوية (${settleAmount}) يتجاوز المتبقي على الفاتورة (${invRemaining})`, 'EXCEEDS_REMAINING');
    }

    const openInvoicesRemaining = round2(
      (db.invoices || [])
        .filter((i) => i.supplierId === supplierId && i.type === 'purchase' && i.status === 'confirmed' && Number(i.remainingAmount || 0) > 0)
        .reduce((s, i) => s + Number(i.remainingAmount || 0), 0)
    );
    const availableAdvance = round2(Math.max(0, openInvoicesRemaining - Number(supp.currentBalance || 0)));

    if (availableAdvance <= 0.009) {
      throw new AppError(409, 'لا يوجد رصيد دفعة مقدمة متاح لدى هذا المورد للتسوية', 'NO_ADVANCE_AVAILABLE');
    }
    if (settleAmount > availableAdvance + 0.01) {
      throw new AppError(400, `مبلغ التسوية (${settleAmount}) يتجاوز الرصيد المقدم المتاح (${availableAdvance})`, 'EXCEEDS_AVAILABLE_ADVANCE');
    }

    const validCashboxId = inv.cashboxId || (db.cashboxes || []).find((c) => c.isDefault)?.id || db.cashboxes?.[0]?.id || 'cb-main';
    const actorCtxJson = resolveActorIdentityJsonTx(db, actor);
    const paymentRow = {
      id: payId,
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      amount: settleAmount,
      date: settleDate,
      paymentMethod: 'advance_settlement',
      cashboxId: validCashboxId,
      cashboxName: 'تسوية داخلية من دفعة مقدمة (بدون حركة خزينة)',
      notes: notes || 'تسوية رصيد دفعة مقدمة على فاتورة المشتريات',
      createdByUserId: actor.id,
      createdBy: actor.fullName,
      actorIdentityId: actorCtxJson.actorIdentityId,
      actorEmployeeId: actorCtxJson.actorEmployeeId,
      actingRole: actorCtxJson.actingRole,
      createdAt: now,
    };

    inv.paidAmount = round2(Number(inv.paidAmount || 0) + settleAmount);
    inv.remainingAmount = round2(Math.max(0, Number(inv.grandTotal || 0) - inv.paidAmount));
    inv.paymentType = inv.remainingAmount <= 0 ? 'cash' : 'partial';
    inv.payments = [...(inv.payments || []), paymentRow];

    const payloadOut = {
      invoice: inv,
      supplierBalance: round2(supp.currentBalance || 0),
      availableAdvanceAfter: round2(Math.max(0, availableAdvance - settleAmount)),
      settledAmount: settleAmount,
    };
    saveJsonIdempotency(scopedIdem, payloadOut);
    return { deduplicated: false, ...payloadOut };
  });

  if (!out.deduplicated) {
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `تسوية دفعة مقدمة بمبلغ (${settleAmount}) على فاتورة مشتريات ${out.invoice.invoiceNumber}`,
      module: 'الموردون',
      recordId: invoiceId,
    });
  }
  return out;
}

export async function getSupplierStatementData(supplierId, actor = null) {
  if (actor?.role === 'customer') {
    throw new AppError(403, 'غير مصرح للعملاء بعرض كشف حساب المورد', 'FORBIDDEN_PERMISSION');
  }
  const isRep = actor?.role === 'representative';
  if (isRep && !actor.permissions?.canCreatePurchase && !actor.permissions?.canManagePurchases) {
    throw new AppError(403, 'عرض كشف حساب المورد متاح فقط للمندوبين المصرح لهم بإنشاء أو إدارة المشتريات', 'FORBIDDEN_REP_SUPPLIER_STATEMENT');
  }
  const repProfile = isRep ? await getRepresentativeByUserId(actor.id) : null;
  const isRepOwnInvoice = (inv) => isRepOwnerOfInvoice(inv, actor, repProfile);

  let supplier = null;
  let invoices = [];
  let returns = [];
  let paymentTxs = [];

  if (await isPgMode()) {
    const pool = getPool();
    const sRes = await pool.query('SELECT * FROM suppliers WHERE id = $1', [supplierId]);
    if (!sRes.rows[0]) throw new AppError(404, 'المورد غير موجود', 'SUPPLIER_NOT_FOUND');
    const sRow = sRes.rows[0];
    supplier = {
      id: sRow.id,
      code: sRow.code,
      name: sRow.name,
      phone: sRow.phone || '',
      address: sRow.address || '',
      openingBalance: round2(sRow.opening_balance || 0),
      currentBalance: round2(sRow.current_balance || 0),
      notes: isRep ? '' : (sRow.notes || ''),
      status: sRow.status || 'active',
      createdAt: isoTimestamp(sRow.created_at),
    };

    const invRes = await pool.query(
      `SELECT * FROM invoices WHERE supplier_id = $1 AND type = 'purchase' AND status = 'confirmed' ORDER BY date DESC, created_at DESC`,
      [supplierId]
    );
    const invIds = invRes.rows.map((r) => r.id);
    const itemsMap = new Map();
    const payMap = new Map();
    if (invIds.length > 0) {
      const itParams = [];
      const itPred = buildPgInPredicate('invoice_id', invIds, itParams);
      const itRes = await pool.query(`SELECT * FROM invoice_items WHERE ${itPred}`, itParams);
      for (const it of itRes.rows) {
        const arr = itemsMap.get(it.invoice_id) || [];
        arr.push(it);
        itemsMap.set(it.invoice_id, arr);
      }
      const pyParams = [];
      const pyPred = buildPgInPredicate('invoice_id', invIds, pyParams);
      const pyRes = await pool.query(`SELECT * FROM invoice_payments WHERE ${pyPred} ORDER BY created_at ASC`, pyParams);
      for (const py of pyRes.rows) {
        const arr = payMap.get(py.invoice_id) || [];
        arr.push(py);
        payMap.set(py.invoice_id, arr);
      }
    }
    const sanitizePurchaseForRep = (inv) => {
      const base = sanitizeInvoiceForRepresentative(inv);
      if (!isRep) return base;
      return {
        ...base,
        cashboxId: '',
        cashboxName: '-',
        payments: Array.isArray(base.payments)
          ? base.payments.map((p) => ({
              ...p,
              cashboxId: '',
              cashboxName: '-',
            }))
          : [],
      };
    };

    const mappedInvs = invRes.rows.map((r) => mapPgInvoiceRow(r, itemsMap.get(r.id) || [], payMap.get(r.id) || []));
    invoices = isRep ? mappedInvs.filter(isRepOwnInvoice).map(sanitizePurchaseForRep) : mappedInvs;
    const allowedInvIds = new Set(invoices.map((i) => i.id));

    const retRes = await pool.query(
      `SELECT * FROM invoice_returns WHERE party_id = $1 AND type = 'purchase_return' ORDER BY date DESC, created_at DESC`,
      [supplierId]
    );
    returns = retRes.rows
      .filter((r) => !isRep || allowedInvIds.has(r.original_invoice_id))
      .map((r) => ({
        id: r.id,
        returnNumber: r.return_number,
        type: r.type,
        originalInvoiceId: r.original_invoice_id,
        originalInvoiceNumber: r.original_invoice_number,
        date: isoDateOnly(r.date),
        partyId: r.party_id,
        partyName: r.party_name,
        grandTotal: round2(r.grand_total || 0),
        refundType: r.refund_type,
        ...(isRep ? {} : { cashboxId: r.cashbox_id || undefined }),
        reason: r.reason || '',
        createdBy: r.created_by || '',
        createdByUserId: r.created_by_user_id || undefined,
        createdAt: isoTimestamp(r.created_at),
      }));

    if (!isRep) {
      const txRes = await pool.query(
        `SELECT * FROM financial_transactions WHERE related_entity_id = $1 AND type = 'supplier_payment' ORDER BY date ASC, created_at ASC`,
        [supplierId]
      );
      paymentTxs = txRes.rows.map((r) => ({
        id: r.id,
        transactionNumber: r.transaction_number,
        date: isoDateOnly(r.date),
        amount: round2(r.amount || 0),
        relatedDocType: r.related_doc_type,
        relatedDocId: r.related_doc_id,
        cashboxName: r.cashbox_name || '',
        description: r.description || '',
        notes: r.notes || '',
        createdBy: r.created_by || '',
        createdByUserId: r.created_by_user_id || undefined,
        createdAt: isoTimestamp(r.created_at),
      }));
    }
  } else {
    const db = readJsonDatabase();
    const sRow = (db.suppliers || []).find((s) => s.id === supplierId);
    if (!sRow) throw new AppError(404, 'المورد غير موجود', 'SUPPLIER_NOT_FOUND');
    supplier = {
      ...sRow,
      notes: isRep ? '' : (sRow.notes || ''),
      openingBalance: round2(sRow.openingBalance || 0),
      currentBalance: round2(sRow.currentBalance || 0),
    };
    const sanitizePurchaseForRep = (inv) => {
      const base = sanitizeInvoiceForRepresentative(inv);
      if (!isRep) return base;
      return {
        ...base,
        cashboxId: '',
        cashboxName: '-',
        payments: Array.isArray(base.payments)
          ? base.payments.map((p) => ({
              ...p,
              cashboxId: '',
              cashboxName: '-',
            }))
          : [],
      };
    };
    const allSuppInvs = (db.invoices || [])
      .filter((i) => i.supplierId === supplierId && i.type === 'purchase' && i.status === 'confirmed')
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    invoices = isRep ? allSuppInvs.filter(isRepOwnInvoice).map(sanitizePurchaseForRep) : allSuppInvs;
    const allowedInvIds = new Set(invoices.map((i) => i.id));
    returns = (db.invoiceReturns || [])
      .filter((r) => r.partyId === supplierId && r.type === 'purchase_return' && (!isRep || allowedInvIds.has(r.originalInvoiceId)))
      .map((r) => {
        if (!isRep) return r;
        const { cashboxId: _cb, ...rest } = r;
        return rest;
      })
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    if (!isRep) {
      paymentTxs = (db.financialTransactions || [])
        .filter((tx) => (tx.relatedEntityId === supplierId || tx.partyId === supplierId) && tx.type === 'supplier_payment')
        .sort((a, b) => String(a.createdAt || a.date || '').localeCompare(String(b.createdAt || b.date || '')));
    }
  }

  const rawEntries = [];
  const openingBal = round2(supplier.openingBalance || 0);
  if (!isRep && openingBal !== 0) {
    rawEntries.push({
      id: `OPEN-${supplier.id}`,
      docId: supplier.id,
      docType: 'opening_balance',
      date: (supplier.createdAt || '').split('T')[0] || '-',
      sortKey: `0000-${supplier.createdAt || ''}`,
      docNumber: supplier.code || '-',
      type: 'opening_balance',
      label: 'رصيد افتتاحي للمورد',
      description: openingBal > 0 ? 'رصيد افتتاحي مستحق للمورد (علينا)' : 'رصيد افتتاحي مقدم عند المورد (لنا)',
      credit: openingBal > 0 ? openingBal : 0,
      debit: openingBal < 0 ? round2(Math.abs(openingBal)) : 0,
      paidAmount: 0,
      remainingAmount: 0,
    });
  }

  const confirmedInvIds = new Set(invoices.map((i) => i.id));
  for (const inv of invoices) {
    const invCashAtCreate = round2(inv.paidAtInvoice ?? inv.paidAmount ?? 0);
    const nonSettlementPaid = round2(
      Array.isArray(inv.payments) && inv.payments.length > 0
        ? inv.payments
            .filter((p) => p.paymentMethod !== 'advance_settlement')
            .reduce((s, p) => s + Number(p.amount || 0), 0)
        : invCashAtCreate
    );
    const externalPayers = Array.isArray(inv.payments)
      ? [...new Set(
          inv.payments
            .filter((p) => p.createdBy && (!inv.createdByUserId || (p.createdByUserId && p.createdByUserId !== inv.createdByUserId)))
            .map((p) => p.createdBy)
        )]
      : [];
    const baseDesc =
      nonSettlementPaid > 0
        ? `إجمالي المشتريات ${round2(inv.grandTotal)} · مسدد ${nonSettlementPaid}`
        : `فاتورة مشتريات آجلة — رقم ${inv.invoiceNumber}`;
    rawEntries.push({
      id: `PINV-${inv.id}`,
      docId: inv.id,
      docType: 'purchase',
      date: inv.date || '',
      sortKey: `${inv.date || ''}-${inv.createdAt || inv.id}`,
      docNumber: inv.invoiceNumber,
      type: 'purchase_invoice',
      label: `فاتورة مشتريات (${inv.items?.length || 0} صنف)`,
      description: externalPayers.length > 0 ? `${baseDesc} · سداد لاحق: ${externalPayers.join('، ')}` : baseDesc,
      credit: round2(inv.grandTotal || 0),
      debit: nonSettlementPaid,
      paidAmount: round2(inv.paidAmount || 0),
      remainingAmount: round2(inv.remainingAmount || 0),
      createdBy: inv.createdBy || '',
      createdByUserId: inv.createdByUserId || undefined,
    });
  }

  for (const tx of paymentTxs) {
    if (tx.relatedDocType === 'purchase' && tx.relatedDocId && confirmedInvIds.has(tx.relatedDocId)) {
      continue;
    }
    rawEntries.push({
      id: `SPAY-${tx.id}`,
      docId: tx.id,
      docType: 'supplier_payment',
      date: tx.date || '',
      sortKey: `${tx.date || ''}-${tx.createdAt || tx.id}`,
      docNumber: tx.transactionNumber || tx.id,
      type: 'supplier_payment',
      label: 'سند صرف / سداد للمورد',
      description: tx.description || 'دفعة مسددة للمورد',
      credit: 0,
      debit: round2(tx.amount || 0),
      paidAmount: round2(tx.amount || 0),
      remainingAmount: 0,
      createdBy: tx.createdBy || '',
      createdByUserId: tx.createdByUserId || undefined,
    });
  }

  for (const ret of returns) {
    rawEntries.push({
      id: `PRET-${ret.id}`,
      docId: ret.id,
      docType: 'purchase_return',
      date: ret.date || '',
      sortKey: `${ret.date || ''}-${ret.createdAt || ret.id}`,
      docNumber: ret.returnNumber,
      type: 'purchase_return',
      label: 'مرتجع مشتريات',
      description: ret.reason || `مرتجع على فاتورة ${ret.originalInvoiceNumber || '-'}`,
      credit: 0,
      debit: ret.refundType === 'balance' ? round2(ret.grandTotal || 0) : 0,
      paidAmount: ret.refundType === 'cash' ? round2(ret.grandTotal || 0) : 0,
      remainingAmount: 0,
      createdBy: ret.createdBy || '',
      createdByUserId: ret.createdByUserId || undefined,
    });
  }

  rawEntries.sort((a, b) => String(a.sortKey).localeCompare(String(b.sortKey)));

  let running = 0;
  let totalCredit = 0;
  let totalDebit = 0;
  const entries = rawEntries.map(({ sortKey: _s, ...entry }) => {
    totalCredit = round2(totalCredit + entry.credit);
    totalDebit = round2(totalDebit + entry.debit);
    running = round2(running + entry.credit - entry.debit);
    return {
      ...entry,
      runningBalance: running,
    };
  });

  const curBal = round2(supplier.currentBalance || 0);
  const totalPurchases = round2(invoices.reduce((s, i) => s + Number(i.grandTotal || 0), 0));
  const standalonePaid = round2(
    paymentTxs
      .filter((tx) => !(tx.relatedDocType === 'purchase' && tx.relatedDocId && confirmedInvIds.has(tx.relatedDocId)))
      .reduce((s, tx) => s + Number(tx.amount || 0), 0)
  );
  const invoiceCashPaid = round2(
    invoices.reduce((s, i) => {
      const cashPart = Array.isArray(i.payments) && i.payments.length > 0
        ? i.payments.filter((p) => p.paymentMethod !== 'advance_settlement').reduce((ps, p) => ps + Number(p.amount || 0), 0)
        : Number(i.paidAtInvoice ?? i.paidAmount ?? 0);
      return s + cashPart;
    }, 0)
  );
  const totalPaid = round2(invoiceCashPaid + standalonePaid);
  const sortedInvs = [...invoices].sort((a, b) => `${b.date || ''}-${b.createdAt || ''}`.localeCompare(`${a.date || ''}-${a.createdAt || ''}`));
  const lastInv = sortedInvs[0] || null;
  const lastEntry = entries.length > 0 ? entries[entries.length - 1] : null;

  return {
    supplier,
    invoices,
    returns,
    entries,
    scope: {
      isRepScoped: isRep,
      accountBalanceScope: 'company_wide',
      operationsScope: isRep ? 'representative_own_only' : 'company_wide',
    },
    summary: {
      openingBalance: isRep ? 0 : openingBal,
      totalPurchases,
      totalCredit,
      totalDebit,
      totalPaid,
      currentBalance: curBal,
      payableAmount: curBal > 0 ? curBal : 0,
      advanceCreditAmount: curBal < 0 ? round2(Math.abs(curBal)) : 0,
      balanceDirection: curBal > 0.005 ? 'payable' : curBal < -0.005 ? 'advance' : 'settled',
      invoicesCount: invoices.length,
      returnsCount: returns.length,
      lastInvoiceDate: lastInv?.date || null,
      lastInvoiceNumber: lastInv?.invoiceNumber || null,
      lastTransactionDate: lastEntry?.date || null,
    },
  };
}

export async function createCashbox(payload, actor) {
  if (actor?.role === 'representative' || actor?.role === 'customer') {
    throw new AppError(403, 'العمليات الإدارية للخزائن غير متاحة للمندوبين', 'FORBIDDEN_REP_CASHBOX_OP');
  }
  const id = generateServerId(payload.type === 'bank' ? 'BANK' : 'CASH');
  const opening = round2(payload.openingBalance || 0);
  const isDefault = Boolean(payload.isDefault);
  if (await isPgMode()) {
    await withTransaction(async (client) => {
      if (isDefault) await client.query('UPDATE cashboxes SET is_default = FALSE');
      await client.query(
        `INSERT INTO cashboxes (id, name, type, opening_balance, current_balance, is_default) VALUES ($1,$2,$3,$4,$4,$5)`,
        [id, payload.name, payload.type || 'cashbox', opening, isDefault]
      );
    });
  } else {
    await withJsonTransaction((db) => {
      if (isDefault) db.cashboxes.forEach((c) => { c.isDefault = false; });
      db.cashboxes.push({ ...payload, id, openingBalance: opening, currentBalance: opening, isDefault });
    });
  }
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إضافة خزينة/حساب (${payload.name})`, module: 'المالية', recordId: id });
  return { ...payload, id, openingBalance: opening, currentBalance: opening, isDefault };
}

export async function updateCashbox(id, updates, actor) {
  if (actor?.role === 'representative' || actor?.role === 'customer') {
    throw new AppError(403, 'العمليات الإدارية للخزائن غير متاحة للمندوبين', 'FORBIDDEN_REP_CASHBOX_OP');
  }
  if (await isPgMode()) {
    await withTransaction(async (client) => {
      if (updates.isDefault) await client.query('UPDATE cashboxes SET is_default = FALSE WHERE id <> $1', [id]);
      await client.query(
        `UPDATE cashboxes SET name = COALESCE($1, name), type = COALESCE($2, type), is_default = COALESCE($3, is_default) WHERE id = $4`,
        [updates.name ?? null, updates.type ?? null, updates.isDefault ?? null, id]
      );
    });
  } else {
    await withJsonTransaction((db) => {
      if (updates.isDefault) db.cashboxes.forEach((c) => { c.isDefault = false; });
      db.cashboxes = db.cashboxes.map((c) => (c.id === id ? { ...c, ...updates, id, currentBalance: c.currentBalance } : c));
    });
  }
  return { ok: true };
}

export async function transferCashbox({ fromId, toId, amount, notes = '' }, actor) {
  if (actor?.role === 'representative' || actor?.role === 'customer') {
    throw new AppError(403, 'العمليات الإدارية للخزائن غير متاحة للمندوبين', 'FORBIDDEN_REP_CASHBOX_OP');
  }
  const amt = round2(amount);
  if (!Number.isFinite(amt) || amt <= 0 || fromId === toId) {
    throw new AppError(400, 'بيانات التحويل غير صالحة', 'INVALID_TRANSFER');
  }
  const now = nowIso();
  const dateStr = todayIso();
  let summary = null;

  if (await isPgMode()) {
    summary = await withTransaction(async (client) => {
      const fRes = await client.query('SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE', [fromId]);
      const tRes = await client.query('SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE', [toId]);
      if (!fRes.rows[0] || !tRes.rows[0]) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');
      const curF = round2(Number(fRes.rows[0].current_balance || 0));
      if (curF < amt) {
        throw new AppError(
          409,
          `رصيد الخزينة (${fRes.rows[0].name}) الحالي ${curF} لا يكفي لتحويل مبلغ ${amt}`,
          'INSUFFICIENT_CASHBOX'
        );
      }
      const nextF = round2(curF - amt);
      const nextT = round2(Number(tRes.rows[0].current_balance || 0) + amt);
      await client.query('UPDATE cashboxes SET current_balance = $1 WHERE id = $2', [nextF, fromId]);
      await client.query('UPDATE cashboxes SET current_balance = $1 WHERE id = $2', [nextT, toId]);
      const txId = generateServerId('FT');
      const actorCtx = await resolveActorIdentityPgTx(client, actor);
      await client.query(
        `INSERT INTO financial_transactions (id, transaction_number, date, type, amount, cashbox_id, cashbox_name, balance_after, category, description, notes, created_by_user_id, created_by, actor_identity_id, actor_employee_id, acting_role, created_at)
         VALUES ($1,$2,$3,'transfer',$4,$5,$6,$7,'تحويل داخلي',$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          txId,
          `TRN-${Date.now().toString().slice(-6)}`,
          dateStr,
          amt,
          fromId,
          fRes.rows[0].name,
          nextF,
          `تحويل من ${fRes.rows[0].name} إلى ${tRes.rows[0].name}`,
          notes,
          actor.id,
          actor.fullName,
          actorCtx.actorIdentityId || null,
          actorCtx.actorEmployeeId || null,
          actorCtx.actingRole || actor.role || null,
          now,
        ]
      );
      return { txId, fromName: fRes.rows[0].name, toName: tRes.rows[0].name };
    });
  } else {
    summary = await withJsonTransaction((db) => {
      const f = db.cashboxes.find((c) => c.id === fromId);
      const t = db.cashboxes.find((c) => c.id === toId);
      if (!f || !t) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');
      const curF = round2(Number(f.currentBalance || 0));
      if (curF < amt) {
        throw new AppError(
          409,
          `رصيد الخزينة (${f.name}) الحالي ${curF} لا يكفي لتحويل مبلغ ${amt}`,
          'INSUFFICIENT_CASHBOX'
        );
      }
      f.currentBalance = round2(curF - amt);
      t.currentBalance = round2(Number(t.currentBalance || 0) + amt);
      const txId = generateServerId('FT');
      const actorCtxJson = resolveActorIdentityJsonTx(db, actor);
      db.financialTransactions.unshift({
        id: txId,
        transactionNumber: `TRN-${Date.now().toString().slice(-6)}`,
        date: dateStr,
        type: 'transfer',
        cashboxId: f.id,
        cashboxName: f.name,
        balanceAfter: f.currentBalance,
        targetCashboxId: t.id,
        targetCashboxName: t.name,
        amount: amt,
        category: 'تحويل داخلي',
        description: `تحويل من ${f.name} إلى ${t.name}`,
        notes,
        createdByUserId: actor.id,
        createdBy: actor.fullName,
        actorIdentityId: actorCtxJson.actorIdentityId,
        actorEmployeeId: actorCtxJson.actorEmployeeId,
        actingRole: actorCtxJson.actingRole,
        createdAt: now,
      });
      return { txId, fromName: f.name, toName: t.name };
    });
  }

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `تحويل مالي بين الخزائن (${amt}) من ${summary?.fromName || fromId} إلى ${summary?.toName || toId}`,
    module: 'المالية',
    recordId: summary?.txId || fromId,
  });
  return { ok: true };
}

export async function addExpenseOrIncome(payload, actor) {
  if (actor?.role === 'representative' || actor?.role === 'customer') {
    throw new AppError(403, 'العمليات الإدارية للخزائن والمصروفات غير متاحة للمندوبين', 'FORBIDDEN_REP_CASHBOX_OP');
  }
  const amt = round2(payload.amount);
  if (amt <= 0) throw new AppError(400, 'المبلغ يجب أن يكون أكبر من صفر', 'INVALID_AMOUNT');
  const now = nowIso();
  const id = generateServerId('EXP');
  const recordNumber = `${payload.type === 'expense' ? 'EXP' : 'INC'}-${Date.now().toString().slice(-6)}`;
  const dateStr = payload.date || todayIso();

  if (await isPgMode()) {
    await withTransaction(async (client) => {
      const cbRes = await client.query('SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE', [payload.cashboxId]);
      if (!cbRes.rows[0]) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');
      const nextCb = payload.type === 'expense' ? round2(Number(cbRes.rows[0].current_balance || 0) - amt) : round2(Number(cbRes.rows[0].current_balance || 0) + amt);
      await client.query('UPDATE cashboxes SET current_balance = $1 WHERE id = $2', [nextCb, cbRes.rows[0].id]);
      const actorCtx = await resolveActorIdentityPgTx(client, actor);
      await client.query(
        `INSERT INTO expenses_incomes (id, voucher_number, type, category, amount, date, cashbox_id, cashbox_name, payment_method, recipient_or_payer, attachment_name, notes, created_by_user_id, created_by, actor_identity_id, actor_employee_id, acting_role, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [id, recordNumber, payload.type, payload.category, amt, dateStr, cbRes.rows[0].id, cbRes.rows[0].name, payload.paymentMethod || 'cash', payload.recipientOrPayer || '', payload.attachmentName || null, payload.notes || '', actor.id, actor.fullName, actorCtx.actorIdentityId || null, actorCtx.actorEmployeeId || null, actorCtx.actingRole || actor.role || null, now]
      );
      await client.query(
        `INSERT INTO financial_transactions (id, transaction_number, date, type, amount, cashbox_id, cashbox_name, balance_after, category, related_doc_id, related_doc_number, description, notes, created_by_user_id, created_by, actor_identity_id, actor_employee_id, acting_role, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [generateServerId('FT'), `TRX-${Date.now().toString().slice(-6)}`, dateStr, payload.type, amt, cbRes.rows[0].id, cbRes.rows[0].name, nextCb, payload.category, id, recordNumber, `${payload.type === 'expense' ? 'سند صرف' : 'سند قبض'}: ${payload.category}`, payload.notes || '', actor.id, actor.fullName, actorCtx.actorIdentityId || null, actorCtx.actorEmployeeId || null, actorCtx.actingRole || actor.role || null, now]
      );
    });
  } else {
    await withJsonTransaction((db) => {
      const cb = db.cashboxes.find((c) => c.id === payload.cashboxId);
      if (!cb) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');
      cb.currentBalance = payload.type === 'expense' ? round2(cb.currentBalance - amt) : round2(cb.currentBalance + amt);
      const actorCtxJson = resolveActorIdentityJsonTx(db, actor);
      db.expenseIncomes.unshift({
        ...payload,
        id,
        recordNumber,
        date: dateStr,
        cashboxName: cb.name,
        amount: amt,
        createdByUserId: actor.id,
        createdBy: actor.fullName,
        actorIdentityId: actorCtxJson.actorIdentityId,
        actorEmployeeId: actorCtxJson.actorEmployeeId,
        actingRole: actorCtxJson.actingRole,
        createdAt: now,
      });
      db.financialTransactions.unshift({
        id: generateServerId('FT'),
        transactionNumber: `TRX-${Date.now().toString().slice(-6)}`,
        date: dateStr,
        type: payload.type,
        cashboxId: cb.id,
        cashboxName: cb.name,
        balanceAfter: cb.currentBalance,
        amount: amt,
        category: payload.category,
        relatedDocId: id,
        relatedDocNumber: recordNumber,
        description: `${payload.type === 'expense' ? 'سند صرف' : 'سند قبض'}: ${payload.category}`,
        notes: payload.notes || '',
        createdByUserId: actor.id,
        createdBy: actor.fullName,
        actorIdentityId: actorCtxJson.actorIdentityId,
        actorEmployeeId: actorCtxJson.actorEmployeeId,
        actingRole: actorCtxJson.actingRole,
        createdAt: now,
      });
    });
  }
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `${payload.type === 'expense' ? 'سند صرف' : 'سند قبض'} (${amt})`, module: 'المالية', recordId: id });
  return { ...payload, id, recordNumber, date: dateStr, amount: amt, createdByUserId: actor.id, createdBy: actor.fullName, createdAt: now };
}

export async function addCheque(payload, actor) {
  if (actor?.role === 'representative' || actor?.role === 'customer') {
    throw new AppError(403, 'العمليات الإدارية للشيكات والخزائن غير متاحة للمندوبين', 'FORBIDDEN_REP_CASHBOX_OP');
  }
  const id = generateServerId('CHQ');
  const now = nowIso();
  if (await isPgMode()) {
    await getPool().query(
      `INSERT INTO cheques (id, cheque_number, type, bank_name, amount, issue_date, due_date, party_type, party_id, party_name, status, cashbox_id, notes, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [id, payload.chequeNumber, payload.type, payload.bankName, round2(payload.amount), payload.issueDate, payload.dueDate, payload.type === 'incoming' ? 'customer' : 'supplier', payload.partyId || '', payload.partyName, payload.status || 'new', payload.cashboxId || null, payload.notes || '', actor.fullName, now]
    );
  } else {
    await withJsonTransaction((db) => {
      db.cheques.unshift({ ...payload, id, createdAt: now });
    });
  }
  return { ...payload, id, createdAt: now };
}

export async function updateChequeStatus(id, { status, cashboxId }, actor) {
  if (actor?.role === 'representative' || actor?.role === 'customer') {
    throw new AppError(403, 'العمليات الإدارية للشيكات والخزائن غير متاحة للمندوبين', 'FORBIDDEN_REP_CASHBOX_OP');
  }
  const now = nowIso();
  const dateStr = todayIso();
  if (await isPgMode()) {
    await withTransaction(async (client) => {
      const chRes = await client.query('SELECT * FROM cheques WHERE id = $1 FOR UPDATE', [id]);
      const ch = chRes.rows[0];
      if (!ch) throw new AppError(404, 'الشيك غير موجود', 'NOT_FOUND');
      const targetCb = cashboxId || ch.cashbox_id;
      if (status === 'collected' && ch.status !== 'collected' && targetCb) {
        const cbRes = await client.query('SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE', [targetCb]);
        if (cbRes.rows[0]) {
          const amt = Number(ch.amount || 0);
          const nextCb = ch.type === 'incoming' ? round2(Number(cbRes.rows[0].current_balance) + amt) : round2(Number(cbRes.rows[0].current_balance) - amt);
          await client.query('UPDATE cashboxes SET current_balance = $1 WHERE id = $2', [nextCb, targetCb]);
          const actorCtx = await resolveActorIdentityPgTx(client, actor);
          await client.query(
            `INSERT INTO financial_transactions (id, transaction_number, date, type, amount, cashbox_id, cashbox_name, balance_after, category, related_entity_name, description, created_by_user_id, created_by, actor_identity_id, actor_employee_id, acting_role, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'تحصيل/صرف شيك',$9,$10,$11,$12,$13,$14,$15,$16)`,
            [generateServerId('FT'), `CHQ-${Date.now().toString().slice(-6)}`, dateStr, ch.type === 'incoming' ? 'customer_payment' : 'supplier_payment', amt, targetCb, cbRes.rows[0].name, nextCb, ch.party_name, `تحصيل/صرف شيك رقم ${ch.cheque_number}`, actor.id, actor.fullName, actorCtx.actorIdentityId || null, actorCtx.actorEmployeeId || null, actorCtx.actingRole || actor.role || null, now]
          );
        }
      }
      await client.query('UPDATE cheques SET status = $1, cashbox_id = COALESCE($2, cashbox_id) WHERE id = $3', [status, targetCb, id]);
    });
  } else {
    await withJsonTransaction((db) => {
      const ch = db.cheques.find((c) => c.id === id);
      if (!ch) throw new AppError(404, 'الشيك غير موجود', 'NOT_FOUND');
      const targetCb = cashboxId || ch.cashboxId;
      if (status === 'collected' && ch.status !== 'collected' && targetCb) {
        const cb = db.cashboxes.find((c) => c.id === targetCb);
        if (cb) {
          cb.currentBalance = ch.type === 'incoming' ? round2(cb.currentBalance + ch.amount) : round2(cb.currentBalance - ch.amount);
          const actorCtxJson = resolveActorIdentityJsonTx(db, actor);
          db.financialTransactions.unshift({
            id: generateServerId('FT'),
            transactionNumber: `CHQ-${Date.now().toString().slice(-6)}`,
            date: dateStr,
            type: ch.type === 'incoming' ? 'customer_payment' : 'supplier_payment',
            cashboxId: cb.id,
            cashboxName: cb.name,
            balanceAfter: cb.currentBalance,
            amount: ch.amount,
            category: 'تحصيل/صرف شيك',
            partyName: ch.partyName,
            description: `تحصيل/صرف شيك رقم ${ch.chequeNumber}`,
            createdByUserId: actor.id,
            createdBy: actor.fullName,
            actorIdentityId: actorCtxJson.actorIdentityId,
            actorEmployeeId: actorCtxJson.actorEmployeeId,
            actingRole: actorCtxJson.actingRole,
            createdAt: now,
          });
        }
      }
      ch.status = status;
      if (targetCb) ch.cashboxId = targetCb;
    });
  }
  return { ok: true };
}

export async function addInstallmentSchedule(payload, actor) {
  if (actor?.role === 'representative' || actor?.role === 'customer') {
    throw new AppError(403, 'العمليات الإدارية للأقساط والخزائن غير متاحة للمندوبين', 'FORBIDDEN_REP_CASHBOX_OP');
  }
  const id = generateServerId('INST');
  const scheduleNumber = `INS-${Date.now().toString().slice(-6)}`;
  const now = nowIso();
  if (await isPgMode()) {
    await getPool().query(
      `INSERT INTO installments (id, schedule_number, customer_id, customer_name, invoice_id, invoice_number, total_amount, paid_amount, remaining_amount, number_of_installments, installments_data, notes, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [id, scheduleNumber, payload.customerId, payload.customerName, payload.invoiceId || null, payload.invoiceNumber || '', round2(payload.totalAmount), round2(payload.paidAmount || 0), round2(payload.remainingAmount), (payload.items || []).length || 1, JSON.stringify(payload.items || []), payload.notes || '', actor.fullName, now]
    );
  } else {
    await withJsonTransaction((db) => {
      db.installments.unshift({ ...payload, id, scheduleNumber, createdAt: now });
    });
  }
  return { ...payload, id, scheduleNumber, createdAt: now };
}

export async function payInstallment({ scheduleId, installmentItemId, amount, cashboxId, notes = '' }, actor) {
  if (actor?.role === 'representative' || actor?.role === 'customer') {
    throw new AppError(403, 'العمليات الإدارية للأقساط والخزائن غير متاحة للمندوبين', 'FORBIDDEN_REP_CASHBOX_OP');
  }
  const amt = round2(amount);
  if (amt <= 0) throw new AppError(400, 'المبلغ يجب أن يكون أكبر من صفر', 'INVALID_AMOUNT');
  const now = nowIso();
  const dateStr = todayIso();

  if (await isPgMode()) {
    await withTransaction(async (client) => {
      const sRes = await client.query('SELECT * FROM installments WHERE id = $1 FOR UPDATE', [scheduleId]);
      const sched = sRes.rows[0];
      if (!sched) throw new AppError(404, 'جدول الأقساط غير موجود', 'NOT_FOUND');
      const cbRes = await client.query('SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE', [cashboxId]);
      if (!cbRes.rows[0]) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');

      const items = (sched.installments_data || []).map((item) => {
        if (item.id === installmentItemId) {
          const newPaid = round2(Number(item.paidAmount || 0) + amt);
          const isPaid = newPaid >= Number(item.amount || 0);
          return { ...item, paidAmount: newPaid, status: isPaid ? 'paid' : 'pending', paidDate: isPaid ? dateStr : item.paidDate };
        }
        return item;
      });
      const newPaidTotal = round2(Number(sched.paid_amount || 0) + amt);
      const newRem = round2(Math.max(0, Number(sched.total_amount || 0) - newPaidTotal));
      await client.query(`UPDATE installments SET paid_amount = $1, remaining_amount = $2, installments_data = $3 WHERE id = $4`, [
        newPaidTotal,
        newRem,
        JSON.stringify(items),
        scheduleId,
      ]);

      const nextCb = round2(Number(cbRes.rows[0].current_balance || 0) + amt);
      await client.query('UPDATE cashboxes SET current_balance = $1 WHERE id = $2', [nextCb, cashboxId]);
      await client.query('UPDATE customers SET current_balance = current_balance - $1 WHERE id = $2', [amt, sched.customer_id]);
      const actorCtx = await resolveActorIdentityPgTx(client, actor);
      await client.query(
        `INSERT INTO financial_transactions (id, transaction_number, date, type, amount, cashbox_id, cashbox_name, balance_after, category, related_entity_id, related_entity_name, description, notes, created_by_user_id, created_by, actor_identity_id, actor_employee_id, acting_role, created_at)
         VALUES ($1,$2,$3,'customer_payment',$4,$5,$6,$7,'سداد قسط',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [generateServerId('FT'), `TRX-${Date.now().toString().slice(-6)}`, dateStr, amt, cashboxId, cbRes.rows[0].name, nextCb, sched.customer_id, sched.customer_name, `سداد قسط ${sched.schedule_number}`, notes, actor.id, actor.fullName, actorCtx.actorIdentityId || null, actorCtx.actorEmployeeId || null, actorCtx.actingRole || actor.role || null, now]
      );
    });
  } else {
    await withJsonTransaction((db) => {
      const sched = db.installments.find((s) => s.id === scheduleId);
      const cb = db.cashboxes.find((c) => c.id === cashboxId);
      if (!sched || !cb) throw new AppError(404, 'البيانات غير موجودة', 'NOT_FOUND');
      sched.items = sched.items.map((item) => {
        if (item.id === installmentItemId) {
          const newPaid = round2(item.paidAmount + amt);
          const isPaid = newPaid >= item.amount;
          return { ...item, paidAmount: newPaid, status: isPaid ? 'paid' : 'pending', paidDate: isPaid ? dateStr : item.paidDate };
        }
        return item;
      });
      sched.paidAmount = round2(sched.paidAmount + amt);
      sched.remainingAmount = round2(Math.max(0, sched.totalAmount - sched.paidAmount));
      cb.currentBalance = round2(cb.currentBalance + amt);
      const cust = db.customers.find((c) => c.id === sched.customerId);
      if (cust) cust.currentBalance = round2(cust.currentBalance - amt);
      const actorCtxJson = resolveActorIdentityJsonTx(db, actor);
      db.financialTransactions.unshift({
        id: generateServerId('FT'),
        transactionNumber: `TRX-${Date.now().toString().slice(-6)}`,
        date: dateStr,
        type: 'customer_payment',
        cashboxId: cb.id,
        cashboxName: cb.name,
        balanceAfter: cb.currentBalance,
        amount: amt,
        category: 'سداد قسط',
        partyId: sched.customerId,
        partyName: sched.customerName,
        description: `سداد قسط ${sched.scheduleNumber}`,
        notes,
        createdByUserId: actor.id,
        createdBy: actor.fullName,
        actorIdentityId: actorCtxJson.actorIdentityId,
        actorEmployeeId: actorCtxJson.actorEmployeeId,
        actingRole: actorCtxJson.actingRole,
        createdAt: now,
      });
    });
  }
  return { ok: true };
}

export async function addRepresentative(payload, actor) {
  const id = generateServerId('REP');
  const opening = round2(payload.openingBalance || 0);
  const now = nowIso();
  if (await isPgMode()) {
    return withTransaction(async (client) => {
      if (payload.userId) {
        const existingRes = await client.query('SELECT * FROM representatives WHERE user_id = $1 LIMIT 1', [payload.userId]);
        if (existingRes.rows[0]) {
          const cur = existingRes.rows[0];
          const nextOpening = Math.abs(Number(cur.opening_balance || 0)) < 0.001 && Math.abs(Number(cur.current_balance || 0)) < 0.001 ? opening : Number(cur.opening_balance || 0);
          const nextCurrent = Math.abs(Number(cur.opening_balance || 0)) < 0.001 && Math.abs(Number(cur.current_balance || 0)) < 0.001 ? opening : Number(cur.current_balance || 0);
          await client.query(
            `UPDATE representatives SET name = COALESCE(NULLIF($1, ''), name), phone = COALESCE(NULLIF($2, ''), phone), normalized_phone = COALESCE(NULLIF($3, ''), normalized_phone), vehicle_number = COALESCE(NULLIF($4, ''), vehicle_number), opening_balance = $5, current_balance = $6, commission_rate = $7, notes = COALESCE(NULLIF($8, ''), notes), status = COALESCE($9, status) WHERE id = $10`,
            [payload.name || '', payload.phone || '', normalizePhoneDigits(payload.phone || ''), payload.vehicleNumber || '', nextOpening, nextCurrent, Number(payload.commissionRate ?? cur.commission_rate ?? 0), payload.notes || '', payload.status || cur.status || 'active', cur.id]
          );
          const idnId = await attachRecordToIdentityPgTx(client, {
            entityType: 'representative',
            entityId: cur.id,
            roleKey: 'representative',
            fullName: payload.name || cur.name,
            phone: payload.phone || cur.phone || '',
            explicitIdentityId: payload.identityId || cur.identity_id || null,
            linkedUserId: payload.userId || null,
            linkedEmployeeId: payload.employeeId || null,
            now,
          });
          return {
            ...payload,
            id: cur.id,
            identityId: idnId,
            warehouseId: cur.warehouse_id || payload.warehouseId || undefined,
            openingBalance: nextOpening,
            currentBalance: nextCurrent,
          };
        }
      }
      if (payload.phone && !payload.allowPhoneOverlap) {
        await assertNoSameRoleDuplicatesPgTx(client, {
          entityType: 'representative',
          phone: payload.phone,
          allowPhoneOverlap: false,
        });
      }
      await client.query(
        `INSERT INTO representatives (id, user_id, name, phone, normalized_phone, vehicle_number, opening_balance, current_balance, commission_rate, notes, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10)`,
        [id, payload.userId || null, payload.name, payload.phone || '', normalizePhoneDigits(payload.phone || ''), payload.vehicleNumber || '', opening, Number(payload.commissionRate || 0), payload.notes || '', payload.status || 'active']
      );
      const idnId = await attachRecordToIdentityPgTx(client, {
        entityType: 'representative',
        entityId: id,
        roleKey: 'representative',
        fullName: payload.name,
        phone: payload.phone || '',
        explicitIdentityId: payload.identityId || null,
        linkedUserId: payload.userId || null,
        linkedEmployeeId: payload.employeeId || null,
        now,
      });
      return { ...payload, id, identityId: idnId, openingBalance: opening, currentBalance: opening };
    });
  } else {
    let existingRep = null;
    let newRepObj = null;
    await withJsonTransaction((db) => {
      if (payload.userId) {
        const idx = (db.representatives || []).findIndex((r) => r.userId === payload.userId);
        if (idx !== -1) {
          const cur = db.representatives[idx];
          const canUpdateBal = Math.abs(Number(cur.openingBalance || 0)) < 0.001 && Math.abs(Number(cur.currentBalance || 0)) < 0.001;
          db.representatives[idx] = {
            ...cur,
            ...payload,
            id: cur.id,
            warehouseId: cur.warehouseId || payload.warehouseId,
            openingBalance: canUpdateBal ? opening : cur.openingBalance,
            currentBalance: canUpdateBal ? opening : cur.currentBalance,
          };
          db.representatives[idx].identityId = attachRecordToIdentityJsonTx(db, {
            entityType: 'representative',
            entityId: cur.id,
            roleKey: 'representative',
            fullName: db.representatives[idx].name,
            phone: db.representatives[idx].phone || '',
            explicitIdentityId: payload.identityId || cur.identityId || null,
            linkedUserId: payload.userId || null,
            linkedEmployeeId: payload.employeeId || null,
            now,
          });
          existingRep = db.representatives[idx];
          return;
        }
      }
      if (payload.phone && !payload.allowPhoneOverlap) {
        assertNoSameRoleDuplicatesJsonTx(db, {
          entityType: 'representative',
          phone: payload.phone,
          allowPhoneOverlap: false,
        });
      }
      newRepObj = { ...payload, id, openingBalance: opening, currentBalance: opening };
      db.representatives.push(newRepObj);
      newRepObj.identityId = attachRecordToIdentityJsonTx(db, {
        entityType: 'representative',
        entityId: id,
        roleKey: 'representative',
        fullName: payload.name,
        phone: payload.phone || '',
        explicitIdentityId: payload.identityId || null,
        linkedUserId: payload.userId || null,
        linkedEmployeeId: payload.employeeId || null,
        now,
      });
    });
    if (existingRep) return existingRep;
    return newRepObj;
  }
}

export async function updateRepresentative(id, updates, actor = null) {
  const now = nowIso();
  if (await isPgMode()) {
    await withTransaction(async (client) => {
      const existing = await client.query('SELECT * FROM representatives WHERE id = $1 FOR UPDATE', [id]);
      const cur = existing.rows[0];
      if (!cur) throw new AppError(404, 'المندوب غير موجود', 'REP_NOT_FOUND');
      if (updates.phone !== undefined) {
        await assertNoSameRoleDuplicatesPgTx(client, {
          entityType: 'representative',
          excludeEntityId: id,
          phone: updates.phone,
          allowPhoneOverlap: Boolean(updates.allowPhoneOverlap),
        });
      }
      await client.query(
        `UPDATE representatives SET name = COALESCE($1, name), phone = COALESCE($2, phone), normalized_phone = COALESCE($3, normalized_phone), vehicle_number = COALESCE($4, vehicle_number), commission_rate = COALESCE($5, commission_rate), status = COALESCE($6, status), user_id = COALESCE($7, user_id), notes = COALESCE($8, notes), warehouse_id = COALESCE($9, warehouse_id), opening_balance = COALESCE($10, opening_balance), current_balance = COALESCE($11, current_balance) WHERE id = $12`,
        [
          updates.name ?? null,
          updates.phone ?? null,
          updates.phone !== undefined ? normalizePhoneDigits(updates.phone) : null,
          updates.vehicleNumber ?? null,
          updates.commissionRate ?? null,
          updates.status ?? null,
          updates.userId ?? null,
          updates.notes ?? null,
          updates.warehouseId ?? null,
          updates.openingBalance !== undefined ? round2(updates.openingBalance) : null,
          updates.currentBalance !== undefined ? round2(updates.currentBalance) : null,
          id,
        ]
      );
      await attachRecordToIdentityPgTx(client, {
        entityType: 'representative',
        entityId: id,
        roleKey: 'representative',
        fullName: updates.name ?? cur.name,
        phone: updates.phone ?? cur.phone ?? '',
        explicitIdentityId: updates.identityId || cur.identity_id || null,
        linkedUserId: updates.userId ?? cur.user_id ?? null,
        linkedEmployeeId: updates.employeeId || null,
        now,
      });
    });
  } else {
    await withJsonTransaction((db) => {
      if (updates.phone !== undefined) {
        assertNoSameRoleDuplicatesJsonTx(db, {
          entityType: 'representative',
          excludeEntityId: id,
          phone: updates.phone,
          allowPhoneOverlap: Boolean(updates.allowPhoneOverlap),
        });
      }
      let targetRep = null;
      db.representatives = db.representatives.map((r) => {
        if (r.id !== id) return r;
        targetRep = { ...r, ...updates, id };
        return targetRep;
      });
      if (targetRep) {
        targetRep.identityId = attachRecordToIdentityJsonTx(db, {
          entityType: 'representative',
          entityId: id,
          roleKey: 'representative',
          fullName: targetRep.name,
          phone: targetRep.phone || '',
          explicitIdentityId: updates.identityId || targetRep.identityId || null,
          linkedUserId: targetRep.userId || null,
          linkedEmployeeId: updates.employeeId || null,
          now,
        });
      }
    });
  }
  if (actor) {
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `تحديث بيانات المندوب (${updates.name || id})`,
      module: 'المندوبون',
      recordId: id,
    });
  }
  return { ok: true };
}

// HR: Employees Registry & Unified Identity Link
export async function addEmployee(payload, actor = null) {
  const { basicSalary: _ignoredBasicSalary, ...cleanPayload } = payload || {};
  const name = String(cleanPayload.name || '').trim();
  if (!name) throw new AppError(400, 'اسم الموظف مطلوب', 'INVALID_EMPLOYEE_NAME');
  const jobTitle = String(cleanPayload.jobTitle || '').trim();
  if (!jobTitle) throw new AppError(400, 'المسمى الوظيفي مطلوب', 'INVALID_JOB_TITLE');

  const id = generateServerId('EMP');
  const code = String(cleanPayload.code || `E-${Date.now().toString().slice(-4)}`).trim();
  const hireDate = cleanPayload.hireDate || todayIso();
  const status = cleanPayload.status || 'active';
  const phone = String(cleanPayload.phone || '').trim();
  const nationalId = String(cleanPayload.nationalId || '').trim();
  const linkedUserId = String(cleanPayload.userId || '').trim() || null;
  const now = nowIso();
  let resolvedIdentityId;

  if (await isPgMode()) {
    resolvedIdentityId = await withTransaction(async (client) => {
      const dup = await client.query('SELECT id FROM employees WHERE LOWER(code) = LOWER($1) LIMIT 1', [code]);
      if (dup.rows[0]) throw new AppError(409, 'كود الموظف مستخدم مسبقًا', 'DUPLICATE_EMPLOYEE_CODE');
      if (linkedUserId) {
        const uRes = await client.query(
          'SELECT id, role, employee_id FROM users WHERE id = $1 FOR UPDATE',
          [linkedUserId]
        );
        const linkedUsr = uRes.rows[0];
        if (!linkedUsr) {
          throw new AppError(404, 'حساب المستخدم المحدد غير موجود', 'USER_NOT_FOUND');
        }
        if (linkedUsr.role === 'customer') {
          throw new AppError(400, 'لا يمكن ربط حساب عميل بملف موظف', 'INVALID_ROLE_EMPLOYEE_LINK');
        }
        if (linkedUsr.employee_id && linkedUsr.employee_id !== id) {
          throw new AppError(409, 'حساب المستخدم المختار مربوط مسبقًا بملف موظف آخر', 'USER_ALREADY_LINKED_TO_EMPLOYEE');
        }
        const dupEmpUserRes = await client.query(
          'SELECT id FROM employees WHERE user_id = $1 AND id <> $2 LIMIT 1',
          [linkedUserId, id]
        );
        if (dupEmpUserRes.rows[0]) {
          throw new AppError(409, 'حساب المستخدم المختار مربوط مسبقًا بملف موظف آخر', 'USER_ALREADY_LINKED_TO_EMPLOYEE');
        }
      }
      await assertNoSameRoleDuplicatesPgTx(client, {
        entityType: 'employee',
        phone,
        nationalId,
        allowPhoneOverlap: Boolean(payload.allowPhoneOverlap),
      });
      await client.query(
        `INSERT INTO employees (id, code, full_name, job_title, department, phone, normalized_phone, national_id, user_id, hire_date, status, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [id, code, name, jobTitle, cleanPayload.department || '', phone, normalizePhoneDigits(phone), nationalId, linkedUserId, hireDate, status, cleanPayload.notes || '']
      );
      let empIdentityId;
      if (linkedUserId) {
        await client.query('UPDATE users SET employee_id = $1, updated_at = $2 WHERE id = $3', [id, now, linkedUserId]);
        empIdentityId = await alignEmployeeUserIdentityPgTx(client, {
          userId: linkedUserId,
          employeeId: id,
          preferredIdentityId: payload.identityId || null,
          now,
        });
      } else {
        empIdentityId = await attachRecordToIdentityPgTx(client, {
          entityType: 'employee',
          entityId: id,
          roleKey: 'employee',
          fullName: name,
          phone,
          nationalId,
          notes: payload.notes || '',
          explicitIdentityId: payload.identityId || null,
          isPrimary: true,
          now,
        });
      }
      return empIdentityId;
    });
  } else {
    resolvedIdentityId = await withJsonTransaction((db) => {
      if ((db.employees || []).some((e) => String(e.code || '').toLowerCase() === code.toLowerCase())) {
        throw new AppError(409, 'كود الموظف مستخدم مسبقًا', 'DUPLICATE_EMPLOYEE_CODE');
      }
      let linkedUsr = null;
      if (linkedUserId) {
        linkedUsr = (db.users || []).find((u) => u.id === linkedUserId);
        if (!linkedUsr) {
          throw new AppError(404, 'حساب المستخدم المحدد غير موجود', 'USER_NOT_FOUND');
        }
        if (linkedUsr.role === 'customer') {
          throw new AppError(400, 'لا يمكن ربط حساب عميل بملف موظف', 'INVALID_ROLE_EMPLOYEE_LINK');
        }
        if (linkedUsr.employeeId && linkedUsr.employeeId !== id) {
          throw new AppError(409, 'حساب المستخدم المختار مربوط مسبقًا بملف موظف آخر', 'USER_ALREADY_LINKED_TO_EMPLOYEE');
        }
        if ((db.employees || []).some((e) => e.id !== id && e.userId === linkedUserId)) {
          throw new AppError(409, 'حساب المستخدم المختار مربوط مسبقًا بملف موظف آخر', 'USER_ALREADY_LINKED_TO_EMPLOYEE');
        }
      }
      assertNoSameRoleDuplicatesJsonTx(db, {
        entityType: 'employee',
        phone,
        nationalId,
        allowPhoneOverlap: Boolean(payload.allowPhoneOverlap),
      });
      const newEmp = {
        ...cleanPayload,
        id,
        code,
        name,
        jobTitle,
        department: cleanPayload.department || '',
        phone,
        nationalId,
        userId: linkedUserId || undefined,
        hireDate,
        status,
        notes: cleanPayload.notes || '',
      };
      db.employees.unshift(newEmp);
      let empIdentityId;
      if (linkedUserId && linkedUsr) {
        linkedUsr.employeeId = id;
        empIdentityId = alignEmployeeUserIdentityJsonTx(db, {
          userId: linkedUserId,
          employeeId: id,
          preferredIdentityId: cleanPayload.identityId || null,
          now,
        });
      } else {
        empIdentityId = attachRecordToIdentityJsonTx(db, {
          entityType: 'employee',
          entityId: id,
          roleKey: 'employee',
          fullName: name,
          phone,
          nationalId,
          notes: cleanPayload.notes || '',
          explicitIdentityId: cleanPayload.identityId || null,
          isPrimary: true,
          now,
        });
        newEmp.identityId = empIdentityId;
      }
      return empIdentityId;
    });
  }

  if (actor) {
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `إضافة موظف جديد (${name})`,
      module: 'الموظفون',
      recordId: id,
    });
  }
  return {
    ...cleanPayload,
    id,
    code,
    name,
    jobTitle,
    hireDate,
    status,
    identityId: resolvedIdentityId,
    ...(linkedUserId ? { userId: linkedUserId } : {}),
  };
}

export async function updateEmployee(id, updates, actor = null) {
  const { basicSalary: _ignoredBasicSalary, ...cleanUpdates } = updates || {};
  const now = nowIso();
  let empName = cleanUpdates.name || '';
  if (await isPgMode()) {
    await withTransaction(async (client) => {
      const existing = await client.query('SELECT * FROM employees WHERE id = $1 FOR UPDATE', [id]);
      if (!existing.rows[0]) throw new AppError(404, 'الموظف غير موجود', 'EMPLOYEE_NOT_FOUND');
      const cur = existing.rows[0];
      empName = String(updates.name ?? cur.full_name).trim();
      if (!empName) throw new AppError(400, 'اسم الموظف مطلوب', 'INVALID_EMPLOYEE_NAME');
      const nextCode = String(updates.code ?? cur.code).trim();
      if (nextCode.toLowerCase() !== String(cur.code || '').toLowerCase()) {
        const dup = await client.query('SELECT id FROM employees WHERE LOWER(code) = LOWER($1) AND id <> $2 LIMIT 1', [nextCode, id]);
        if (dup.rows[0]) throw new AppError(409, 'كود الموظف مستخدم مسبقًا', 'DUPLICATE_EMPLOYEE_CODE');
      }
      const nextPhone = updates.phone ?? cur.phone ?? '';
      const nextNationalId = updates.nationalId ?? cur.national_id ?? '';
      await assertNoSameRoleDuplicatesPgTx(client, {
        entityType: 'employee',
        excludeEntityId: id,
        phone: nextPhone,
        nationalId: nextNationalId,
        allowPhoneOverlap: Boolean(updates.allowPhoneOverlap),
      });
      const hasUserUpdate = updates.userId !== undefined;
      const nextUserId = hasUserUpdate ? (String(updates.userId || '').trim() || null) : (cur.user_id || null);
      const userLinkChanged = (cur.user_id || null) !== (nextUserId || null);
      if (nextUserId) {
        const uRes = await client.query(
          'SELECT id, role, employee_id FROM users WHERE id = $1 FOR UPDATE',
          [nextUserId]
        );
        const targetUsr = uRes.rows[0];
        if (!targetUsr) throw new AppError(404, 'حساب المستخدم المحدد غير موجود', 'USER_NOT_FOUND');
        if (targetUsr.role === 'customer') {
          throw new AppError(400, 'لا يمكن ربط حساب عميل بملف موظف', 'INVALID_ROLE_EMPLOYEE_LINK');
        }
        if (targetUsr.employee_id && targetUsr.employee_id !== id) {
          throw new AppError(409, 'حساب المستخدم المختار مربوط مسبقًا بملف موظف آخر', 'USER_ALREADY_LINKED_TO_EMPLOYEE');
        }
        const dupEmpUsr = await client.query(
          'SELECT id FROM employees WHERE user_id = $1 AND id <> $2 LIMIT 1',
          [nextUserId, id]
        );
        if (dupEmpUsr.rows[0]) {
          throw new AppError(409, 'حساب المستخدم المختار مربوط مسبقًا بملف موظف آخر', 'USER_ALREADY_LINKED_TO_EMPLOYEE');
        }
      }
      if (userLinkChanged) {
        if (cur.user_id && cur.user_id !== nextUserId) {
          await client.query('UPDATE users SET employee_id = NULL, updated_at = $1 WHERE id = $2 AND employee_id = $3', [
            now,
            cur.user_id,
            id,
          ]);
          await splitDetachedEmployeeUserIdentityPgTx(client, {
            detachType: 'user',
            detachId: cur.user_id,
            sharedIdentityId: cur.identity_id,
            now,
          });
        }
        await client.query(
          'UPDATE users SET employee_id = NULL, updated_at = $1 WHERE employee_id = $2 AND ($3::varchar IS NULL OR id <> $3)',
          [now, id, nextUserId]
        );
      }
      await client.query(
        `UPDATE employees SET
          code = $1, full_name = $2, job_title = $3, department = $4, phone = $5, normalized_phone = $6,
          national_id = $7, user_id = $8, hire_date = $9, status = $10, notes = $11
         WHERE id = $12`,
        [
          nextCode,
          empName,
          cleanUpdates.jobTitle ?? cur.job_title,
          cleanUpdates.department ?? cur.department ?? '',
          nextPhone,
          normalizePhoneDigits(nextPhone),
          nextNationalId,
          nextUserId,
          cleanUpdates.hireDate ?? isoDateOnly(cur.hire_date),
          cleanUpdates.status ?? cur.status,
          cleanUpdates.notes ?? cur.notes ?? '',
          id,
        ]
      );
      if (nextUserId) {
        await client.query('UPDATE users SET employee_id = $1, updated_at = $2 WHERE id = $3', [id, now, nextUserId]);
        await alignEmployeeUserIdentityPgTx(client, {
          userId: nextUserId,
          employeeId: id,
          preferredIdentityId: updates.identityId || null,
          now,
        });
      } else {
        await attachRecordToIdentityPgTx(client, {
          entityType: 'employee',
          entityId: id,
          roleKey: 'employee',
          fullName: empName,
          phone: nextPhone,
          nationalId: nextNationalId,
          notes: updates.notes ?? cur.notes ?? '',
          explicitIdentityId: updates.identityId || cur.identity_id || null,
          now,
        });
      }
    });
  } else {
    await withJsonTransaction((db) => {
      const idx = (db.employees || []).findIndex((e) => e.id === id);
      if (idx === -1) throw new AppError(404, 'الموظف غير موجود', 'EMPLOYEE_NOT_FOUND');
      const cur = db.employees[idx];
      empName = String(updates.name ?? cur.name).trim();
      if (!empName) throw new AppError(400, 'اسم الموظف مطلوب', 'INVALID_EMPLOYEE_NAME');
      const nextPhone = updates.phone ?? cur.phone ?? '';
      const nextNationalId = updates.nationalId ?? cur.nationalId ?? '';
      assertNoSameRoleDuplicatesJsonTx(db, {
        entityType: 'employee',
        excludeEntityId: id,
        phone: nextPhone,
        nationalId: nextNationalId,
        allowPhoneOverlap: Boolean(updates.allowPhoneOverlap),
      });
      const hasUserUpdate = updates.userId !== undefined;
      const nextUserId = hasUserUpdate ? (String(updates.userId || '').trim() || undefined) : cur.userId;
      const userLinkChanged = (cur.userId || null) !== (nextUserId || null);
      let targetUsr = null;
      if (nextUserId) {
        targetUsr = (db.users || []).find((u) => u.id === nextUserId);
        if (!targetUsr) throw new AppError(404, 'حساب المستخدم المحدد غير موجود', 'USER_NOT_FOUND');
        if (targetUsr.role === 'customer') {
          throw new AppError(400, 'لا يمكن ربط حساب عميل بملف موظف', 'INVALID_ROLE_EMPLOYEE_LINK');
        }
        if (targetUsr.employeeId && targetUsr.employeeId !== id) {
          throw new AppError(409, 'حساب المستخدم المختار مربوط مسبقًا بملف موظف آخر', 'USER_ALREADY_LINKED_TO_EMPLOYEE');
        }
        if ((db.employees || []).some((e) => e.id !== id && e.userId === nextUserId)) {
          throw new AppError(409, 'حساب المستخدم المختار مربوط مسبقًا بملف موظف آخر', 'USER_ALREADY_LINKED_TO_EMPLOYEE');
        }
      }
      if (userLinkChanged) {
        if (cur.userId && cur.userId !== nextUserId) {
          const oldUsr = (db.users || []).find((u) => u.id === cur.userId);
          if (oldUsr && oldUsr.employeeId === id) oldUsr.employeeId = undefined;
          splitDetachedEmployeeUserIdentityJsonTx(db, {
            detachType: 'user',
            detachId: cur.userId,
            sharedIdentityId: cur.identityId,
            now,
          });
        }
        for (const u of db.users || []) {
          if (u.employeeId === id && u.id !== nextUserId) u.employeeId = undefined;
        }
      }
      const { basicSalary: _curBasicSalary, ...curClean } = cur;
      db.employees[idx] = { ...curClean, ...cleanUpdates, id, name: empName, userId: nextUserId };
      if (nextUserId && targetUsr) {
        targetUsr.employeeId = id;
        alignEmployeeUserIdentityJsonTx(db, {
          userId: nextUserId,
          employeeId: id,
          preferredIdentityId: cleanUpdates.identityId || null,
          now,
        });
      } else {
        const empIdnId = attachRecordToIdentityJsonTx(db, {
          entityType: 'employee',
          entityId: id,
          roleKey: 'employee',
          fullName: empName,
          phone: nextPhone,
          nationalId: nextNationalId,
          notes: cleanUpdates.notes ?? cur.notes ?? '',
          explicitIdentityId: cleanUpdates.identityId || cur.identity_id || null,
          now,
        });
        db.employees[idx].identityId = empIdnId;
      }
    });
  }

  if (actor) {
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `تحديث بيانات الموظف (${empName})`,
      module: 'الموظفون',
      recordId: id,
    });
  }
  return { ok: true };
}

export async function executeCashOperation(payload, actor, idempotencyKey = '') {
  if (actor?.role === 'representative') {
    throw new AppError(403, 'العمليات الإدارية للخزائن غير متاحة للمندوبين', 'FORBIDDEN_REP_CASHBOX_OP');
  }
  const opType = String(payload.type || '').trim();
  const validTypes = ['cash_withdrawal', 'cash_deposit', 'cashbox_transfer', 'expense', 'profit_deposit'];
  if (!validTypes.includes(opType)) {
    throw new AppError(400, 'نوع العملية النقدية غير صالح', 'INVALID_CASH_OP');
  }

  const amt = round2(payload.amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new AppError(400, 'المبلغ يجب أن يكون أكبر من صفر', 'INVALID_AMOUNT');
  }

  const cashboxId = String(payload.cashboxId || '').trim();
  const targetCashboxId = String(payload.targetCashboxId || '').trim();
  if (!cashboxId) throw new AppError(400, 'يرجى تحديد الخزينة أو الحساب', 'CASHBOX_REQUIRED');
  if (opType === 'cashbox_transfer' && (!targetCashboxId || targetCashboxId === cashboxId)) {
    throw new AppError(400, 'يرجى تحديد خزينة وجهة مختلفة للترحيل', 'INVALID_TARGET_CASHBOX');
  }

  const dateStr = payload.date || todayIso();
  const notes = String(payload.notes || '').trim();
  const category = String(
    payload.category ||
      (opType === 'cash_withdrawal'
        ? 'سحب نقدي'
        : opType === 'cash_deposit'
        ? 'إيداع نقدي'
        : opType === 'cashbox_transfer'
        ? 'ترحيل بين الخزائن'
        : opType === 'profit_deposit'
        ? 'إيداع ربحي'
        : 'مصروفات تشغيل')
  ).trim();
  const recipientOrPayer = String(payload.recipientOrPayer || '').trim();
  const cleanIdem = idempotencyKey ? String(idempotencyKey).trim() : null;
  const now = nowIso();
  const ftId = generateServerId('FT');

  const txTypeMap = {
    cash_withdrawal: 'withdrawal',
    cash_deposit: 'deposit',
    cashbox_transfer: 'transfer',
    expense: 'expense',
    profit_deposit: 'income',
  };
  const finType = txTypeMap[opType];
  const isOutflow = opType === 'cash_withdrawal' || opType === 'cashbox_transfer' || opType === 'expense';

  if (await isPgMode()) {
    const out = await withTransaction(async (client) => {
      if (cleanIdem) {
        const dup = await client.query('SELECT response_json FROM idempotency_keys WHERE key_id = $1 LIMIT 1', [cleanIdem]);
        if (dup.rows[0]) {
          return { deduplicated: true, ...dup.rows[0].response_json };
        }
      }

      const cbRes = await client.query('SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE', [cashboxId]);
      const cb = cbRes.rows[0];
      if (!cb) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');

      const curBal = Number(cb.current_balance || 0);
      if (isOutflow && curBal < amt) {
        throw new AppError(409, `الرصيد المتاح في (${cb.name}) هو ${curBal} ولا يكفي لتنفيذ عملية بقيمة ${amt}`, 'INSUFFICIENT_CASHBOX');
      }

      let targetCb = null;
      if (opType === 'cashbox_transfer') {
        const tRes = await client.query('SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE', [targetCashboxId]);
        targetCb = tRes.rows[0];
        if (!targetCb) throw new AppError(404, 'الخزينة الوجهة غير موجودة', 'CASHBOX_NOT_FOUND');
        const nextTargetBal = round2(Number(targetCb.current_balance || 0) + amt);
        await client.query('UPDATE cashboxes SET current_balance = $1 WHERE id = $2', [nextTargetBal, targetCashboxId]);
      }

      const nextBal = isOutflow ? round2(curBal - amt) : round2(curBal + amt);
      await client.query('UPDATE cashboxes SET current_balance = $1 WHERE id = $2', [nextBal, cashboxId]);

      const seqRes = await client.query(`SELECT nextval('seq_cash_op_no') AS n`);
      const txNumber = `COP-${String(seqRes.rows[0].n).padStart(5, '0')}`;

      const actorCtx = await resolveActorIdentityPgTx(client, actor);
      let expenseIncomeRecord = null;
      if (opType === 'expense' || opType === 'profit_deposit') {
        const expId = generateServerId('EXP');
        const voucherNo = `${opType === 'expense' ? 'EXP' : 'INC'}-${String(seqRes.rows[0].n).padStart(5, '0')}`;
        const expType = opType === 'expense' ? 'expense' : 'income';
        await client.query(
          `INSERT INTO expenses_incomes (id, voucher_number, type, category, amount, date, cashbox_id, cashbox_name, payment_method, recipient_or_payer, notes, created_by_user_id, created_by, actor_identity_id, actor_employee_id, acting_role, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'cash',$9,$10,$11,$12,$13,$14,$15,$16)`,
          [expId, voucherNo, expType, category, amt, dateStr, cb.id, cb.name, recipientOrPayer, notes, actor.id, actor.fullName, actorCtx.actorIdentityId || null, actorCtx.actorEmployeeId || null, actorCtx.actingRole || actor.role || null, now]
        );
        expenseIncomeRecord = {
          id: expId,
          recordNumber: voucherNo,
          type: expType,
          category,
          amount: amt,
          date: dateStr,
          cashboxId: cb.id,
          cashboxName: cb.name,
          paymentMethod: 'cash',
          recipientOrPayer,
          notes,
          createdByUserId: actor.id,
          createdBy: actor.fullName,
          actorIdentityId: actorCtx.actorIdentityId || undefined,
          actorEmployeeId: actorCtx.actorEmployeeId || undefined,
          actingRole: actorCtx.actingRole || actor.role || undefined,
          createdAt: now,
        };
      }

      const desc =
        opType === 'cashbox_transfer'
          ? `ترحيل نقدي من ${cb.name} إلى ${targetCb.name}`
          : `${category}${recipientOrPayer ? ` - ${recipientOrPayer}` : ''}`;

      await client.query(
        `INSERT INTO financial_transactions (id, transaction_number, date, type, amount, cashbox_id, cashbox_name, balance_after, category, related_entity_name, related_doc_id, related_doc_number, description, notes, created_by_user_id, created_by, actor_identity_id, actor_employee_id, acting_role, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [
          ftId, txNumber, dateStr, finType, amt, cb.id, cb.name, nextBal, category,
          recipientOrPayer || (targetCb ? targetCb.name : ''),
          expenseIncomeRecord?.id || null,
          expenseIncomeRecord?.recordNumber || txNumber,
          desc, notes, actor.id, actor.fullName,
          actorCtx.actorIdentityId || null,
          actorCtx.actorEmployeeId || null,
          actorCtx.actingRole || actor.role || null,
          now,
        ]
      );

      const transaction = {
        id: ftId,
        transactionNumber: txNumber,
        date: dateStr,
        type: finType,
        cashboxId: cb.id,
        cashboxName: cb.name,
        targetCashboxId: targetCb?.id,
        targetCashboxName: targetCb?.name,
        amount: amt,
        category,
        partyName: recipientOrPayer || undefined,
        description: desc,
        notes,
        createdByUserId: actor.id,
        createdBy: actor.fullName,
        actorIdentityId: actorCtx.actorIdentityId || undefined,
        actorEmployeeId: actorCtx.actorEmployeeId || undefined,
        actingRole: actorCtx.actingRole || actor.role || undefined,
        createdAt: now,
      };
      const payloadOut = { deduplicated: false, transaction, expenseIncomeRecord };

      if (cleanIdem) {
        await client.query(
          `INSERT INTO idempotency_keys (key_id, user_id, endpoint, response_json) VALUES ($1,$2,'POST /api/admin/cash-operations',$3) ON CONFLICT (key_id) DO NOTHING`,
          [cleanIdem, actor.id, JSON.stringify({ transaction, expenseIncomeRecord })]
        );
      }
      return payloadOut;
    });

    if (!out.deduplicated) {
      await recordAuditLog({
        userId: actor.id,
        userName: actor.fullName,
        action: `${category} (${amt})`,
        module: 'التعاملات النقدية',
        recordId: out.transaction.id,
        notes: out.transaction.description,
      });
    }
    return out;
  }

  // JSON Ledger mode
  const out = await withJsonTransaction((db) => {
    if (cleanIdem) {
      const idemMap = readJsonIdempotency();
      if (idemMap[cleanIdem]) {
        return { deduplicated: true, ...idemMap[cleanIdem] };
      }
    }

    const cb = db.cashboxes.find((c) => c.id === cashboxId);
    if (!cb) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');
    const curBal = Number(cb.currentBalance || 0);
    if (isOutflow && curBal < amt) {
      throw new AppError(409, `الرصيد المتاح في (${cb.name}) هو ${curBal} ولا يكفي لتنفيذ عملية بقيمة ${amt}`, 'INSUFFICIENT_CASHBOX');
    }

    let targetCb = null;
    if (opType === 'cashbox_transfer') {
      targetCb = db.cashboxes.find((c) => c.id === targetCashboxId);
      if (!targetCb) throw new AppError(404, 'الخزينة الوجهة غير موجودة', 'CASHBOX_NOT_FOUND');
      targetCb.currentBalance = round2(Number(targetCb.currentBalance || 0) + amt);
    }
    cb.currentBalance = isOutflow ? round2(curBal - amt) : round2(curBal + amt);

    const seq = nextJsonSequence(db, 'cashOpNo', db.financialTransactions, 'transactionNumber', /^COP-(\d+)$/i);
    const txNumber = `COP-${String(seq).padStart(5, '0')}`;

    const actorCtxJson = resolveActorIdentityJsonTx(db, actor);
    let expenseIncomeRecord = null;
    if (opType === 'expense' || opType === 'profit_deposit') {
      const expId = generateServerId('EXP');
      const voucherNo = `${opType === 'expense' ? 'EXP' : 'INC'}-${String(seq).padStart(5, '0')}`;
      expenseIncomeRecord = {
        id: expId,
        recordNumber: voucherNo,
        type: opType === 'expense' ? 'expense' : 'income',
        category,
        amount: amt,
        date: dateStr,
        cashboxId: cb.id,
        cashboxName: cb.name,
        paymentMethod: 'cash',
        recipientOrPayer,
        notes,
        createdByUserId: actor.id,
        createdBy: actor.fullName,
        actorIdentityId: actorCtxJson.actorIdentityId,
        actorEmployeeId: actorCtxJson.actorEmployeeId,
        actingRole: actorCtxJson.actingRole,
        createdAt: now,
      };
      db.expenseIncomes.unshift(expenseIncomeRecord);
    }

    const desc =
      opType === 'cashbox_transfer'
        ? `ترحيل نقدي من ${cb.name} إلى ${targetCb.name}`
        : `${category}${recipientOrPayer ? ` - ${recipientOrPayer}` : ''}`;

    const transaction = {
      id: ftId,
      transactionNumber: txNumber,
      date: dateStr,
      type: finType,
      cashboxId: cb.id,
      cashboxName: cb.name,
      balanceAfter: cb.currentBalance,
      targetCashboxId: targetCb?.id,
      targetCashboxName: targetCb?.name,
      amount: amt,
      category,
      relatedDocType: 'manual',
      relatedDocId: expenseIncomeRecord?.id,
      relatedDocNumber: expenseIncomeRecord?.recordNumber || txNumber,
      partyName: recipientOrPayer || undefined,
      description: desc,
      notes,
      createdByUserId: actor.id,
      createdBy: actor.fullName,
      actorIdentityId: actorCtxJson.actorIdentityId,
      actorEmployeeId: actorCtxJson.actorEmployeeId,
      actingRole: actorCtxJson.actingRole,
      createdAt: now,
    };
    db.financialTransactions.unshift(transaction);

    if (cleanIdem) {
      const idemMap = readJsonIdempotency();
      idemMap[cleanIdem] = { transaction, expenseIncomeRecord };
      writeJsonIdempotency(idemMap);
    }
    return { deduplicated: false, transaction, expenseIncomeRecord };
  });

  if (!out.deduplicated) {
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `${category} (${amt})`,
      module: 'التعاملات النقدية',
      recordId: out.transaction.id,
      notes: out.transaction.description,
    });
  }
  return out;
}

export async function renameCategoryGlobal(categoryId, newName, actor) {
  const cleanName = String(newName || '').trim();
  if (!cleanName) throw new AppError(400, 'يرجى كتابة الاسم الجديد للتصنيف', 'INVALID_CATEGORY_NAME');

  if (await isPgMode()) {
    const out = await withTransaction(async (client) => {
      const cRes = await client.query('SELECT * FROM product_categories WHERE id = $1 FOR UPDATE', [categoryId]);
      const cur = cRes.rows[0];
      if (!cur) throw new AppError(404, 'التصنيف غير موجود', 'CATEGORY_NOT_FOUND');
      const oldName = cur.name;
      await client.query('UPDATE product_categories SET name = $1 WHERE id = $2', [cleanName, categoryId]);
      await client.query('UPDATE products SET category = $1 WHERE category_id = $2 OR category = $3', [cleanName, categoryId, oldName]);
      return { id: categoryId, oldName, newName: cleanName };
    });
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `تغيير اسم التصنيف (${out.oldName} ← ${out.newName})`,
      module: 'تصنيفات السلع',
      recordId: categoryId,
    });
    return out;
  }

  const out = await withJsonTransaction((db) => {
    const cat = db.categories.find((c) => c.id === categoryId);
    if (!cat) throw new AppError(404, 'التصنيف غير موجود', 'CATEGORY_NOT_FOUND');
    const oldName = cat.name;
    cat.name = cleanName;
    db.products.forEach((p) => {
      if (p.categoryId === categoryId || p.category === oldName) {
        p.category = cleanName;
      }
    });
    return { id: categoryId, oldName, newName: cleanName };
  });
  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `تغيير اسم التصنيف (${out.oldName} ← ${out.newName})`,
    module: 'تصنيفات السلع',
    recordId: categoryId,
  });
  return out;
}

function sanitizeRemoteHttpsUrl(rawUrl, label, { requireHttps = true } = {}) {
  const trimmed = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new AppError(400, `صيغة رابط ${label} غير صالحة`, 'INVALID_CONNECTION_URL');
  }
  if (requireHttps && parsed.protocol !== 'https:') {
    throw new AppError(
      400,
      `يجب أن يستخدم ${label} بروتوكول HTTPS المشفر لحماية الاتصال الخارجي والتوكنات`,
      'HTTPS_REQUIRED_FOR_REMOTE'
    );
  }
  return parsed.origin + (parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.replace(/\/+$/, '') : '');
}

export function sanitizeConnectionConfig(raw, prev = {}) {
  if (!raw || typeof raw !== 'object') return prev;
  const allowedModes = new Set(['local_network', 'free_remote', 'pro_remote', 'cloud_vps']);
  const activeMode = allowedModes.has(raw.activeMode) ? raw.activeMode : (allowedModes.has(prev.activeMode) ? prev.activeMode : 'local_network');
  const localRaw = raw.localNetwork && typeof raw.localNetwork === 'object' ? { ...(prev.localNetwork || {}), ...raw.localNetwork } : prev.localNetwork || {};
  const portNum = Math.min(65535, Math.max(1, Number(localRaw.port || 3000) || 3000));
  const cleanIp = String(localRaw.ip || '192.168.1.100')
    .trim()
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .split(':')[0];
  const cleanHostname = String(localRaw.hostname || 'awlad-selim-server').trim().slice(0, 120);

  const enforceHttps =
    raw.enforceHttpsForRemote !== undefined
      ? raw.enforceHttpsForRemote !== false
      : prev.enforceHttpsForRemote !== false;

  const rawTunnelUrl =
    raw.freeRemote && Object.prototype.hasOwnProperty.call(raw.freeRemote, 'tunnelUrl')
      ? raw.freeRemote.tunnelUrl
      : prev.freeRemote?.tunnelUrl;
  const rawDomainUrl =
    raw.proRemote && Object.prototype.hasOwnProperty.call(raw.proRemote, 'domainUrl')
      ? raw.proRemote.domainUrl
      : prev.proRemote?.domainUrl;
  const rawVpsUrl =
    raw.cloudVps && Object.prototype.hasOwnProperty.call(raw.cloudVps, 'vpsUrl')
      ? raw.cloudVps.vpsUrl
      : prev.cloudVps?.vpsUrl;
  const rawVpsNotes =
    raw.cloudVps && Object.prototype.hasOwnProperty.call(raw.cloudVps, 'notes')
      ? raw.cloudVps.notes
      : prev.cloudVps?.notes;

  const freeTunnelUrl = sanitizeRemoteHttpsUrl(rawTunnelUrl, 'الربط الخارجي المجاني (Cloudflare Quick Tunnel)', {
    requireHttps: enforceHttps,
  });
  const proDomainUrl = sanitizeRemoteHttpsUrl(rawDomainUrl, 'الربط الخارجي الاحترافي (Named Tunnel)', {
    requireHttps: enforceHttps,
  });
  const vpsUrl = sanitizeRemoteHttpsUrl(rawVpsUrl, 'السيرفر السحابي (Cloud VPS)', {
    requireHttps: enforceHttps,
  });

  const prevVersion = Number(prev.configVersion || 0);
  const nextVersion = Math.max(1, Number(raw.configVersion || 0) || (prevVersion >= 1 ? prevVersion + 1 : 1));
  const autoDetect =
    raw.freeRemote?.autoDetect !== undefined
      ? Boolean(raw.freeRemote.autoDetect)
      : prev.freeRemote?.autoDetect !== false;
  const proProviderRaw = String(raw.proRemote?.provider || prev.proRemote?.provider || 'cloudflare_named_tunnel');
  const proProvider = ['cloudflare_named_tunnel', 'nginx_reverse_proxy', 'custom'].includes(proProviderRaw)
    ? proProviderRaw
    : 'cloudflare_named_tunnel';

  // Never persist secrets, tokens, passwords, or SSH keys in connectionConfig
  return {
    activeMode,
    configVersion: nextVersion,
    localNetwork: {
      ip: cleanIp || '192.168.1.100',
      port: portNum,
      hostname: cleanHostname || 'awlad-selim-server',
    },
    freeRemote: {
      tunnelUrl: freeTunnelUrl,
      autoDetect,
    },
    proRemote: {
      domainUrl: proDomainUrl,
      provider: proProvider,
    },
    cloudVps: {
      vpsUrl,
      notes: String(rawVpsNotes || '').trim().slice(0, 400),
    },
    enforceHttpsForRemote: enforceHttps,
    updatedAt: nowIso(),
  };
}

export async function updateSystemSettings(updates, actor) {
  const now = nowIso();
  if (await isPgMode()) {
    const updated = await withTransaction(async (client) => {
      const existing = await client.query('SELECT * FROM system_settings LIMIT 1');
      if (existing.rows[0]) {
        const cur = existing.rows[0];
        const prevExtra = cur.extra_settings || {};
        const mergedExtra = {
          ...prevExtra,
          ...(updates.extraSettings || {}),
        };
        if (prevExtra.installationId) {
          mergedExtra.installationId = prevExtra.installationId;
        }
        if (updates.extraSettings?.connectionConfig !== undefined) {
          mergedExtra.connectionConfig = sanitizeConnectionConfig(
            updates.extraSettings.connectionConfig,
            prevExtra.connectionConfig || {}
          );
        }
        if (updates.mobileConfig !== undefined || updates.extraSettings?.mobileConfig !== undefined) {
          mergedExtra.mobileConfig = {
            ...(prevExtra.mobileConfig || {}),
            ...(updates.extraSettings?.mobileConfig || {}),
            ...(updates.mobileConfig || {}),
          };
        }
        const nextBranchNumber =
          updates.branchNumber !== undefined
            ? String(updates.branchNumber || '')
            : (cur.branch_number ?? prevExtra.branchNumber ?? '');
        mergedExtra.branchNumber = nextBranchNumber;
        await client.query(
          `UPDATE system_settings SET company_name=$1, company_subtitle=$2, phone1=$3, phone2=$4, address=$5, commercial_registration=$6, tax_number=$7, branch_number=$8, currency=$9, default_print_mode=$10, invoice_notes=$11, allow_negative_stock=$12, extra_settings=$13, updated_at=$14 WHERE id=$15`,
          [
            updates.companyName ?? cur.company_name,
            updates.companySubtitle ?? cur.company_subtitle,
            updates.phone1 ?? cur.phone1,
            updates.phone2 ?? cur.phone2,
            updates.address ?? cur.address,
            updates.commercialRegistration ?? cur.commercial_registration,
            updates.taxNumber ?? cur.tax_number,
            nextBranchNumber,
            updates.currency ?? cur.currency,
            updates.defaultPrintMode ?? cur.default_print_mode,
            updates.invoiceNotes ?? cur.invoice_notes,
            updates.allowNegativeStock ?? cur.allow_negative_stock,
            JSON.stringify(mergedExtra),
            now,
            cur.id,
          ]
        );
        return { ...updates, branchNumber: nextBranchNumber, extraSettings: mergedExtra, mobileConfig: mergedExtra.mobileConfig };
      } else {
        const extraSettings = { ...(updates.extraSettings || {}) };
        if (extraSettings.connectionConfig !== undefined) {
          extraSettings.connectionConfig = sanitizeConnectionConfig(extraSettings.connectionConfig, {});
        }
        if (updates.mobileConfig) {
          extraSettings.mobileConfig = { ...(extraSettings.mobileConfig || {}), ...(updates.mobileConfig || {}) };
        }
        const nextBranchNumber = String(updates.branchNumber ?? extraSettings.branchNumber ?? '');
        extraSettings.branchNumber = nextBranchNumber;
        await client.query(
          `INSERT INTO system_settings (id, company_name, company_subtitle, phone1, phone2, address, commercial_registration, tax_number, branch_number, currency, default_print_mode, invoice_notes, allow_negative_stock, extra_settings, updated_at)
           VALUES ('default',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            updates.companyName || 'أولاد سليم',
            updates.companySubtitle || '',
            updates.phone1 || '',
            updates.phone2 || '',
            updates.address || '',
            updates.commercialRegistration || '',
            updates.taxNumber || '',
            nextBranchNumber,
            updates.currency || 'ج.م',
            updates.defaultPrintMode || 'a4',
            updates.invoiceNotes || '',
            Boolean(updates.allowNegativeStock),
            JSON.stringify(extraSettings),
            now,
          ]
        );
        return { ...updates, branchNumber: nextBranchNumber, extraSettings, mobileConfig: extraSettings.mobileConfig };
      }
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: 'تحديث إعدادات المؤسسة والاتصال', module: 'الإعدادات' });
    return updated;
  }

  const updated = await withJsonTransaction((db) => {
    const prevExtra = db.settings.extraSettings || {};
    const mergedExtra = {
      ...prevExtra,
      ...(updates.extraSettings || {}),
    };
    if (prevExtra.installationId) {
      mergedExtra.installationId = prevExtra.installationId;
    }
    if (updates.extraSettings?.connectionConfig !== undefined) {
      mergedExtra.connectionConfig = sanitizeConnectionConfig(
        updates.extraSettings.connectionConfig,
        prevExtra.connectionConfig || {}
      );
    }
    if (updates.mobileConfig !== undefined || updates.extraSettings?.mobileConfig !== undefined) {
      mergedExtra.mobileConfig = {
        ...(prevExtra.mobileConfig || {}),
        ...(updates.extraSettings?.mobileConfig || {}),
        ...(updates.mobileConfig || {}),
      };
    }
    db.settings = { ...db.settings, ...updates, extraSettings: mergedExtra };
    return { ...db.settings, mobileConfig: mergedExtra.mobileConfig };
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: 'تحديث إعدادات المؤسسة والاتصال', module: 'الإعدادات' });
  return updated;
}

export async function getRolePermissionPresets() {
  const settings = await getSystemSettingsSafe();
  return resolveRolePermissionPresets(settings.extraSettings || {});
}

export async function updateRolePermissionPresets(payload = {}, actor) {
  const now = nowIso();
  if (await isPgMode()) {
    const presets = await withTransaction(async (client) => {
      const existing = await client.query('SELECT * FROM system_settings LIMIT 1');
      if (existing.rows[0]) {
        const cur = existing.rows[0];
        const prevExtra = cur.extra_settings || {};
        const prevPresets = resolveRolePermissionPresets(prevExtra);
        const nextPresets = {
          representative: payload.representative
            ? sanitizeRolePermissionPreset('representative', payload.representative)
            : prevPresets.representative,
          customer: payload.customer
            ? sanitizeRolePermissionPreset('customer', payload.customer)
            : prevPresets.customer,
        };
        const mergedExtra = { ...prevExtra, roleDefaultPermissions: nextPresets };
        await client.query(`UPDATE system_settings SET extra_settings = $1, updated_at = $2 WHERE id = $3`, [
          JSON.stringify(mergedExtra),
          now,
          cur.id,
        ]);
        return nextPresets;
      } else {
        const nextPresets = resolveRolePermissionPresets({ roleDefaultPermissions: payload });
        await client.query(
          `INSERT INTO system_settings (id, company_name, extra_settings, updated_at) VALUES ('default','أولاد سليم',$1,$2)`,
          [JSON.stringify({ roleDefaultPermissions: nextPresets }), now]
        );
        return nextPresets;
      }
    });
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: 'تحديث قوالب الصلاحيات الافتراضية (المندوب / العميل)',
      module: 'المستخدمون',
      newValues: presets,
    });
    return presets;
  }

  const presets = await withJsonTransaction((db) => {
    const prevExtra = db.settings?.extraSettings || {};
    const prevPresets = resolveRolePermissionPresets(prevExtra);
    const nextPresets = {
      representative: payload.representative
        ? sanitizeRolePermissionPreset('representative', payload.representative)
        : prevPresets.representative,
      customer: payload.customer
        ? sanitizeRolePermissionPreset('customer', payload.customer)
        : prevPresets.customer,
    };
    db.settings = {
      ...(db.settings || {}),
      extraSettings: {
        ...prevExtra,
        roleDefaultPermissions: nextPresets,
      },
    };
    return nextPresets;
  });
  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: 'تحديث قوالب الصلاحيات الافتراضية (المندوب / العميل)',
    module: 'المستخدمون',
    newValues: presets,
  });
  return presets;
}

// ==============================================================================
// Backup Export & Safe Restore (Never loses pre-restore state)
// ==============================================================================

export async function exportFullBackup(actor) {
  if (await isPgMode()) {
    const pool = getPool();
    const full = await getStaffBootstrapData(actor);
    const uRes = await pool.query('SELECT * FROM users ORDER BY created_at ASC');
    full.users = uRes.rows.map(mapPgUserRow);
    full.exportedAt = nowIso();
    full.version = '3.0.0';
    return full;
  }
  const db = readJsonDatabase();
  return {
    ...db,
    auditLogs: await listAuditLogs(2000),
    exportedAt: nowIso(),
    version: '3.0.0',
  };
}

export async function restoreFullBackup(backupData, actor) {
  if (!backupData || typeof backupData !== 'object' || !Array.isArray(backupData.users) || !Array.isArray(backupData.products)) {
    throw new AppError(400, 'ملف النسخة الاحتياطية غير صالح أو تالف', 'INVALID_BACKUP');
  }

  const { dataDir } = getDataPaths();
  const safetyFile = path.join(dataDir, `database.pre_restore.${Date.now()}.readonly.bak.json`);
  const currentSnapshot = await exportFullBackup(actor);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(safetyFile, JSON.stringify(currentSnapshot, null, 2), 'utf8');
  try { fs.chmodSync(safetyFile, 0o444); } catch {}

  if (await isPgMode()) {
    // Delegate structured transactional upsert/restore through migrator
    const { runDataMigration } = await import('../migrator.js');
    const res = await runDataMigration(backupData, actor.fullName, { skipBackupFile: true });
    if (!res.success) {
      throw new AppError(500, `فشل استعادة النسخة الاحتياطية: ${res.error}`, 'RESTORE_FAILED');
    }
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: 'استعادة نسخة احتياطية كاملة في PostgreSQL', module: 'النسخ الاحتياطي' });
    return { ok: true, safetyBackup: safetyFile, log: res.log };
  }

  await withJsonTransaction((working, commit) => {
    const normalized = normalizeDbState(backupData);
    for (const key of Object.keys(working)) {
      delete working[key];
    }
    Object.assign(working, normalized);
    commit();
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: 'استعادة نسخة احتياطية كاملة', module: 'النسخ الاحتياطي' });
  return { ok: true, safetyBackup: safetyFile };
}

// ==============================================================================
// Representative Custody Operations & Custody Statement
// ==============================================================================

async function resolveTargetRepAndVan(repIdParam, actor) {
  const isRep = actor.role === 'representative';
  let rep = null;
  if (isRep) {
    rep = await getRepresentativeByUserId(actor.id);
    if (!rep) throw new AppError(403, 'حساب المندوب غير مربوط بملف مندوب مسجل', 'REP_PROFILE_REQUIRED');
    if (repIdParam && repIdParam !== rep.id) {
      throw new AppError(403, 'غير مصرح لك بتنفيذ عمليات على عهدة مندوب آخر', 'FORBIDDEN_REP_CUSTODY');
    }
  } else {
    if (!repIdParam) throw new AppError(400, 'يرجى تحديد المندوب المطلوب', 'REP_REQUIRED');
    if (await isPgMode()) {
      const r = (await getPool().query('SELECT * FROM representatives WHERE id = $1 LIMIT 1', [repIdParam])).rows[0];
      if (!r) throw new AppError(404, 'المندوب غير موجود', 'REP_NOT_FOUND');
      rep = { id: r.id, name: r.name, warehouseId: r.warehouse_id };
    } else {
      const db = readJsonDatabase();
      const r = (db.representatives || []).find((x) => x.id === repIdParam);
      if (!r) throw new AppError(404, 'المندوب غير موجود', 'REP_NOT_FOUND');
      rep = r;
    }
  }
  if (!rep.warehouseId) {
    const wh = await ensureRepVanWarehouse(rep.name, actor, rep.id);
    rep.warehouseId = wh.id;
  }
  return rep;
}

export async function recordRepCustodyDelivery(payload, actor, idempotencyKey = '') {
  const rep = await resolveTargetRepAndVan(payload.representativeId, actor);
  const items = Array.isArray(payload.items) && payload.items.length
    ? payload.items
    : payload.productId
    ? [{ productId: payload.productId, quantity: payload.quantity, unit: payload.unit, notes: payload.notes }]
    : [];
  if (!items.length) throw new AppError(400, 'يجب تحديد صنف واحد على الأقل للتسليم من العهدة', 'EMPTY_ITEMS');

  const dateStr = payload.date || todayIso();
  const now = nowIso();
  const endpoint = 'POST /api/inventory/rep-custody/deliver';
  const scopedIdem = buildScopedIdemKey(endpoint, actor, idempotencyKey);

  if (await isPgMode()) {
    const out = await withTransaction(async (client) => {
      const dup = await findPgIdempotency(client, scopedIdem);
      if (dup) return { ...dup, deduplicated: true };

      if (payload.invoiceId) {
        const invRow = (await client.query(`SELECT id, invoice_number, type, status, warehouse_id FROM invoices WHERE id = $1 LIMIT 1`, [payload.invoiceId])).rows[0];
        if (invRow && invRow.status === 'confirmed' && invRow.type === 'sales' && invRow.warehouse_id === rep.warehouseId) {
          throw new AppError(
            409,
            `تم خصم بضاعة الفاتورة (${invRow.invoice_number}) تلقائياً من عهدة السيارة عند تأكيدها ولا يمكن خصمها مرة أخرى`,
            'DUPLICATE_INVOICE_CUSTODY_DELIVERY'
          );
        }
      }

      const wh = (await client.query('SELECT id, name FROM warehouses WHERE id = $1', [rep.warehouseId])).rows[0];
      if (!wh) throw new AppError(404, 'مخزن سيارة المندوب غير موجود', 'WAREHOUSE_NOT_FOUND');
      const stRes = await client.query('SELECT allow_negative_stock FROM system_settings LIMIT 1');
      const allowNeg = Boolean(stRes.rows[0]?.allow_negative_stock);

      let custName = payload.customerName || '';
      if (payload.customerId && !custName) {
        const cRow = (await client.query('SELECT name FROM customers WHERE id = $1', [payload.customerId])).rows[0];
        if (cRow) custName = cRow.name;
      }

      const operations = [];
      const actorCtx = await resolveActorIdentityPgTx(client, actor);
      for (const item of items) {
        const qty = round3(item.quantity);
        if (!item.productId || qty <= 0) throw new AppError(400, 'الكمية المسلمة يجب أن تكون أكبر من صفر', 'INVALID_QUANTITY');

        const pRes = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [item.productId]);
        const prod = pRes.rows[0];
        if (!prod) throw new AppError(404, 'الصنف غير موجود', 'PRODUCT_NOT_FOUND');
        const uRes = await client.query('SELECT * FROM product_units WHERE product_id = $1', [prod.id]);
        const unitName = String(item.unit || prod.base_unit);
        const unitObj = uRes.rows.find((u) => u.name === unitName);
        const factor = unitObj ? Number(unitObj.conversion_factor || 1) : 1;
        const baseQty = round3(qty * factor);

        const stockMap = { ...(prod.stock_per_warehouse || {}) };
        const avail = Number(stockMap[rep.warehouseId] || 0);
        if (avail < baseQty && !allowNeg) {
          throw new AppError(409, `المتاح بعهدة المندوب للصنف (${prod.name}) هو (${avail}) ولا يكفي لتسليم (${baseQty})`, 'INSUFFICIENT_CUSTODY_STOCK');
        }
        stockMap[rep.warehouseId] = round3(avail - baseQty);
        await client.query('UPDATE products SET stock_per_warehouse = $1, updated_at = $2 WHERE id = $3', [JSON.stringify(stockMap), now, prod.id]);

        const opId = generateServerId('RCO');
        const seqRes = await client.query(`SELECT nextval('seq_rep_custody_op_no') AS n`);
        const opNo = `RCO-${String(seqRes.rows[0]?.n || 1).padStart(5, '0')}`;

        await client.query(
          `INSERT INTO rep_custody_operations (id, operation_number, date, representative_id, representative_name, operation_type, product_id, product_name, unit, unit_factor, quantity, base_quantity, warehouse_id, warehouse_name, customer_id, customer_name, invoice_id, invoice_number, notes, status, created_by_user_id, created_by, actor_identity_id, actor_employee_id, acting_role, created_at)
           VALUES ($1,$2,$3,$4,$5,'delivered_to_customer',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'approved',$19,$20,$21,$22,$23,$24)`,
          [opId, opNo, dateStr, rep.id, rep.name, prod.id, prod.name, unitName, factor, qty, baseQty, wh.id, wh.name, payload.customerId || null, custName, payload.invoiceId || null, payload.invoiceNumber || null, item.notes || payload.notes || `تسليم من عهدة المندوب للعميل ${custName}`, actor.id, actor.fullName, actorCtx.actorIdentityId || null, actorCtx.actorEmployeeId || null, actorCtx.actingRole || actor.role || null, now]
        );

        const mvId = generateServerId('SM');
        await client.query(
          `INSERT INTO stock_movements (id, movement_number, date, product_id, product_name, warehouse_id, warehouse_name, movement_type, quantity, unit, unit_factor, unit_cost, balance_after, related_doc_type, related_doc_id, related_doc_number, notes, created_by_user_id, created_by, actor_identity_id, actor_employee_id, acting_role, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'custody_delivery',$8,$9,$10,$11,$12,'rep_custody',$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
          [mvId, mvId, dateStr, prod.id, prod.name, wh.id, wh.name, baseQty, unitName, factor, prod.purchase_price, stockMap[rep.warehouseId], opId, opNo, `تسليم من عهدة المندوب للعميل ${custName}`, actor.id, actor.fullName, actorCtx.actorIdentityId || null, actorCtx.actorEmployeeId || null, actorCtx.actingRole || actor.role || null, now]
        );

        operations.push({
          id: opId,
          operationNumber: opNo,
          date: dateStr,
          representativeId: rep.id,
          representativeName: rep.name,
          operationType: 'delivered_to_customer',
          productId: prod.id,
          productName: prod.name,
          unit: unitName,
          unitFactor: factor,
          quantity: qty,
          baseQuantity: baseQty,
          warehouseId: wh.id,
          warehouseName: wh.name,
          customerId: payload.customerId || undefined,
          customerName: custName,
          notes: item.notes || payload.notes || '',
          status: 'approved',
          createdByUserId: actor.id,
          createdBy: actor.fullName,
          actorIdentityId: actorCtx.actorIdentityId || undefined,
          actorEmployeeId: actorCtx.actorEmployeeId || undefined,
          actingRole: actorCtx.actingRole || actor.role || undefined,
          createdAt: now,
        });
      }

      const payloadOut = { operations };
      await savePgIdempotency(client, scopedIdem, actor, endpoint, payloadOut);
      return { deduplicated: false, ...payloadOut };
    });

    if (!out.deduplicated) {
      await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تسجيل تسليم من عهدة المندوب (${rep.name})`, module: 'عهدة المنادوبين', recordId: rep.id });
    }
    return out;
  }

  const out = await withJsonTransaction((db) => {
    const dup = findJsonIdempotency(scopedIdem);
    if (dup) return { ...dup, deduplicated: true };

    if (payload.invoiceId) {
      const invRow = (db.invoices || []).find((i) => i.id === payload.invoiceId);
      if (invRow && invRow.status === 'confirmed' && invRow.type === 'sales' && invRow.warehouseId === rep.warehouseId) {
        throw new AppError(
          409,
          `تم خصم بضاعة الفاتورة (${invRow.invoiceNumber}) تلقائياً من عهدة السيارة عند تأكيدها ولا يمكن خصمها مرة أخرى`,
          'DUPLICATE_INVOICE_CUSTODY_DELIVERY'
        );
      }
    }

    const wh = db.warehouses.find((w) => w.id === rep.warehouseId);
    if (!wh) throw new AppError(404, 'مخزن سيارة المندوب غير موجود', 'WAREHOUSE_NOT_FOUND');
    db.repCustodyOperations = db.repCustodyOperations || [];

    const cust = payload.customerId ? db.customers.find((c) => c.id === payload.customerId) : null;
    const custName = payload.customerName || cust?.name || '';
    const operations = [];
    const actorCtxJson = resolveActorIdentityJsonTx(db, actor);

    for (const item of items) {
      const qty = round3(item.quantity);
      if (!item.productId || qty <= 0) throw new AppError(400, 'الكمية المسلمة يجب أن تكون أكبر من صفر', 'INVALID_QUANTITY');
      const prod = db.products.find((p) => p.id === item.productId);
      if (!prod) throw new AppError(404, 'الصنف غير موجود', 'PRODUCT_NOT_FOUND');

      const unitName = String(item.unit || prod.baseUnit);
      const unitObj = (prod.units || []).find((u) => u.name === unitName);
      const factor = unitObj ? Number(unitObj.conversionFactor || 1) : 1;
      const baseQty = round3(qty * factor);
      const avail = Number(prod.stockPerWarehouse?.[rep.warehouseId] || 0);
      if (avail < baseQty && !db.settings?.allowNegativeStock) {
        throw new AppError(409, `المتاح بعهدة المندوب للصنف (${prod.name}) هو (${avail}) ولا يكفي لتسليم (${baseQty})`, 'INSUFFICIENT_CUSTODY_STOCK');
      }
      prod.stockPerWarehouse[rep.warehouseId] = round3(avail - baseQty);

      const seqNum = nextJsonSequence(db, 'repCustodyOpNo', db.repCustodyOperations, 'operationNumber', /(\d+)$/);
      const opNo = `RCO-${String(seqNum).padStart(5, '0')}`;
      const opObj = {
        id: generateServerId('RCO'),
        operationNumber: opNo,
        date: dateStr,
        representativeId: rep.id,
        representativeName: rep.name,
        operationType: 'delivered_to_customer',
        productId: prod.id,
        productName: prod.name,
        unit: unitName,
        unitFactor: factor,
        quantity: qty,
        baseQuantity: baseQty,
        warehouseId: wh.id,
        warehouseName: wh.name,
        customerId: payload.customerId || undefined,
        customerName: custName,
        invoiceId: payload.invoiceId || undefined,
        invoiceNumber: payload.invoiceNumber || undefined,
        notes: item.notes || payload.notes || '',
        status: 'approved',
        createdByUserId: actor.id,
        createdBy: actor.fullName,
        actorIdentityId: actorCtxJson.actorIdentityId,
        actorEmployeeId: actorCtxJson.actorEmployeeId,
        actingRole: actorCtxJson.actingRole,
        createdAt: now,
      };
      db.repCustodyOperations.unshift(opObj);
      operations.push(opObj);

      const mvId = generateServerId('SM');
      db.stockMovements.unshift({
        id: mvId,
        movementNumber: mvId,
        date: dateStr,
        type: 'custody_delivery',
        productId: prod.id,
        productName: prod.name,
        warehouseId: wh.id,
        warehouseName: wh.name,
        quantity: baseQty,
        unit: unitName,
        unitFactor: factor,
        unitCost: prod.purchasePrice,
        relatedDocType: 'rep_custody',
        referenceId: opObj.id,
        referenceNumber: opNo,
        notes: `تسليم من عهدة المندوب للعميل ${custName}`,
        createdByUserId: actor.id,
        createdBy: actor.fullName,
        actorIdentityId: actorCtxJson.actorIdentityId,
        actorEmployeeId: actorCtxJson.actorEmployeeId,
        actingRole: actorCtxJson.actingRole,
        createdAt: now,
      });
    }

    const payloadOut = { operations };
    saveJsonIdempotency(scopedIdem, payloadOut);
    return { deduplicated: false, ...payloadOut };
  });

  if (!out.deduplicated) {
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تسجيل تسليم من عهدة المندوب (${rep.name})`, module: 'عهدة المنادوبين', recordId: rep.id });
  }
  return out;
}

export async function recordRepCustodyReturn(payload, actor, idempotencyKey = '') {
  const rep = await resolveTargetRepAndVan(payload.representativeId, actor);
  const items = Array.isArray(payload.items) && payload.items.length
    ? payload.items
    : payload.productId
    ? [{ productId: payload.productId, quantity: payload.quantity, unit: payload.unit, notes: payload.notes }]
    : [];
  if (!items.length) throw new AppError(400, 'يجب تحديد صنف واحد على الأقل لإرجاعه للمخزن', 'EMPTY_ITEMS');

  const dateStr = payload.date || todayIso();
  const now = nowIso();
  const endpoint = 'POST /api/inventory/rep-custody/return';
  const scopedIdem = buildScopedIdemKey(endpoint, actor, idempotencyKey);

  if (await isPgMode()) {
    const out = await withTransaction(async (client) => {
      const dup = await findPgIdempotency(client, scopedIdem);
      if (dup) return { ...dup, deduplicated: true };

      const vanWh = (await client.query('SELECT id, name FROM warehouses WHERE id = $1', [rep.warehouseId])).rows[0];
      let targetWhId = payload.targetWarehouseId;
      if (!targetWhId) {
        const defWh = (await client.query('SELECT id FROM warehouses WHERE is_default = TRUE LIMIT 1')).rows[0];
        targetWhId = defWh?.id;
      }
      const targetWh = targetWhId ? (await client.query('SELECT id, name FROM warehouses WHERE id = $1', [targetWhId])).rows[0] : null;
      if (!vanWh || !targetWh) throw new AppError(404, 'المستودع غير موجود', 'WAREHOUSE_NOT_FOUND');

      const operations = [];
      const actorCtx = await resolveActorIdentityPgTx(client, actor);
      for (const item of items) {
        const qty = round3(item.quantity);
        if (!item.productId || qty <= 0) throw new AppError(400, 'الكمية المرتجعة يجب أن تكون أكبر من صفر', 'INVALID_QUANTITY');

        const pRes = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [item.productId]);
        const prod = pRes.rows[0];
        if (!prod) throw new AppError(404, 'الصنف غير موجود', 'PRODUCT_NOT_FOUND');
        const uRes = await client.query('SELECT * FROM product_units WHERE product_id = $1', [prod.id]);
        const unitName = String(item.unit || prod.base_unit);
        const unitObj = uRes.rows.find((u) => u.name === unitName);
        const factor = unitObj ? Number(unitObj.conversion_factor || 1) : 1;
        const baseQty = round3(qty * factor);

        const stockMap = { ...(prod.stock_per_warehouse || {}) };
        const avail = Number(stockMap[vanWh.id] || 0);
        if (avail < baseQty) {
          throw new AppError(409, `الرصيد المتاح بعهدة المندوب (${avail}) لا يكفي لإرجاع (${baseQty}) من ${prod.name}`, 'INSUFFICIENT_CUSTODY_STOCK');
        }
        stockMap[vanWh.id] = round3(avail - baseQty);
        stockMap[targetWh.id] = round3(Number(stockMap[targetWh.id] || 0) + baseQty);
        await client.query('UPDATE products SET stock_per_warehouse = $1, updated_at = $2 WHERE id = $3', [JSON.stringify(stockMap), now, prod.id]);

        const opId = generateServerId('RCO');
        const seqRes = await client.query(`SELECT nextval('seq_rep_custody_op_no') AS n`);
        const opNo = `RCO-${String(seqRes.rows[0]?.n || 1).padStart(5, '0')}`;

        await client.query(
          `INSERT INTO rep_custody_operations (id, operation_number, date, representative_id, representative_name, operation_type, product_id, product_name, unit, unit_factor, quantity, base_quantity, warehouse_id, warehouse_name, notes, status, created_by_user_id, created_by, actor_identity_id, actor_employee_id, acting_role, created_at)
           VALUES ($1,$2,$3,$4,$5,'returned_to_warehouse',$6,$7,$8,$9,$10,$11,$12,$13,$14,'approved',$15,$16,$17,$18,$19,$20)`,
          [opId, opNo, dateStr, rep.id, rep.name, prod.id, prod.name, unitName, factor, qty, baseQty, targetWh.id, targetWh.name, item.notes || payload.notes || `إرجاع عهدة للمخزن ${targetWh.name}`, actor.id, actor.fullName, actorCtx.actorIdentityId || null, actorCtx.actorEmployeeId || null, actorCtx.actingRole || actor.role || null, now]
        );

        const mvId = generateServerId('SM');
        await client.query(
          `INSERT INTO stock_movements (id, movement_number, date, product_id, product_name, warehouse_id, warehouse_name, target_warehouse_id, target_warehouse_name, movement_type, quantity, unit, unit_factor, unit_cost, balance_after, related_doc_type, related_doc_id, related_doc_number, notes, created_by_user_id, created_by, actor_identity_id, actor_employee_id, acting_role, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'custody_return',$10,$11,$12,$13,$14,'rep_custody',$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
          [mvId, mvId, dateStr, prod.id, prod.name, vanWh.id, vanWh.name, targetWh.id, targetWh.name, baseQty, unitName, factor, prod.purchase_price, stockMap[vanWh.id], opId, opNo, `إرجاع بضاعة غير مباعة من عهدة المندوب ${rep.name}`, actor.id, actor.fullName, actorCtx.actorIdentityId || null, actorCtx.actorEmployeeId || null, actorCtx.actingRole || actor.role || null, now]
        );

        operations.push({
          id: opId,
          operationNumber: opNo,
          date: dateStr,
          representativeId: rep.id,
          representativeName: rep.name,
          operationType: 'returned_to_warehouse',
          productId: prod.id,
          productName: prod.name,
          unit: unitName,
          unitFactor: factor,
          quantity: qty,
          baseQuantity: baseQty,
          warehouseId: targetWh.id,
          warehouseName: targetWh.name,
          notes: item.notes || payload.notes || '',
          status: 'approved',
          createdByUserId: actor.id,
          createdBy: actor.fullName,
          actorIdentityId: actorCtx.actorIdentityId || undefined,
          actorEmployeeId: actorCtx.actorEmployeeId || undefined,
          actingRole: actorCtx.actingRole || actor.role || undefined,
          createdAt: now,
        });
      }

      const payloadOut = { operations };
      await savePgIdempotency(client, scopedIdem, actor, endpoint, payloadOut);
      return { deduplicated: false, ...payloadOut };
    });

    if (!out.deduplicated) {
      await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إرجاع عهدة من المندوب (${rep.name}) إلى المخزن`, module: 'عهدة المنادوبين', recordId: rep.id });
    }
    return out;
  }

  const out = await withJsonTransaction((db) => {
    const dup = findJsonIdempotency(scopedIdem);
    if (dup) return { ...dup, deduplicated: true };

    const vanWh = db.warehouses.find((w) => w.id === rep.warehouseId);
    const targetWh = payload.targetWarehouseId
      ? db.warehouses.find((w) => w.id === payload.targetWarehouseId)
      : db.warehouses.find((w) => w.isDefault) || db.warehouses[0];
    if (!vanWh || !targetWh) throw new AppError(404, 'المستودع غير موجود', 'WAREHOUSE_NOT_FOUND');
    db.repCustodyOperations = db.repCustodyOperations || [];

    const operations = [];
    const actorCtxJson = resolveActorIdentityJsonTx(db, actor);
    for (const item of items) {
      const qty = round3(item.quantity);
      if (!item.productId || qty <= 0) throw new AppError(400, 'الكمية المرتجعة يجب أن تكون أكبر من صفر', 'INVALID_QUANTITY');
      const prod = db.products.find((p) => p.id === item.productId);
      if (!prod) throw new AppError(404, 'الصنف غير موجود', 'PRODUCT_NOT_FOUND');

      const unitName = String(item.unit || prod.baseUnit);
      const unitObj = (prod.units || []).find((u) => u.name === unitName);
      const factor = unitObj ? Number(unitObj.conversionFactor || 1) : 1;
      const baseQty = round3(qty * factor);
      const avail = Number(prod.stockPerWarehouse?.[vanWh.id] || 0);
      if (avail < baseQty) {
        throw new AppError(409, `الرصيد المتاح بعهدة المندوب (${avail}) لا يكفي لإرجاع (${baseQty}) من ${prod.name}`, 'INSUFFICIENT_CUSTODY_STOCK');
      }
      prod.stockPerWarehouse[vanWh.id] = round3(avail - baseQty);
      prod.stockPerWarehouse[targetWh.id] = round3(Number(prod.stockPerWarehouse?.[targetWh.id] || 0) + baseQty);

      const seqNum = nextJsonSequence(db, 'repCustodyOpNo', db.repCustodyOperations, 'operationNumber', /(\d+)$/);
      const opNo = `RCO-${String(seqNum).padStart(5, '0')}`;
      const opObj = {
        id: generateServerId('RCO'),
        operationNumber: opNo,
        date: dateStr,
        representativeId: rep.id,
        representativeName: rep.name,
        operationType: 'returned_to_warehouse',
        productId: prod.id,
        productName: prod.name,
        unit: unitName,
        unitFactor: factor,
        quantity: qty,
        baseQuantity: baseQty,
        warehouseId: targetWh.id,
        warehouseName: targetWh.name,
        notes: item.notes || payload.notes || '',
        status: 'approved',
        createdByUserId: actor.id,
        createdBy: actor.fullName,
        actorIdentityId: actorCtxJson.actorIdentityId,
        actorEmployeeId: actorCtxJson.actorEmployeeId,
        actingRole: actorCtxJson.actingRole,
        createdAt: now,
      };
      db.repCustodyOperations.unshift(opObj);
      operations.push(opObj);

      const mvId = generateServerId('SM');
      db.stockMovements.unshift({
        id: mvId,
        movementNumber: mvId,
        date: dateStr,
        type: 'custody_return',
        productId: prod.id,
        productName: prod.name,
        warehouseId: vanWh.id,
        warehouseName: vanWh.name,
        targetWarehouseId: targetWh.id,
        targetWarehouseName: targetWh.name,
        quantity: baseQty,
        unit: unitName,
        unitFactor: factor,
        unitCost: prod.purchasePrice,
        relatedDocType: 'rep_custody',
        referenceId: opObj.id,
        referenceNumber: opNo,
        notes: `إرجاع بضاعة غير مباعة من عهدة المندوب ${rep.name}`,
        createdByUserId: actor.id,
        createdBy: actor.fullName,
        actorIdentityId: actorCtxJson.actorIdentityId,
        actorEmployeeId: actorCtxJson.actorEmployeeId,
        actingRole: actorCtxJson.actingRole,
        createdAt: now,
      });
    }

    const payloadOut = { operations };
    saveJsonIdempotency(scopedIdem, payloadOut);
    return { deduplicated: false, ...payloadOut };
  });

  if (!out.deduplicated) {
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إرجاع عهدة من المندوب (${rep.name}) إلى المخزن`, module: 'عهدة المنادوبين', recordId: rep.id });
  }
  return out;
}

export async function recordRepCustodyAdjustment(payload, actor, idempotencyKey = '') {
  if (actor.role !== 'admin' && !actor.permissions?.canManageInventory && !actor.permissions?.canApprove && !actor.permissions?.canManageTransfers) {
    throw new AppError(403, 'ليس لديك صلاحية تسجيل تسويات أو توالف عهدة المناديب', 'FORBIDDEN_CUSTODY_ADJUSTMENT');
  }
  const rep = await resolveTargetRepAndVan(payload.representativeId, actor);
  const opType = ['custody_damaged', 'custody_shortage', 'custody_adjustment'].includes(payload.operationType)
    ? payload.operationType
    : 'custody_adjustment';
  const qty = round3(payload.quantity);
  if (!payload.productId || qty <= 0) {
    throw new AppError(400, 'الصنف والكمية (أكبر من صفر) مطلوبان', 'INVALID_QUANTITY');
  }
  const dateStr = payload.date || todayIso();
  const now = nowIso();
  const reason = String(payload.notes || payload.reason || '').trim();
  if (!reason) throw new AppError(400, 'يجب إدخال سبب التسوية أو العجز/التالف', 'REASON_REQUIRED');

  const endpoint = 'POST /api/inventory/rep-custody/adjust';
  const scopedIdem = buildScopedIdemKey(endpoint, actor, idempotencyKey || payload.idempotencyKey);

  let out;
  if (await isPgMode()) {
    out = await withTransaction(async (client) => {
      if (scopedIdem) {
        const dup = await findPgIdempotency(client, scopedIdem);
        if (dup?.operation) return { operation: dup.operation, deduplicated: true };
      }

      const vanWh = (await client.query('SELECT id, name FROM warehouses WHERE id = $1', [rep.warehouseId])).rows[0];
      if (!vanWh) throw new AppError(404, 'مخزن سيارة المندوب غير موجود', 'WAREHOUSE_NOT_FOUND');
      const pRes = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [payload.productId]);
      const prod = pRes.rows[0];
      if (!prod) throw new AppError(404, 'الصنف غير موجود', 'PRODUCT_NOT_FOUND');

      const unitName = String(payload.unit || prod.base_unit);
      const unitObj = (prod.units || []).find((u) => u.name === unitName);
      const factor = unitObj
        ? Math.max(0.001, Number(unitObj.conversionFactor || 1))
        : Math.max(0.001, Number(payload.unitFactor || 1));
      const baseQty = round3(qty * factor);

      const stockMap = { ...(prod.stock_per_warehouse || {}) };
      const avail = Number(stockMap[vanWh.id] || 0);
      if (avail < baseQty) {
        throw new AppError(409, `الرصيد المتاح بعهدة المندوب (${avail}) أقل من الكمية المطلوب تسويتها (${baseQty})`, 'INSUFFICIENT_CUSTODY_STOCK');
      }
      stockMap[vanWh.id] = round3(avail - baseQty);
      await client.query('UPDATE products SET stock_per_warehouse = $1, updated_at = $2 WHERE id = $3', [JSON.stringify(stockMap), now, prod.id]);

      const opId = generateServerId('RCO');
      const seqRes = await client.query(`SELECT nextval('seq_rep_custody_op_no') AS n`);
      const opNo = `RCO-${String(seqRes.rows[0]?.n || 1).padStart(5, '0')}`;
      const actorCtx = await resolveActorIdentityPgTx(client, actor);
      await client.query(
        `INSERT INTO rep_custody_operations (id, operation_number, date, representative_id, representative_name, operation_type, product_id, product_name, unit, unit_factor, quantity, base_quantity, warehouse_id, warehouse_name, notes, status, created_by_user_id, created_by, actor_identity_id, actor_employee_id, acting_role, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'approved',$16,$17,$18,$19,$20,$21)`,
        [opId, opNo, dateStr, rep.id, rep.name, opType, prod.id, prod.name, unitName, factor, qty, baseQty, vanWh.id, vanWh.name, reason, actor.id, actor.fullName, actorCtx.actorIdentityId || null, actorCtx.actorEmployeeId || null, actorCtx.actingRole || actor.role || null, now]
      );

      const mvId = generateServerId('SM');
      await client.query(
        `INSERT INTO stock_movements (id, movement_number, date, product_id, product_name, warehouse_id, warehouse_name, movement_type, quantity, unit, unit_factor, unit_cost, balance_after, related_doc_type, related_doc_id, related_doc_number, notes, created_by_user_id, created_by, actor_identity_id, actor_employee_id, acting_role, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'rep_custody',$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
        [mvId, mvId, dateStr, prod.id, prod.name, vanWh.id, vanWh.name, opType === 'custody_damaged' ? 'damaged' : 'adjustment', baseQty, unitName, factor, prod.purchase_price, stockMap[vanWh.id], opId, opNo, `تسوية عهدة مندوب (${opType}): ${reason}`, actor.id, actor.fullName, actorCtx.actorIdentityId || null, actorCtx.actorEmployeeId || null, actorCtx.actingRole || actor.role || null, now]
      );

      const operation = {
        id: opId,
        operationNumber: opNo,
        date: dateStr,
        representativeId: rep.id,
        representativeName: rep.name,
        operationType: opType,
        productId: prod.id,
        productName: prod.name,
        unit: unitName,
        unitFactor: factor,
        quantity: qty,
        baseQuantity: baseQty,
        warehouseId: vanWh.id,
        warehouseName: vanWh.name,
        notes: reason,
        status: 'approved',
        createdByUserId: actor.id,
        createdBy: actor.fullName,
        actorIdentityId: actorCtx.actorIdentityId || undefined,
        actorEmployeeId: actorCtx.actorEmployeeId || undefined,
        actingRole: actorCtx.actingRole || actor.role || undefined,
        createdAt: now,
      };
      if (scopedIdem) {
        await savePgIdempotency(client, scopedIdem, actor, endpoint, { operation });
      }
      return { operation, deduplicated: false };
    });
  } else {
    out = await withJsonTransaction((db) => {
      if (scopedIdem) {
        const dup = findJsonIdempotency(scopedIdem);
        if (dup?.operation) return { operation: dup.operation, deduplicated: true };
      }

      const vanWh = db.warehouses.find((w) => w.id === rep.warehouseId);
      const prod = db.products.find((p) => p.id === payload.productId);
      if (!vanWh || !prod) throw new AppError(404, 'المستودع أو الصنف غير موجود', 'NOT_FOUND');

      const unitName = String(payload.unit || prod.baseUnit);
      const unitObj = (prod.units || []).find((u) => u.name === unitName);
      const factor = unitObj
        ? Math.max(0.001, Number(unitObj.conversionFactor || 1))
        : Math.max(0.001, Number(payload.unitFactor || 1));
      const baseQty = round3(qty * factor);

      const avail = Number(prod.stockPerWarehouse?.[vanWh.id] || 0);
      if (avail < baseQty) {
        throw new AppError(409, `الرصيد المتاح بعهدة المندوب (${avail}) أقل من الكمية المطلوب تسويتها (${baseQty})`, 'INSUFFICIENT_CUSTODY_STOCK');
      }
      prod.stockPerWarehouse[vanWh.id] = round3(avail - baseQty);
      db.repCustodyOperations = db.repCustodyOperations || [];
      const seqNum = nextJsonSequence(db, 'repCustodyOpNo', db.repCustodyOperations, 'operationNumber', /(\d+)$/);
      const opNo = `RCO-${String(seqNum).padStart(5, '0')}`;
      const actorCtxJson = resolveActorIdentityJsonTx(db, actor);
      const rec = {
        id: generateServerId('RCO'),
        operationNumber: opNo,
        date: dateStr,
        representativeId: rep.id,
        representativeName: rep.name,
        operationType: opType,
        productId: prod.id,
        productName: prod.name,
        unit: unitName,
        unitFactor: factor,
        quantity: qty,
        baseQuantity: baseQty,
        warehouseId: vanWh.id,
        warehouseName: vanWh.name,
        notes: reason,
        status: 'approved',
        createdByUserId: actor.id,
        createdBy: actor.fullName,
        actorIdentityId: actorCtxJson.actorIdentityId,
        actorEmployeeId: actorCtxJson.actorEmployeeId,
        actingRole: actorCtxJson.actingRole,
        createdAt: now,
      };
      db.repCustodyOperations.unshift(rec);
      const mvId = generateServerId('SM');
      db.stockMovements.unshift({
        id: mvId,
        movementNumber: mvId,
        date: dateStr,
        type: opType === 'custody_damaged' ? 'damaged' : 'adjustment',
        productId: prod.id,
        productName: prod.name,
        warehouseId: vanWh.id,
        warehouseName: vanWh.name,
        quantity: baseQty,
        unit: unitName,
        unitFactor: factor,
        unitCost: prod.purchasePrice,
        balanceAfter: prod.stockPerWarehouse[vanWh.id],
        relatedDocType: 'rep_custody',
        referenceId: rec.id,
        referenceNumber: opNo,
        notes: `تسوية عهدة مندوب (${opType}): ${reason}`,
        createdByUserId: actor.id,
        createdBy: actor.fullName,
        actorIdentityId: actorCtxJson.actorIdentityId,
        actorEmployeeId: actorCtxJson.actorEmployeeId,
        actingRole: actorCtxJson.actingRole,
        createdAt: now,
      });
      if (scopedIdem) {
        saveJsonIdempotency(scopedIdem, { operation: rec });
      }
      return { operation: rec, deduplicated: false };
    });
  }

  if (!out.deduplicated) {
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تسوية عهدة المندوب (${rep.name}): ${reason}`, module: 'عهدة المنادوبين', recordId: out.operation.id });
  }
  return out;
}

export async function getRepCustodyStatement(repIdParam, filters = {}, actor) {
  const rep = await resolveTargetRepAndVan(repIdParam, actor);
  const boot = await getStaffBootstrapData(actor);

  const repObj = (boot.representatives || []).find((r) => r.id === rep.id) || rep;
  const vanId = repObj.warehouseId || rep.warehouseId;

  const productMap = new Map((boot.products || []).map((p) => [p.id, p]));
  const itemsAcc = new Map();
  const ensureAcc = (productId, fallbackName = '') => {
    if (!itemsAcc.has(productId)) {
      const p = productMap.get(productId);
      itemsAcc.set(productId, {
        productId,
        productName: p?.name || fallbackName || productId,
        productCode: p?.code || '',
        baseUnit: p?.baseUnit || 'قطعة',
        purchasePrice: Number(p?.purchasePrice || 0),
        sellingPrice: Number(p?.sellingPrice || 0),
        receivedQty: 0,
        pendingReceiveQty: 0,
        deliveredToCustomersQty: 0,
        invoicedSoldQty: 0,
        returnedToWarehouseQty: 0,
        approvedReductionsQty: 0,
        vanPhysicalStockQty: Number(p?.stockPerWarehouse?.[vanId] || 0),
      });
    }
    return itemsAcc.get(productId);
  };

  const custodyTransferDocIds = new Set();
  const ledger = [];

  const resolveUnitFactor = (prod, unitName) => {
    if (!prod || !unitName || unitName === prod.baseUnit) return 1;
    const u = (prod.units || []).find((x) => x.name === unitName);
    return u ? Number(u.conversionFactor || 1) : 1;
  };

  for (const rit of boot.repItemTransfers || []) {
    if (rit.representativeId !== rep.id) continue;
    custodyTransferDocIds.add(rit.id);
    if (rit.status === 'executed' && rit.transferMode === 'custody_dispatch') {
      for (const it of rit.items || []) {
        const prod = productMap.get(it.productId);
        const rawQty = Number(it.executedQty ?? it.approvedQty ?? it.requestedQty ?? 0);
        const qty = round3(rawQty * resolveUnitFactor(prod, it.unit));
        const acc = ensureAcc(it.productId, it.productName);
        acc.pendingReceiveQty = round3(acc.pendingReceiveQty + qty);
      }
    }
    const isReceived = rit.status === 'received' || (rit.status === 'executed' && rit.transferMode !== 'custody_dispatch');
    if (!isReceived) continue;

    for (const it of rit.items || []) {
      const prod = productMap.get(it.productId);
      const rawQty = Number(it.executedQty ?? it.approvedQty ?? it.requestedQty ?? 0);
      const qty = round3(rawQty * resolveUnitFactor(prod, it.unit));
      if (qty <= 0) continue;
      const acc = ensureAcc(it.productId, it.productName);
      acc.receivedQty = round3(acc.receivedQty + qty);
      ledger.push({
        id: `${rit.id}-${it.productId}-${it.unit || ''}`,
        date: rit.date,
        createdAt: rit.receivedAt || rit.executedAt || rit.createdAt,
        docType: rit.transferMode === 'custody_dispatch' ? 'custody_dispatch' : 'rep_item_transfer',
        docNumber: rit.requestNumber,
        productId: it.productId,
        productName: acc.productName,
        quantityIn: qty,
        quantityOut: 0,
        notes: rit.notes || `استلام عهدة من ${rit.sourceWarehouseName || 'المخزن الرئيسي'}`,
      });
    }
  }

  // Also include manual warehouse->van transfer_in movements not already from rep_item_transfers
  for (const sm of boot.stockMovements || []) {
    if (filters.dateFrom && sm.date < filters.dateFrom) continue;
    if (filters.dateTo && sm.date > filters.dateTo) continue;
    if (sm.referenceId && custodyTransferDocIds.has(sm.referenceId)) continue;
    if (sm.type === 'transfer_in' && sm.warehouseId === vanId) {
      const acc = ensureAcc(sm.productId, sm.productName);
      acc.receivedQty = round3(acc.receivedQty + Number(sm.quantity || 0));
      ledger.push({
        id: sm.id,
        date: sm.date,
        createdAt: sm.createdAt,
        docType: 'warehouse_transfer_in',
        docNumber: sm.referenceNumber || sm.id,
        productId: sm.productId,
        productName: acc.productName,
        quantityIn: Number(sm.quantity || 0),
        quantityOut: 0,
        notes: sm.notes || 'تحويل مخزني وارد لسيارة المندوب',
      });
    } else if (sm.type === 'transfer_out' && sm.warehouseId === vanId) {
      const acc = ensureAcc(sm.productId, sm.productName);
      acc.returnedToWarehouseQty = round3(acc.returnedToWarehouseQty + Number(sm.quantity || 0));
      ledger.push({
        id: sm.id,
        date: sm.date,
        createdAt: sm.createdAt,
        docType: 'warehouse_transfer_out',
        docNumber: sm.referenceNumber || sm.id,
        productId: sm.productId,
        productName: acc.productName,
        quantityIn: 0,
        quantityOut: Number(sm.quantity || 0),
        notes: sm.notes || 'تحويل مخزني صادر من سيارة المندوب',
      });
    }
  }

  // Confirmed van sales invoices already deduct & count custody deliveries; exclude any linked duplicate op
  const vanInvoicedIds = new Set(
    (boot.invoices || [])
      .filter((inv) => inv.status === 'confirmed' && inv.type === 'sales' && inv.warehouseId === vanId)
      .map((inv) => inv.id)
  );

  // Rep custody explicit operations
  for (const op of boot.repCustodyOperations || []) {
    if (op.representativeId !== rep.id || op.status !== 'approved') continue;
    if (op.operationType === 'delivered_to_customer' && op.invoiceId && vanInvoicedIds.has(op.invoiceId)) continue;
    if (filters.dateFrom && op.date < filters.dateFrom) continue;
    if (filters.dateTo && op.date > filters.dateTo) continue;
    const acc = ensureAcc(op.productId, op.productName);
    const bQty = Number(op.baseQuantity || op.quantity || 0);
    if (op.operationType === 'delivered_to_customer') {
      acc.deliveredToCustomersQty = round3(acc.deliveredToCustomersQty + bQty);
    } else if (op.operationType === 'returned_to_warehouse') {
      acc.returnedToWarehouseQty = round3(acc.returnedToWarehouseQty + bQty);
    } else if (['custody_damaged', 'custody_shortage', 'custody_adjustment'].includes(op.operationType)) {
      acc.approvedReductionsQty = round3(acc.approvedReductionsQty + bQty);
    }
    ledger.push({
      id: op.id,
      date: op.date,
      createdAt: op.createdAt,
      docType: op.operationType,
      docNumber: op.operationNumber,
      productId: op.productId,
      productName: acc.productName,
      customerName: op.customerName || undefined,
      quantityIn: 0,
      quantityOut: bQty,
      notes: op.notes || op.operationType,
    });
  }

  // Sales invoices & sales returns affecting rep van warehouse
  let totalSalesAmount = 0;
  let totalSalesPaidAmount = 0;
  let totalSalesRemainingAmount = 0;
  for (const inv of boot.invoices || []) {
    if (inv.status !== 'confirmed' || inv.type !== 'sales') continue;
    const belongsToRep = inv.representativeId === rep.id || inv.warehouseId === vanId;
    if (!belongsToRep) continue;
    if (filters.dateFrom && inv.date < filters.dateFrom) continue;
    if (filters.dateTo && inv.date > filters.dateTo) continue;

    totalSalesAmount = round2(totalSalesAmount + Number(inv.grandTotal || 0));
    totalSalesPaidAmount = round2(totalSalesPaidAmount + Number(inv.paidAmount || 0));
    totalSalesRemainingAmount = round2(totalSalesRemainingAmount + Number(inv.remainingAmount || 0));

    if (inv.warehouseId === vanId) {
      for (const it of inv.items || []) {
        const bQty = round3(Number(it.quantity || 0) * Number(it.unitFactor || 1));
        const acc = ensureAcc(it.productId, it.productName);
        acc.invoicedSoldQty = round3(acc.invoicedSoldQty + bQty);
        acc.deliveredToCustomersQty = round3(acc.deliveredToCustomersQty + bQty);
        ledger.push({
          id: `${inv.id}-${it.productId}`,
          date: inv.date,
          createdAt: inv.createdAt,
          docType: 'sales_invoice',
          docNumber: inv.invoiceNumber,
          productId: it.productId,
          productName: acc.productName,
          customerName: inv.customerName || 'نقدي',
          quantityIn: 0,
          quantityOut: bQty,
          notes: `مبيعات فاتورة رقم ${inv.invoiceNumber}`,
        });
      }
    }
  }

  for (const ret of boot.invoiceReturns || []) {
    if (ret.type !== 'sales_return' || ret.warehouseId !== vanId) continue;
    if (filters.dateFrom && ret.date < filters.dateFrom) continue;
    if (filters.dateTo && ret.date > filters.dateTo) continue;
    for (const it of ret.items || []) {
      const bQty = round3(Number(it.quantity || 0) * Number(it.unitFactor || 1));
      const acc = ensureAcc(it.productId, it.productName);
      acc.receivedQty = round3(acc.receivedQty + bQty);
      ledger.push({
        id: `${ret.id}-${it.productId}`,
        date: ret.date,
        createdAt: ret.createdAt,
        docType: 'sales_return',
        docNumber: ret.returnNumber,
        productId: it.productId,
        productName: acc.productName,
        customerName: ret.partyName || '',
        quantityIn: bQty,
        quantityOut: 0,
        notes: `مرتجع مبيعات وارد لسيارة المندوب (${ret.returnNumber})`,
      });
    }
  }

  // Also include products with active stock in van even if zero historical transfers yet
  for (const p of boot.products || []) {
    if (Number(p.stockPerWarehouse?.[vanId] || 0) > 0) {
      ensureAcc(p.id, p.name);
    }
  }

  const itemsSummary = Array.from(itemsAcc.values()).map((it) => {
    const remainingCustodyQty = round3(
      it.receivedQty - it.deliveredToCustomersQty - it.returnedToWarehouseQty - it.approvedReductionsQty
    );
    return {
      ...it,
      remainingCustodyQty,
      custodyValueAtCost: round2(Math.max(0, it.vanPhysicalStockQty) * it.purchasePrice),
    };
  });

  ledger.sort((a, b) => String(b.createdAt || b.date || '').localeCompare(String(a.createdAt || a.date || '')));

  const totals = itemsSummary.reduce(
    (s, it) => ({
      totalReceivedQty: round3(s.totalReceivedQty + it.receivedQty),
      totalPendingReceiveQty: round3(s.totalPendingReceiveQty + it.pendingReceiveQty),
      totalDeliveredQty: round3(s.totalDeliveredQty + it.deliveredToCustomersQty),
      totalReturnedQty: round3(s.totalReturnedQty + it.returnedToWarehouseQty),
      totalReductionsQty: round3(s.totalReductionsQty + it.approvedReductionsQty),
      totalRemainingCustodyQty: round3(s.totalRemainingCustodyQty + it.remainingCustodyQty),
      totalVanPhysicalQty: round3(s.totalVanPhysicalQty + it.vanPhysicalStockQty),
      totalCustodyCostValue: round2(s.totalCustodyCostValue + it.custodyValueAtCost),
    }),
    {
      totalReceivedQty: 0,
      totalPendingReceiveQty: 0,
      totalDeliveredQty: 0,
      totalReturnedQty: 0,
      totalReductionsQty: 0,
      totalRemainingCustodyQty: 0,
      totalVanPhysicalQty: 0,
      totalCustodyCostValue: 0,
    }
  );

  return {
    representative: repObj,
    vanWarehouseId: vanId,
    financialSummary: {
      currentCashCustodyBalance: round2(repObj.currentBalance || 0),
      totalSalesAmount,
      totalSalesPaidAmount,
      totalSalesRemainingAmount,
    },
    totals,
    itemsSummary,
    ledger,
  };
}

// ==============================================================================
// Brand Store Item Movement Report (تقرير حركة الصنف المفصل)
// ==============================================================================

export async function getItemMovementReport(filters = {}, actor) {
  const isRep = actor?.role === 'representative';
  const boot = await getStaffBootstrapData(actor);
  const productIdFilter = filters.productId && filters.productId !== 'all' ? String(filters.productId) : null;
  const warehouseIdFilter = filters.warehouseId && filters.warehouseId !== 'all' ? String(filters.warehouseId) : null;
  const movementTypeFilter = filters.movementType && filters.movementType !== 'all' ? String(filters.movementType) : null;
  const repIdFilter = filters.representativeId && filters.representativeId !== 'all' ? String(filters.representativeId) : null;
  const dateFrom = filters.dateFrom ? String(filters.dateFrom) : null;
  const dateTo = filters.dateTo ? String(filters.dateTo) : null;
  const search = filters.search ? String(filters.search).trim().toLowerCase() : '';

  let allStockMovements = boot.stockMovements || [];
  let allRepCustodyOperations = boot.repCustodyOperations || [];

  const isRepCanPurchase = !isRep || Boolean(actor?.permissions?.canCreatePurchase || actor?.permissions?.canManagePurchases);
  if (await isPgMode()) {
    const pool = getPool();
    const repProfile = isRep ? await getRepresentativeByUserId(actor.id) : null;

    const smClauses = [];
    const smParams = [];
    if (productIdFilter) {
      smParams.push(productIdFilter);
      smClauses.push(`product_id = $${smParams.length}`);
    }
    if (isRep) {
      if (repProfile?.warehouseId) {
        smParams.push(repProfile.warehouseId);
        smClauses.push(`(warehouse_id = $${smParams.length} OR target_warehouse_id = $${smParams.length})`);
      } else {
        smClauses.push(`1 = 0`);
      }
    } else if (warehouseIdFilter) {
      smParams.push(warehouseIdFilter);
      smClauses.push(`(warehouse_id = $${smParams.length} OR target_warehouse_id = $${smParams.length})`);
    }
    if (dateFrom) {
      smParams.push(dateFrom);
      smClauses.push(`date >= $${smParams.length}`);
    }
    if (dateTo) {
      smParams.push(dateTo);
      smClauses.push(`date <= $${smParams.length}`);
    }
    const smWhereSql = smClauses.length > 0 ? `WHERE ${smClauses.join(' AND ')}` : '';
    const smQuery = pool.query(`SELECT * FROM stock_movements ${smWhereSql} ORDER BY created_at DESC`, smParams);

    const opClauses = [];
    const opParams = [];
    if (isRep) {
      if (repProfile?.id) {
        opParams.push(repProfile.id);
        opClauses.push(`representative_id = $${opParams.length}`);
      } else {
        opClauses.push(`1 = 0`);
      }
    } else if (repIdFilter) {
      opParams.push(repIdFilter);
      opClauses.push(`representative_id = $${opParams.length}`);
    }
    if (productIdFilter) {
      opParams.push(productIdFilter);
      opClauses.push(`product_id = $${opParams.length}`);
    }
    if (dateFrom) {
      opParams.push(dateFrom);
      opClauses.push(`date >= $${opParams.length}`);
    }
    if (dateTo) {
      opParams.push(dateTo);
      opClauses.push(`date <= $${opParams.length}`);
    }
    const opWhereSql = opClauses.length > 0 ? `WHERE ${opClauses.join(' AND ')}` : '';
    const opQuery = pool.query(`SELECT * FROM rep_custody_operations ${opWhereSql} ORDER BY created_at DESC`, opParams);

    const [smFullRes, opFullRes] = await Promise.all([smQuery, opQuery]);
    allStockMovements = smFullRes.rows
      .filter((sm) => !isRep || (repProfile?.warehouseId && (sm.warehouse_id === repProfile.warehouseId || sm.target_warehouse_id === repProfile.warehouseId)))
      .map((sm) => ({
        id: sm.id,
        date: isoDateOnly(sm.date),
        type: sm.movement_type,
        productId: sm.product_id,
        productName: sm.product_name,
        warehouseId: sm.warehouse_id,
        warehouseName: sm.warehouse_name,
        targetWarehouseId: sm.target_warehouse_id || undefined,
        targetWarehouseName: sm.target_warehouse_name || undefined,
        quantity: Number(sm.quantity || 0),
        unit: sm.unit || undefined,
        unitFactor: Number(sm.unit_factor || 1),
        unitCost: isRep ? 0 : Number(sm.unit_cost || 0),
        referenceId: sm.related_doc_id || undefined,
        referenceNumber: sm.related_doc_number || undefined,
        notes: sm.notes || '',
        createdBy: sm.created_by,
        createdAt: isoTimestamp(sm.created_at),
      }));

    allRepCustodyOperations = opFullRes.rows.map((op) => ({
      id: op.id,
      operationNumber: op.operation_number,
      date: isoDateOnly(op.date),
      representativeId: op.representative_id,
      representativeName: op.representative_name,
      operationType: op.operation_type,
      productId: op.product_id,
      productName: op.product_name,
      unit: op.unit,
      unitFactor: Number(op.unit_factor || 1),
      quantity: Number(op.quantity || 0),
      baseQuantity: Number(op.base_quantity || 0),
      warehouseId: op.warehouse_id || undefined,
      warehouseName: op.warehouse_name || '',
      customerId: op.customer_id || undefined,
      customerName: op.customer_name || '',
      invoiceId: op.invoice_id || undefined,
      invoiceNumber: op.invoice_number || undefined,
      notes: op.notes || '',
      status: op.status || 'approved',
      createdBy: op.created_by,
      createdAt: isoTimestamp(op.created_at),
    }));
  }

  const productMap = new Map((boot.products || []).map((p) => [p.id, p]));
  const warehouseMap = new Map((boot.warehouses || []).map((w) => [w.id, w]));
  const repMap = new Map((boot.representatives || []).map((r) => [r.id, r]));
  const invoiceMap = new Map((boot.invoices || []).map((i) => [i.id, i]));
  const selectedProduct = productIdFilter ? productMap.get(productIdFilter) || null : null;
  const resolveUnitFactor = (prod, unitName) => {
    if (!prod || !unitName || unitName === prod.baseUnit) return 1;
    const u = (prod.units || []).find((x) => x.name === unitName);
    return u ? Number(u.conversionFactor || 1) : 1;
  };

  const matchesRow = (row) => {
    if (productIdFilter && row.productId !== productIdFilter) return false;
    if (warehouseIdFilter && row.warehouseId !== warehouseIdFilter && row.targetWarehouseId !== warehouseIdFilter) return false;
    if (repIdFilter && row.representativeId !== repIdFilter) return false;
    if (dateFrom && row.date && row.date < dateFrom) return false;
    if (dateTo && row.date && row.date > dateTo) return false;
    if (search) {
      const hay = [
        row.docNumber,
        row.productName,
        row.partyName,
        row.representativeName,
        row.warehouseName,
        row.targetWarehouseName,
        row.notes,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  };

  const sections = {
    sales: [],
    purchases: [],
    sales_returns: [],
    purchase_returns: [],
    transfers: [],
    custody_sent: [],
    custody_received: [],
    custody_deliveries: [],
    adjustments: [],
  };

  let totalSalesQty = 0;
  let totalSalesValue = 0;
  let totalSalesCost = 0;
  let totalPurchaseQty = 0;
  let totalPurchaseValue = 0;
  let totalSalesReturnQty = 0;
  let totalSalesReturnValue = 0;
  let totalSalesReturnCost = 0;
  let totalPurchaseReturnQty = 0;
  let totalPurchaseReturnValue = 0;
  let totalQtyIn = 0;
  let totalQtyOut = 0;

  // 1. Confirmed Sales & Purchases Invoices
  for (const inv of boot.invoices || []) {
    if (inv.status !== 'confirmed') continue;
    if (inv.type !== 'sales' && inv.type !== 'purchase') continue;
    if (isRep && inv.type === 'purchase' && !isRepCanPurchase) continue;

    for (const it of inv.items || []) {
      const prod = productMap.get(it.productId);
      const baseQty = round3(Number(it.quantity || 0) * Number(it.unitFactor || 1));
      const costPerBase = isRep
        ? 0
        : Number(it.purchasePriceAtTime || 0) > 0
        ? Number(it.purchasePriceAtTime)
        : Number(prod?.purchasePrice || 0);
      const lineTotal = round2(it.total || Number(it.unitPrice || 0) * Number(it.quantity || 0));
      const lineCost = isRep ? 0 : round2(costPerBase * baseQty);
      const row = {
        id: `${inv.id}-${it.productId}-${it.unit}`,
        date: inv.date,
        createdAt: inv.createdAt,
        docType: inv.type === 'sales' ? 'sales_invoice' : 'purchase_invoice',
        docId: inv.id,
        docNumber: inv.invoiceNumber,
        productId: it.productId,
        productName: it.productName || prod?.name || '',
        warehouseId: inv.warehouseId,
        warehouseName: inv.warehouseName,
        partyId: inv.type === 'sales' ? inv.customerId : inv.supplierId,
        partyName: inv.type === 'sales' ? (inv.customerName || 'عميل نقدي') : (inv.supplierName || 'مورد نقدي'),
        representativeId: inv.representativeId || undefined,
        representativeName: inv.representativeName || undefined,
        unit: it.unit,
        quantity: Number(it.quantity || 0),
        baseQuantity: baseQty,
        unitPrice: round2(it.unitPrice || 0),
        costPrice: round2(costPerBase),
        totalValue: lineTotal,
        costValue: lineCost,
        profitValue: isRep ? 0 : inv.type === 'sales' ? round2(lineTotal - lineCost) : 0,
        direction: inv.type === 'sales' ? 'out' : 'in',
        notes: inv.notes || '',
        createdBy: inv.createdBy,
      };
      if (!matchesRow(row)) continue;

      if (inv.type === 'sales') {
        sections.sales.push(row);
        totalSalesQty = round3(totalSalesQty + baseQty);
        totalSalesValue = round2(totalSalesValue + lineTotal);
        totalSalesCost = round2(totalSalesCost + lineCost);
        totalQtyOut = round3(totalQtyOut + baseQty);
      } else {
        sections.purchases.push(row);
        totalPurchaseQty = round3(totalPurchaseQty + baseQty);
        totalPurchaseValue = round2(totalPurchaseValue + lineTotal);
        totalQtyIn = round3(totalQtyIn + baseQty);
      }
    }
  }

  // 2. Invoice Returns (Sales Returns & Purchase Returns)
  for (const ret of boot.invoiceReturns || []) {
    const isSalesRet = ret.type === 'sales_return';
    if (isRep && !isSalesRet && !isRepCanPurchase) continue;
    for (const it of ret.items || []) {
      const prod = productMap.get(it.productId);
      const baseQty = round3(Number(it.quantity || 0) * Number(it.unitFactor || 1));
      const costPerBase = isRep ? 0 : Number(prod?.purchasePrice || 0);
      const lineTotal = round2(it.total || Number(it.unitPrice || 0) * Number(it.quantity || 0));
      const lineCost = isRep ? 0 : round2(costPerBase * baseQty);
      const row = {
        id: `${ret.id}-${it.productId}-${it.unit}`,
        date: ret.date,
        createdAt: ret.createdAt,
        docType: ret.type,
        docId: ret.id,
        docNumber: ret.returnNumber,
        productId: it.productId,
        productName: it.productName || prod?.name || '',
        warehouseId: ret.warehouseId,
        warehouseName: ret.warehouseName,
        partyId: ret.partyId,
        partyName: ret.partyName,
        unit: it.unit,
        quantity: Number(it.quantity || 0),
        baseQuantity: baseQty,
        unitPrice: round2(it.unitPrice || 0),
        costPrice: round2(costPerBase),
        totalValue: lineTotal,
        costValue: lineCost,
        profitValue: isRep ? 0 : isSalesRet ? round2(-(lineTotal - lineCost)) : 0,
        direction: isSalesRet ? 'in' : 'out',
        notes: `${ret.reason || ''}${ret.notes ? ` — ${ret.notes}` : ''}`.trim(),
        createdBy: ret.createdBy,
      };
      if (!matchesRow(row)) continue;

      if (isSalesRet) {
        sections.sales_returns.push(row);
        totalSalesReturnQty = round3(totalSalesReturnQty + baseQty);
        totalSalesReturnValue = round2(totalSalesReturnValue + lineTotal);
        totalSalesReturnCost = round2(totalSalesReturnCost + lineCost);
        totalQtyIn = round3(totalQtyIn + baseQty);
      } else {
        sections.purchase_returns.push(row);
        totalPurchaseReturnQty = round3(totalPurchaseReturnQty + baseQty);
        totalPurchaseReturnValue = round2(totalPurchaseReturnValue + lineTotal);
        totalQtyOut = round3(totalQtyOut + baseQty);
      }
    }
  }

  // 3. Custody Dispatches & Receipts (Rep Item Transfers)
  const custodyRefIds = new Set();
  for (const rit of boot.repItemTransfers || []) {
    custodyRefIds.add(rit.id);
    if (rit.status === 'rejected') continue;
    for (const it of rit.items || []) {
      const prod = productMap.get(it.productId);
      const rawQty = Number(it.executedQty ?? it.approvedQty ?? it.requestedQty ?? 0);
      if (rawQty <= 0) continue;
      const factor = resolveUnitFactor(prod, it.unit);
      const baseQty = round3(rawQty * factor);
      const costPerBase = isRep ? 0 : Number(prod?.purchasePrice || 0);
      const val = isRep ? 0 : round2(baseQty * costPerBase);
      if (rit.status === 'executed' || rit.status === 'received') {
        const sentRow = {
          id: `${rit.id}-sent-${it.productId}-${it.unit || ''}`,
          date: rit.date,
          createdAt: rit.dispatchedAt || rit.executedAt || rit.createdAt,
          docType: 'custody_sent',
          docId: rit.id,
          docNumber: rit.requestNumber,
          productId: it.productId,
          productName: it.productName || prod?.name || '',
          warehouseId: rit.sourceWarehouseId,
          warehouseName: rit.sourceWarehouseName,
          targetWarehouseId: rit.targetWarehouseId,
          targetWarehouseName: rit.targetWarehouseName,
          representativeId: rit.representativeId,
          representativeName: rit.representativeName,
          unit: it.unit || prod?.baseUnit || 'قطعة',
          quantity: rawQty,
          baseQuantity: baseQty,
          unitPrice: round2(costPerBase),
          costPrice: round2(costPerBase),
          totalValue: val,
          profitValue: 0,
          direction: 'out',
          notes: rit.notes || `صرف عهدة للمندوب ${rit.representativeName}`,
          createdBy: rit.dispatchedBy || rit.reviewedBy || rit.createdBy,
        };
        if (matchesRow(sentRow)) {
          sections.custody_sent.push(sentRow);
          if (warehouseIdFilter && sentRow.warehouseId === warehouseIdFilter) {
            totalQtyOut = round3(totalQtyOut + baseQty);
          }
        }
      }
      if (rit.status === 'received') {
        const recRow = {
          id: `${rit.id}-rec-${it.productId}-${it.unit || ''}`,
          date: String(rit.receivedAt || rit.date).split('T')[0],
          createdAt: rit.receivedAt || rit.createdAt,
          docType: 'custody_received',
          docId: rit.id,
          docNumber: rit.requestNumber,
          productId: it.productId,
          productName: it.productName || prod?.name || '',
          warehouseId: rit.targetWarehouseId,
          warehouseName: rit.targetWarehouseName,
          targetWarehouseId: rit.sourceWarehouseId,
          targetWarehouseName: rit.sourceWarehouseName,
          representativeId: rit.representativeId,
          representativeName: rit.representativeName,
          unit: it.unit || prod?.baseUnit || 'قطعة',
          quantity: rawQty,
          baseQuantity: baseQty,
          unitPrice: round2(costPerBase),
          costPrice: round2(costPerBase),
          totalValue: val,
          profitValue: 0,
          direction: 'in',
          notes: `تأكيد استلام عهدة المندوب ${rit.representativeName}`,
          createdBy: rit.receivedBy || rit.representativeName,
        };
        if (matchesRow(recRow)) {
          sections.custody_received.push(recRow);
          if (warehouseIdFilter && recRow.warehouseId === warehouseIdFilter) {
            totalQtyIn = round3(totalQtyIn + baseQty);
          }
        }
      }
    }
  }

  // 4. Rep Custody Operations (Deliveries to Customers, Returns to Warehouse, Damaged/Adjustments)
  const custodyOpIds = new Set();
  for (const op of allRepCustodyOperations) {
    custodyOpIds.add(op.id);
    if (op.operationType === 'delivered_to_customer' && op.invoiceId) {
      const linkedInv = invoiceMap.get(op.invoiceId);
      const opRep = repMap.get(op.representativeId);
      if (linkedInv && linkedInv.status === 'confirmed' && linkedInv.type === 'sales' && (linkedInv.warehouseId === opRep?.warehouseId || linkedInv.warehouseId === op.warehouseId)) {
        continue;
      }
    }
    const prod = productMap.get(op.productId);
    const bQty = Number(op.baseQuantity || op.quantity || 0);
    const costPerBase = isRep ? 0 : Number(prod?.purchasePrice || 0);
    const val = isRep ? 0 : round2(bQty * costPerBase);
    const opRep = repMap.get(op.representativeId);
    const repVanWh = opRep?.warehouseId ? warehouseMap.get(opRep.warehouseId) : null;
    const isReturn = op.operationType === 'returned_to_warehouse';
    const row = {
      id: op.id,
      date: op.date,
      createdAt: op.createdAt,
      docType: op.operationType,
      docId: op.id,
      docNumber: op.operationNumber,
      productId: op.productId,
      productName: op.productName || prod?.name || '',
      warehouseId: isReturn ? (repVanWh?.id || op.warehouseId) : op.warehouseId,
      warehouseName: isReturn ? (repVanWh?.name || op.representativeName) : op.warehouseName,
      targetWarehouseId: isReturn ? op.warehouseId : undefined,
      targetWarehouseName: isReturn ? op.warehouseName : undefined,
      partyId: op.customerId,
      partyName: op.customerName || op.representativeName,
      representativeId: op.representativeId,
      representativeName: op.representativeName,
      unit: op.unit || prod?.baseUnit || 'قطعة',
      quantity: Number(op.quantity || 0),
      baseQuantity: bQty,
      unitPrice: round2(costPerBase),
      costPrice: round2(costPerBase),
      totalValue: val,
      profitValue: 0,
      direction: isReturn ? 'in' : 'out',
      notes: op.notes || '',
      createdBy: op.createdBy,
    };
    if (!matchesRow(row)) continue;

    if (op.operationType === 'delivered_to_customer' || op.operationType === 'returned_to_warehouse') {
      sections.custody_deliveries.push(row);
      if (op.operationType === 'delivered_to_customer') {
        totalQtyOut = round3(totalQtyOut + bQty);
      } else if (warehouseIdFilter) {
        if (row.targetWarehouseId === warehouseIdFilter) totalQtyIn = round3(totalQtyIn + bQty);
        if (row.warehouseId === warehouseIdFilter) totalQtyOut = round3(totalQtyOut + bQty);
      }
    } else {
      sections.adjustments.push(row);
      totalQtyOut = round3(totalQtyOut + bQty);
    }
  }

  // 5. Direct Warehouse Transfers, Stock Adjustments / Damaged / Stock Counts & Invoice Edit/Cancel Audit Movements
  const seenTransferPairs = new Set();
  for (const sm of allStockMovements) {
    if (sm.referenceId && (custodyRefIds.has(sm.referenceId) || custodyOpIds.has(sm.referenceId))) continue;
    if (['sale', 'purchase', 'sales_return', 'purchase_return', 'custody_delivery', 'custody_return'].includes(sm.type)) {
      continue;
    }
    const isInvEditOrCancel = ['sale_edit', 'purchase_edit', 'sale_cancel', 'purchase_cancel'].includes(sm.type);
    const prod = productMap.get(sm.productId);
    const bQty = Number(sm.quantity || 0);
    const costPerBase = isRep ? 0 : Number(sm.unitCost || prod?.purchasePrice || 0);
    let direction = sm.type === 'transfer_in' || sm.type === 'opening_balance' ? 'in' : sm.type === 'adjustment' ? 'neutral' : 'out';
    if (isInvEditOrCancel) {
      if (sm.balanceBefore !== undefined && sm.balanceBefore !== null && sm.balanceAfter !== undefined && sm.balanceAfter !== null) {
        direction = Number(sm.balanceAfter) >= Number(sm.balanceBefore) ? 'in' : 'out';
      } else {
        direction = sm.type === 'sale_cancel' ? 'in' : sm.type === 'purchase_cancel' ? 'out' : 'neutral';
      }
    }
    const row = {
      id: sm.id,
      date: sm.date,
      createdAt: sm.createdAt,
      docType: sm.type,
      docId: sm.referenceId || sm.id,
      docNumber: sm.referenceNumber || sm.id,
      productId: sm.productId,
      productName: sm.productName || prod?.name || '',
      warehouseId: sm.warehouseId,
      warehouseName: sm.warehouseName,
      targetWarehouseId: sm.targetWarehouseId,
      targetWarehouseName: sm.targetWarehouseName,
      unit: prod?.baseUnit || 'قطعة',
      quantity: bQty,
      baseQuantity: bQty,
      unitPrice: round2(costPerBase),
      costPrice: round2(costPerBase),
      totalValue: isRep ? 0 : round2(bQty * costPerBase),
      profitValue: 0,
      direction,
      notes: sm.notes || '',
      createdBy: sm.createdBy,
    };
    if (!matchesRow(row)) continue;

    if (sm.type === 'transfer_out' || sm.type === 'transfer_in') {
      if (sm.type === 'transfer_out') {
        const pairKey = `${sm.createdAt}-${sm.productId}-${sm.warehouseId}-${sm.targetWarehouseId}-${bQty}`;
        seenTransferPairs.add(pairKey);
        sections.transfers.push(row);
      } else {
        const reverseKey = `${sm.createdAt}-${sm.productId}-${sm.targetWarehouseId}-${sm.warehouseId}-${bQty}`;
        if (!seenTransferPairs.has(reverseKey)) {
          sections.transfers.push(row);
        }
      }
      if (warehouseIdFilter) {
        if (sm.warehouseId === warehouseIdFilter) {
          if (sm.type === 'transfer_in') totalQtyIn = round3(totalQtyIn + bQty);
          else totalQtyOut = round3(totalQtyOut + bQty);
        }
      }
    } else {
      sections.adjustments.push(row);
      if (sm.type === 'damaged') totalQtyOut = round3(totalQtyOut + bQty);
      else if (sm.type === 'opening_balance') totalQtyIn = round3(totalQtyIn + bQty);
    }
  }

  // Apply movementType filter cleanly if specified
  if (movementTypeFilter && sections[movementTypeFilter]) {
    for (const key of Object.keys(sections)) {
      if (key !== movementTypeFilter) sections[key] = [];
    }
  }

  // Compute Warehouse & Rep Custody Breakdown for selected product(s)
  const targetProducts = selectedProduct ? [selectedProduct] : (boot.products || []).filter((p) => p.status === 'active');
  const vanWarehouseToRep = new Map();
  for (const r of boot.representatives || []) {
    if (r.warehouseId) vanWarehouseToRep.set(r.warehouseId, r);
  }

  const warehouseBreakdown = [];
  const repCustodyBreakdown = [];
  let currentBalance = 0;
  let inventoryValuation = 0;

  for (const wh of boot.warehouses || []) {
    if (warehouseIdFilter && wh.id !== warehouseIdFilter) continue;
    let qtySum = 0;
    let costVal = 0;
    let sellVal = 0;
    for (const p of targetProducts) {
      const q = Number(p.stockPerWarehouse?.[wh.id] || 0);
      qtySum = round3(qtySum + q);
      if (!isRep) {
        costVal = round2(costVal + Math.max(0, q) * Number(p.purchasePrice || 0));
      }
      sellVal = round2(sellVal + Math.max(0, q) * Number(p.sellingPrice || 0));
    }
    currentBalance = round3(currentBalance + qtySum);
    inventoryValuation = isRep ? 0 : round2(inventoryValuation + costVal);
    const linkedRep = vanWarehouseToRep.get(wh.id);
    if (linkedRep) {
      repCustodyBreakdown.push({
        representativeId: linkedRep.id,
        representativeName: linkedRep.name,
        warehouseId: wh.id,
        warehouseName: wh.name,
        quantity: qtySum,
        costValue: isRep ? 0 : costVal,
        sellingValue: sellVal,
      });
    } else {
      warehouseBreakdown.push({
        warehouseId: wh.id,
        warehouseName: wh.name,
        code: wh.code,
        quantity: qtySum,
        costValue: isRep ? 0 : costVal,
        sellingValue: sellVal,
      });
    }
  }

  const netSalesValue = round2(totalSalesValue - totalSalesReturnValue);
  const netCostOfGoodsSold = isRep ? 0 : round2(totalSalesCost - totalSalesReturnCost);
  const totalProfit = isRep ? 0 : round2(netSalesValue - netCostOfGoodsSold);

  return {
    product: selectedProduct,
    filters: {
      productId: productIdFilter || 'all',
      warehouseId: warehouseIdFilter || 'all',
      movementType: movementTypeFilter || 'all',
      representativeId: repIdFilter || 'all',
      dateFrom,
      dateTo,
      search,
    },
    warehouseBreakdown,
    repCustodyBreakdown,
    sections,
    totals: {
      totalSalesQty,
      totalSalesValue,
      totalPurchaseQty: isRep && !isRepCanPurchase ? 0 : totalPurchaseQty,
      totalPurchaseValue: isRep && !isRepCanPurchase ? 0 : totalPurchaseValue,
      totalSalesReturnQty,
      totalSalesReturnValue,
      totalPurchaseReturnQty: isRep && !isRepCanPurchase ? 0 : totalPurchaseReturnQty,
      totalPurchaseReturnValue: isRep && !isRepCanPurchase ? 0 : totalPurchaseReturnValue,
      totalCostOfGoodsSold: netCostOfGoodsSold,
      totalProfit,
      totalQtyIn,
      totalQtyOut,
      currentBalance,
      inventoryValuation: isRep ? 0 : inventoryValuation,
    },
  };
}

