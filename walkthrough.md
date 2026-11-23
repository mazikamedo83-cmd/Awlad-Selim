# Security Summary

**Reviewed Files**: 31
**Issues Resolved**: 10

### Issues Resolved
| Area | File | Line | What Was Happening | Impact | Status | How It Was Fixed |
|---|---|---|---|---|---|---|
| Rep Cashbox & Treasury Access | `server/routes/admin.js` | 308 | A representative account granted staff flags (`canManageAccounts` or `canManageCashboxes`) could reach admin treasury routes such as expenses, cashboxes, supplier payments, cheques, and installments. | High | Fixed | Added `blockRepFromAdminTreasury(req, res)` across all treasury, cashbox, supplier payment, cheque, and installment admin endpoints, returning HTTP `403` (`FORBIDDEN_REP_CASHBOX_OP`). |
| Defense-in-Depth Treasury Guards & PG Sync Parity | `server/db/stores/inventoryAdminStore.js` | 3145 | Store-level treasury operations relied only on route guards without verifying actor role directly, and PostgreSQL `updateRepresentative` omitted `opening_balance`/`current_balance` updates. | High | Fixed | Enforced explicit `representative`/`customer` role denial (`FORBIDDEN_REP_CASHBOX_OP`) inside treasury, cheque, installment, and cashbox store functions, and updated PostgreSQL `updateRepresentative` to persist balances consistently. |
| Customer Statement & Same-Name Rep Collision | `server/db/stores/catalogStore.js`, `server/db/stores/inventoryAdminStore.js`, `server/routes/customers.js` | 3578 | `getCustomerStatementData` did not filter or sanitize returned invoice items/cashbox fields for representatives, and `getSupplierStatementData` matched `inv.createdBy === actor.fullName` unconditionally, risking cross-rep leakage when two reps shared a name. | High | Fixed | Scoped `getCustomerStatementData` invoices to representative-owned records while preserving company-wide customer balance reconciliation, zeroed `purchasePriceAtTime`, stripped `cashboxId`/`cashboxName`, and guarded `fullName` fallback with empty-ID checks in `getSupplierStatementData` and `RepPortal.tsx`. |
| Cancel Invoice PG Sanitization Parity | `server/db/stores/invoicesStore.js` | 3572 | In PostgreSQL mode, `cancelInvoice` returned the raw invoice object including `purchasePriceAtTime` to representatives instead of passing it through `sanitizeInvoiceForRepresentative`. | Medium | Fixed | Applied `sanitizeInvoiceForRepresentative` to the PostgreSQL return path of `cancelInvoice`, matching JSON Ledger behavior. |
| Mobile Notifications PG Schema Mismatch | `server/db/stores/inventoryAdminStore.js` | 217 | `getStaffBootstrapData` queried `created_by_user_id` on `purchase_return_requests`, causing HTTP `500` on `GET /api/mobile/notifications` in PostgreSQL mode when checking rep purchase return requests. | High | Fixed | Corrected the SQL column reference to `requested_by_user_id` and aligned JSON mode to check both `requestedByUserId` and `createdByUserId` plus `representativeId` on transfers. |
| Report & Source Document Cost Exposure | `server/db/stores/reportsStore.js` | 2994 | `getSourceDocumentForReport` and representative report loaders could return purchase invoices, return documents, `purchasePriceAtTime`, `unitCost`, `auditTrail`, or `balanceAfter` to representatives. | High | Fixed | Filtered out purchase invoices and purchase returns for representatives across JSON and PostgreSQL report loaders, returned `null` for purchase source documents, applied `sanitizeProductForRepresentative` and `sanitizeInvoiceForRepresentative`, and stripped `balanceAfter`, `auditTrail`, `unitCost`, and `totalLoss`. |
| SQL Paginated Report Totals & Labels | `server/db/stores/reportsStore.js`, `src/components/modules/reports/ReportsView.tsx` | 1775 | SQL-paginated `comprehensive` reports computed section totals over only the current page, left admin `reportProfit` at `0`, mismatched `'أصناف بيع'` vs `'أصناف البيع'`, and `ReportsView.tsx` PDF export omitted columns 16–19. | Medium | Fixed | Pushed full-dataset SQL aggregates and admin profit totals into `tryGetSqlPaginatedReportPg`, added deterministic `ORDER BY ... id DESC` tiebreakers, unified `'أصناف البيع'`, aligned 19/16 PDF export columns, and localized header `'ID'` to `'كود السجل'`. |
| Customer Price History Query & Index | `server/db/stores/catalogStore.js`, `server/db/schema.sql`, `server/db/postgres.js` | 1019 | Customer last-3-prices lookup lacked a composite customer/type/status/date index and window-function pushdown on PostgreSQL. | Medium | Fixed | Added composite index `idx_invoices_cust_type_status_date`, implemented `ROW_NUMBER() OVER (PARTITION BY it.product_id ORDER BY i.date DESC, i.created_at DESC, i.id DESC, it.id DESC)` on PostgreSQL with clean runtime fallback for in-memory tests, and normalized JSON sort tiebreakers. |
| Offline Summary Return & Collection Accuracy | `src/components/modules/mobile/RepPortal.tsx` | 766 | Offline rep summary keyed returns only by `productId` (ignoring unit variants) and counted non-collection cash inflows as customer collections. | Medium | Fixed | Keyed return quantities by `` `${productId}::${unit}` `` first and restricted offline collections strictly to `تحصيل من عميل` / `customer_payment`. |
| Development Dependency Advisory | `package.json`, `bun.lock` | 75 | `bun audit` reported 1 moderate transitive ReDoS advisory in `minimatch >=7.0.0 <11.0.1` inside dev tooling (`app-builder-lib` / `@electron/universal`). | Low | Fixed | Added scoped `overrides` (`app-builder-lib>minimatch` and `@electron/universal>minimatch` pinned to `^11.0.9`) and updated `bun.lock` with Bun `1.4.4`; verified `bun audit` reports 0 vulnerabilities and `bun install --frozen-lockfile` succeeds. |

### Safeguards Verified
| Area | File | How It's Protected |
|---|---|---|
| Role & Cashbox Balance Isolation | `server/utils/errors.js` | `sanitizeCashboxForViewer` strips `openingBalance`, `currentBalance`, and `accountNumber` for representatives and sets `balanceHidden: true`, while frontend components safely render a masked label instead of balances. |
| Customer Scope for Representatives | `server/routes/core.js`, `server/db/stores/catalogStore.js` | Representatives retain operational access to all customers and company-wide customer balances while customer statement invoice lines strip purchase cost and cashbox details and show only rep-owned invoices. |
| Cross-Rep Data Protection | `server/routes/admin.js`, `server/routes/sync.js`, `server/db/stores/inventoryAdminStore.js` | Non-admin representatives receive only their own profile across `/api/admin/bootstrap`, `/api/sync/pull`, and rep listings; purchase return requests and supplier statements verify immutable `userId`/`representativeId` before any legacy name match. |
| Sync Conflict Isolation | `server/routes/sync.js`, `server/utils/errors.js` | Sales/accounts flags (`canManageSales`, `canManageAccounts`) alone do not allow reading or resolving other users' sync conflicts; `sanitizeSyncPayload` strips credentials, cashbox balances, and cost/profit keys. |
| Advisory Lock & Concurrency | `server/db/postgres.js` | `acquirePgTxAdvisoryLock` only bypasses `pg_advisory_xact_lock` when running against the test in-memory engine and never swallows genuine PostgreSQL, SQLSTATE, or connection errors; concurrent `bootstrapAdmin` calls permit strictly one winner. |
| Phone Indexing & Lookup Queries | `server/db/postgres.js`, `server/db/stores/authStore.js` | Customer and rep lookups execute targeted parameterized SQL on `normalized_phone` backed by partial unique index `idx_users_role_norm_phone_unique` rather than full-table scans. |
| Cross-Customer Isolation | `server/routes/core.js`, `server/routes/orders.js` | Customer accounts cannot read other customers' records, orders, invoices, sync pulls, or staff/admin endpoints across both JSON and PostgreSQL modes. |
| Native & Web Storage Security | `src/services/native.ts`, `electron/main.cjs` | Web keeps auth tokens out of `localStorage`/IndexedDB and relies on HttpOnly cookies + CSRF headers; Electron encrypts offline credentials via OS `safeStorage` and enforces `contextIsolation: true`. |

---

## PoC Verification

### 1. Representative Accessing Admin Cashbox & Expense Endpoints

#### Summary
| Field | Value |
|---|---|
| Issue Type | Missing Role Enforcement on Admin Treasury Endpoints |
| Impact | High |
| Affected File | `server/routes/admin.js:308`, `server/db/stores/inventoryAdminStore.js:3844` |
| Test Scenario | Authenticated `representative` user (even with `canManageCashboxes: true` and `canManageAccounts: true`) sends `POST /api/admin/expenses` or `POST /api/admin/cashboxes` |

#### How It Was Fixed
Added an explicit role blocker `blockRepFromAdminTreasury(req, res)` on every admin treasury route and mirrored the same role guard inside `inventoryAdminStore.js` store functions so neither route calls nor internal callers can run cashbox/expense mutations as a representative or customer.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | `POST /api/admin/expenses` authenticates the caller via JWT and verifies permission middleware. | Request enters `server/routes/admin.js:359` |
| 2 | Handler immediately invokes `blockRepFromAdminTreasury(req, res)` at `server/routes/admin.js:360`. | Role `representative` detected at line `310` |
| 3 | Response terminates with HTTP `403` and `{ ok: false, code: 'FORBIDDEN_REP_CASHBOX_OP' }`; any direct call to `addExpenseOrIncome` also throws `AppError(403, ..., 'FORBIDDEN_REP_CASHBOX_OP')` at `inventoryAdminStore.js:3844`. | **Handled Safely (Blocked)** |

#### Conclusion
**Fix Verified** - Verified in `finalSecurityAuditTests.mjs` Group 4 and `repPurchaseCustomerRbacTests.mjs` (JSON & PostgreSQL). Representatives cannot inspect cashbox balances or execute administrative treasury, expense, supplier payment, cheque, or installment operations regardless of granular permission flags.

---

### 2. Representative Inspecting Purchase Cost, Cashbox & Foreign Invoices via Reports, Statements, or Cancel Response

#### Summary
| Field | Value |
|---|---|
| Issue Type | Sensitive Field Redaction & Scoped Ownership Enforcement |
| Impact | High |
| Affected File | `server/db/stores/reportsStore.js:2994`, `server/db/stores/catalogStore.js`, `server/db/stores/inventoryAdminStore.js:3578`, `server/db/stores/invoicesStore.js:3572` |
| Test Scenario | Representative calls `GET /api/reports/source-document?docType=purchase_invoice`, `GET /api/customers/:id/statement`, `GET /api/admin/suppliers/:id/statement` (with another rep sharing `fullName`), or `POST /api/invoices/:id/cancel` |

#### How It Was Fixed
- Filtered out purchase invoices and purchase returns from general rep reports and `getSourceDocumentForReport` while returning HTTP `404`/`403`.
- Scoped `getCustomerStatementData` invoices to representative-owned invoices, zeroed `purchasePriceAtTime`, and stripped `cashboxId`/`cashboxName` while keeping company-wide customer balance reconciliation accurate.
- Guarded `getSupplierStatementData` and `RepPortal.tsx` purchase ownership checks so `fullName` fallback only applies on legacy rows lacking `createdByUserId`, `sentByUserId`, and `representativeId`.
- Applied `sanitizeInvoiceForRepresentative` on PostgreSQL `cancelInvoice` return values matching JSON Ledger behavior.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Rep B (sharing `fullName` with Rep A) requests `GET /api/admin/suppliers/:id/statement`. | `isRepOwnInvoice` checks `createdByUserId`/`sentByUserId`/`representativeId` first |
| 2 | Rep 1 calls `GET /api/customers/:id/statement` on a customer with both Rep 1 and Admin invoices. | Response retains company-wide `customer.currentBalance` while filtering `invoices` to Rep 1's own and zeroing `purchasePriceAtTime` and cashbox fields |
| 3 | Rep 1 cancels own draft invoice via `POST /api/invoices/:id/cancel` with `canDelete: true`. | PostgreSQL and JSON paths both sanitize `purchasePriceAtTime === 0` (`finalSecurityAuditTests.mjs` Groups 14 & 16) |

#### Conclusion
**Fix Verified** - Purchase pricing, item cost (`purchasePriceAtTime`), profit margins, peer-rep purchase invoices, and cashbox details cannot leak to representative accounts through reports, statements, notifications, or invoice mutations.

---

### 3. Representative Attempting to Enumerate Peer Representatives or Sync Conflicts

#### Summary
| Field | Value |
|---|---|
| Issue Type | Cross-User Data Exposure via Bootstrap & Sync Endpoints |
| Impact | High |
| Affected File | `server/routes/sync.js`, `server/routes/admin.js`, `server/utils/errors.js:206` |
| Test Scenario | Authenticated `representative` requests `GET /api/sync/pull`, `GET /api/admin/bootstrap`, or `GET /api/sync/conflicts` |

#### How It Was Fixed
Restricted sync conflict management (`canManageSyncConflictsGlobally`) away from `representative`/`customer` and away from `canManageSales`/`canManageAccounts` users, filtered peer representative lists down to the caller's own record, and sanitized conflict `localPayload`/`serverSnapshot` via `sanitizeSyncPayload`.

#### Conclusion
**Fix Verified** - Verified in `finalSecurityAuditTests.mjs` Groups 5 & 6 (JSON & PostgreSQL). Representatives only receive their own profile and own sync context while administrators retain full visibility.

---

### 4. Cross-Customer IDOR & Privilege Escalation Attempts

#### Summary
| Field | Value |
|---|---|
| Issue Type | Horizontal & Vertical Access Control Violation |
| Impact | High |
| Affected File | `server/routes/core.js`, `server/routes/orders.js`, `server/routes/customers.js` |
| Test Scenario | Authenticated `customer` A requests `/api/customers/<customer_B_id>`, `/api/orders/<customer_B_order_id>`, `/api/invoices`, `/api/sync/pull`, or `/api/reports/comprehensive` |

#### How It Was Fixed
Enforced strict `actor.role === 'customer'` ownership scoping on customer records, orders, statements, and invoices, and explicitly blocked customer accounts from staff/rep sync, admin bootstrap, and comprehensive report routes across both JSON and PostgreSQL stores.

#### Conclusion
**Fix Verified** - Verified in `finalSecurityAuditTests.mjs` Group 9 across both JSON Ledger and PostgreSQL modes.
