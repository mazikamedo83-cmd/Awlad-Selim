# Security Summary

**Reviewed Files**: 36  
**Issues Resolved**: 15

### Issues Resolved
| Area | File | Line | What Was Happening | Impact | Status | How It Was Fixed |
|---|---|---|---|---|---|---|
| Rep Cashbox & Treasury Access | `server/routes/admin.js` | 308 | A representative account granted staff flags (`canManageAccounts` or `canManageCashboxes`) could reach admin treasury routes such as expenses, cashboxes, supplier payments, cheques, and installments. | High | Fixed | Added `blockRepFromAdminTreasury(req, res)` across all treasury, cashbox, supplier payment, cheque, and installment admin endpoints, returning HTTP `403` (`FORBIDDEN_REP_CASHBOX_OP`). |
| Defense-in-Depth Treasury Guards & PG Sync Parity | `server/db/stores/inventoryAdminStore.js` | 3145 | Store-level treasury operations relied only on route guards without verifying actor role directly, and PostgreSQL `updateRepresentative` omitted `opening_balance`/`current_balance` updates. | High | Fixed | Enforced explicit `representative`/`customer` role denial (`FORBIDDEN_REP_CASHBOX_OP`) inside treasury, cheque, installment, and cashbox store functions, and updated PostgreSQL `updateRepresentative` to persist balances consistently. |
| Strict ID-Only Rep Invoice Ownership & Same-Name Collision | `server/utils/errors.js`, `server/db/stores/reportsStore.js`, `server/db/stores/catalogStore.js`, `server/db/stores/inventoryAdminStore.js`, `src/components/modules/mobile/RepPortal.tsx`, `src/components/modules/mobile/RefreshSyncScreen.tsx`, `src/components/modules/sales/NewSaleInvoiceModal.tsx`, `src/components/modules/representatives/RepTransferView.tsx` | 120 | Ownership checks in statements, reports, bootstrap, and UI fell back to `fullName` / `rep.name`, creating cross-rep invoice/return/payment exposure whenever two representatives shared the same Arabic name or legacy unattributed records existed. | High | Fixed | Centralized `isRepOwnerOfInvoice(inv, actor, repProfile)` in `server/utils/errors.js` matching only immutable IDs (`representativeId`, `createdByUserId`, `sentByUserId`, or unattributed self-ID), removed all `actor.fullName` fallbacks across `reportsStore.js`, `catalogStore.js`, and `inventoryAdminStore.js`, and eliminated `fullName` fallback matching for `representative` accounts in `RepPortal.tsx`, `RefreshSyncScreen.tsx`, `NewSaleInvoiceModal.tsx`, and `RepTransferView.tsx`. |
| Customer & Supplier Statement Strict Scoping + Later External Collection Attribution | `server/db/stores/catalogStore.js`, `server/db/stores/inventoryAdminStore.js`, `src/types/index.ts`, `src/components/modules/mobile/RepPortal.tsx` | 2195 | Representatives viewing customer or supplier statements could see operation summaries/payments outside their scope, purchase cashbox metadata leaked when `sanitizeInvoiceForRepresentative` skipped `type === 'purchase'`, and later collections by another user on a rep's invoice were either conflated or hidden. | High | Fixed | Scoped statement invoices, orders, returns, and direct payments to rep-owned records while keeping company-wide `customer.currentBalance` (flagged with `scope.accountBalanceScope = 'company_wide'`), annotated later collections/disbursements made by other users (`تحصيل لاحق بواسطة مستخدم آخر` / `سداد لاحق بواسطة مستخدم آخر`) without double-counting `paidAmount`, exposed `createdBy` on statement entries, and explicitly stripped `cashboxId`/`cashboxName` on purchase invoices, payments, and returns for representatives. |
| Quote Conversion, Draft Confirmation, Return & Sync Attribution Spoofing | `server/db/stores/invoicesStore.js`, `server/routes/sync.js` | 1940 | `convertQuoteToInvoice` and `confirmDraftInvoice` lacked cross-rep ownership checks for non-owner reps, `createInvoiceReturn` could trust client-supplied `partyId`/`partyName`/`representativeId`/`cashboxId`, and `/api/sync/push` payloads could pass spoofed `createdBy`/`sentBy` fields. | High | Fixed | Enforced strict ownership checks (`403`) on `convertQuoteToInvoice` and `confirmDraftInvoice`, bound `createInvoiceReturn` party/rep/cashbox attributes from the server original invoice and authenticated actor in both JSON and PostgreSQL modes, and stripped client `createdBy`/`createdByUserId`/`sentBy`/`sentByUserId` inside `/api/sync/push` before executing handlers. |
| Non-Destructive Legacy Unattributed Diagnostics | `server/db/stores/invoicesStore.js`, `server/routes/admin.js`, `server/db/postgres.js` | 5420 | Legacy unattributed rows without `createdByUserId`/`representativeId` needed admin visibility without auto-assigning ambiguous duplicate names or deleting any data. | Medium | Fixed | Added non-destructive `getLegacyOwnershipDiagnostics()` exposed at `GET /api/admin/diagnostics/legacy-ownership` (admin-only; `403` for reps/customers) and ensured PostgreSQL startup backfill only links `created_by` when `full_name` is strictly unique. |
| Cancel Invoice PG Sanitization Parity | `server/db/stores/invoicesStore.js` | 3572 | In PostgreSQL mode, `cancelInvoice` returned the raw invoice object including `purchasePriceAtTime` to representatives instead of passing it through `sanitizeInvoiceForRepresentative`. | Medium | Fixed | Applied `sanitizeInvoiceForRepresentative` to the PostgreSQL return path of `cancelInvoice`, matching JSON Ledger behavior. |
| Mobile Notifications PG Schema Mismatch | `server/db/stores/inventoryAdminStore.js` | 217 | `getStaffBootstrapData` queried `created_by_user_id` on `purchase_return_requests`, causing HTTP `500` on `GET /api/mobile/notifications` in PostgreSQL mode when checking rep purchase return requests. | High | Fixed | Corrected the SQL column reference to `requested_by_user_id` and aligned JSON mode to check both `requestedByUserId` and `createdByUserId` plus `representativeId` on transfers. |
| Report & Source Document Cost Exposure | `server/db/stores/reportsStore.js` | 2994 | `getSourceDocumentForReport` and representative report loaders could return purchase invoices, return documents, `purchasePriceAtTime`, `unitCost`, `auditTrail`, or `balanceAfter` to representatives. | High | Fixed | Filtered out purchase invoices and purchase returns for representatives across JSON and PostgreSQL report loaders, returned `null` for purchase source documents, applied `sanitizeProductForRepresentative` and `sanitizeInvoiceForRepresentative`, and stripped `balanceAfter`, `auditTrail`, `unitCost`, and `totalLoss`. |
| SQL Paginated Report Totals & Labels | `server/db/stores/reportsStore.js`, `src/components/modules/reports/ReportsView.tsx` | 1775 | SQL-paginated `comprehensive` reports computed section totals over only the current page, left admin `reportProfit` at `0`, mismatched `'أصناف بيع'` vs `'أصناف البيع'`, and `ReportsView.tsx` PDF export omitted columns 16–19. | Medium | Fixed | Pushed full-dataset SQL aggregates and admin profit totals into `tryGetSqlPaginatedReportPg`, added deterministic `ORDER BY ... id DESC` tiebreakers, unified `'أصناف البيع'`, aligned 19/16 PDF export columns, and localized header `'ID'` to `'كود السجل'`. |
| Customer Price History Query, Index & Cancelled Invoice Filtering | `server/db/stores/catalogStore.js`, `server/db/schema.sql`, `server/db/postgres.js` | 1019 | Customer last-3-prices lookup lacked a composite customer/type/status/date index, needed cancelled/draft invoice exclusion in legacy fallback, and needed `cleanProdId` filtering in legacy fallback. | Medium | Fixed | Added composite index `idx_invoices_cust_type_status_date`, implemented `ROW_NUMBER()` confirmed-sales SQL query in PostgreSQL with clean runtime fallback, normalized tiebreakers, respected `productId` filter, and excluded non-confirmed/non-sales invoice numbers in legacy fallback. |
| Parameterized `IN (...)` Parity Across PostgreSQL & `pg-mem` | `server/utils/errors.js`, `server/db/stores/catalogStore.js`, `server/db/stores/inventoryAdminStore.js`, `server/db/stores/ordersStore.js`, `server/db/stores/invoicesStore.js`, `server/db/stores/reportsStore.js` | 137 | Indexed FK `= ANY($1::varchar[])` array queries dropped child rows (`invoice_items`, `invoice_payments`, `invoice_return_items`, order sub-tables) under `pg-mem`. | Medium | Fixed | Replaced all `= ANY($n::varchar[])` array predicates across stores with parameterized `buildPgInPredicate(columnSql, values, params)` generating standard `IN ($1, $2, ...)` clauses, achieving identical results on PostgreSQL 16 and `pg-mem`. |
| Offline Summary Return & Collection Accuracy | `src/components/modules/mobile/RepPortal.tsx` | 766 | Offline rep summary keyed returns only by `productId` (ignoring unit variants) and counted non-collection cash inflows as customer collections. | Medium | Fixed | Keyed return quantities by `` `${productId}::${unit}` `` first and restricted offline collections strictly to `تحصيل من عميل` / `customer_payment`. |
| Development Dependency Advisory | `package.json`, `bun.lock` | 75 | `bun audit` reported 1 moderate transitive ReDoS advisory in `minimatch >=7.0.0 <11.0.1` inside dev tooling (`app-builder-lib` / `@electron/universal`). | Low | Fixed | Added scoped `overrides` (`app-builder-lib>minimatch` and `@electron/universal>minimatch` pinned to `^11.0.9`) and updated `bun.lock` with Bun `1.4.4`; verified `bun audit` reports 0 vulnerabilities and `bun install --frozen-lockfile` succeeds. |

### Safeguards Verified
| Area | File | How It's Protected |
|---|---|---|
| Role & Cashbox Balance Isolation | `server/utils/errors.js` | `sanitizeCashboxForViewer` strips `openingBalance`, `currentBalance`, and `accountNumber` for representatives and sets `balanceHidden: true`, while frontend components safely render a masked label instead of balances. |
| Customer Scope for Representatives | `server/routes/core.js`, `server/db/stores/catalogStore.js` | Representatives retain operational access to all customers and company-wide customer balances while customer statement invoice lines strip purchase cost and cashbox details and show only rep-owned invoices. |
| Cross-Rep Data Protection | `server/routes/admin.js`, `server/routes/sync.js`, `server/db/stores/inventoryAdminStore.js` | Non-admin representatives receive only their own profile across `/api/admin/bootstrap`, `/api/sync/pull`, and rep listings; purchase return requests, invoices, payments, quotes, and supplier statements verify immutable `userId`/`representativeId` without any `fullName` fallback. |
| Sync Conflict & Payload Isolation | `server/routes/sync.js`, `server/utils/errors.js` | Sales/accounts flags (`canManageSales`, `canManageAccounts`) alone do not allow reading or resolving other users' sync conflicts; `sanitizeSyncPayload` strips credentials, cashbox balances, and cost/profit keys; `/api/sync/push` strips spoofed creator fields. |
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
| 3 | Response terminates with HTTP `403` and `{ ok: false, code: 'FORBIDDEN_REP_CASHBOX_OP' }`; any direct call to `addExpenseOrIncome` also throws `AppError(403, ..., 'FORBIDDEN_REP_CASHBOX_OP')`. | **Handled Safely (Blocked)** |

#### Conclusion
**Fix Verified** - Verified in `finalSecurityAuditTests.mjs` Group 4 and `repPurchaseCustomerRbacTests.mjs` (JSON & PostgreSQL). Representatives cannot inspect cashbox balances or execute administrative treasury, expense, supplier payment, cheque, or installment operations regardless of granular permission flags.

---

### 2. Duplicate-Name Representatives, Legacy Records & Statement Attribution Isolation

#### Summary
| Field | Value |
|---|---|
| Issue Type | Horizontal Privilege & Ownership Collision via `fullName` Matching |
| Impact | High |
| Affected File | `server/utils/errors.js:120`, `server/db/stores/catalogStore.js`, `server/db/stores/inventoryAdminStore.js`, `server/db/stores/reportsStore.js`, `server/routes/admin.js` |
| Test Scenario | Two representatives (`repA`, `repB`) share identical `fullName`; unattributed legacy invoices (`createdBy: "أحمد محمود"`) exist; Admin records a subsequent collection on `repA`'s invoice. `repA` and `repB` query `/api/invoices`, payments, confirms, `/api/customers/:id/statement`, `/api/admin/suppliers/:id/statement`, and `/api/admin/diagnostics/legacy-ownership`. |

#### How It Was Fixed
- Replaced all `fullName` fallback checks in `isRepOwnerOfInvoice`, `reportsStore.js`, `catalogStore.js`, `inventoryAdminStore.js`, and React components with immutable ID verification.
- Left legacy unattributed rows unaccessible to duplicate-name reps and exposed non-destructive admin inspection via `GET /api/admin/diagnostics/legacy-ownership`.
- Scoped customer and supplier statements to rep-owned documents and payments while preserving company-wide `customer.currentBalance` and annotating later external collections/disbursements without exposing purchase cashboxes.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | `repA` and `repB` (both `fullName: "أحمد محمود"`) query `GET /api/invoices`, attempt payment on legacy unattributed invoices, and attempt confirming each other's drafts. | Only ID-matched owner invoices appear; cross-rep & legacy mutations return `403`. |
| 2 | `repA` requests `GET /api/admin/diagnostics/legacy-ownership`. | Rejected with `403`; Admin receives non-destructive read-only counts (`200`). |
| 3 | `repA` queries `GET /api/customers/:id/statement` after Admin creates another invoice and collects a payment on `repA`'s invoice and a standalone customer payment. | Statement includes only `repA`'s invoices/returns/collections, keeps company-wide `customer.currentBalance`, and marks external collection note while hiding cashboxes. |

#### Conclusion
**Fix Verified** - Verified in `finalSecurityAuditTests.mjs` Groups 14 and 17 across both JSON Ledger and PostgreSQL (`pg-mem`) modes.

---

### 3. Quote Conversion, Return Creation & Sync Payload Attribution Spoofing

#### Summary
| Field | Value |
|---|---|
| Issue Type | Broken Object-Level Authorization & Server-Derived Attribution Bypass |
| Impact | High |
| Affected File | `server/db/stores/invoicesStore.js`, `server/routes/sync.js` |
| Test Scenario | `repA` converts `repB`'s quote (`POST /api/invoices/quotes/:id/convert`) or passes spoofed `representativeId`/`cashboxId`/`partyId` in quotes, returns, or `POST /api/sync/push` (`createdBy`, `createdByUserId`, `sentBy`). |

#### How It Was Fixed
Added strict quote/draft ownership verification (`403` for non-owning reps), bound return `partyId`/`partyName`/`representativeId`/`cashboxId` from the authoritative original invoice and server actor, and stripped client `createdBy`/`createdByUserId`/`sentBy`/`sentByUserId` inside `/api/sync/push` prior to store execution.

#### Conclusion
**Fix Verified** - Verified in `finalSecurityAuditTests.mjs` Group 17 (JSON & PostgreSQL): cross-rep quote conversion returns `403`, quote/return/sync spoofing overrides never alter stored attribution or expose foreign cashboxes, and confirmed customer price history excludes cancelled/draft invoices.

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

---

### 5. Local Automated Verification Summary
All 14 suites in `.github/workflows/ci.yml` passed locally after final edits (PostgreSQL suites executed via `pg-mem`, while live PostgreSQL 16 verification is defined in `.github/workflows/ci.yml`):
- `node server/tests/runAllTests.mjs` — PASS
- `node server/tests/repPurchaseCustomerRbacTests.mjs` — PASS
- `node server/tests/masterRepairVerificationTests.mjs` — PASS
- `node server/tests/comprehensiveReportsTests.mjs` — PASS
- `node server/tests/auditVerificationTests.mjs` — PASS
- `npx tsx server/tests/pairingVerificationTests.mts` — PASS
- `node server/tests/strictPostgresModeTests.mjs` — PASS
- `npx tsx server/tests/strictClientBehaviorTests.mts` — PASS
- `node server/tests/verifyElectronBootstrap.mjs` — PASS
- `node server/tests/securityCompletionTests.mjs` — PASS
- `npx tsx server/tests/clientSecurityCompletionTests.mts` — PASS
- `node server/tests/fullCompletionSuite.mjs` — PASS
- `node server/tests/finalSecurityAuditTests.mjs` — PASS (33 assertion groups across JSON & `pg-mem`, including Group 17)
- `npx tsx server/tests/diagnosticsTests.mts` — PASS (3 / 3)
- `bun install --frozen-lockfile` & `bun audit` — PASS (0 vulnerabilities across 570 audited packages)
