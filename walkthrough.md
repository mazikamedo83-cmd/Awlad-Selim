# Security Summary

**Reviewed Files**: 22
**Issues Resolved**: 4

### Issues Resolved
| Area | File | Line | What Was Happening | Impact | Status | How It Was Fixed |
|---|---|---|---|---|---|---|
| Rep Cashbox & Treasury Access | `server/routes/admin.js` | 308 | A representative account granted staff flags (`canManageAccounts` or `canManageCashboxes`) could reach admin treasury routes such as expenses, cashboxes, supplier payments, cheques, and installments. | High | Fixed | Added `blockRepFromAdminTreasury(req, res)` across all treasury, cashbox, supplier payment, cheque, and installment admin endpoints, returning HTTP `403` (`FORBIDDEN_REP_CASHBOX_OP`). |
| Defense-in-Depth Treasury Guards & PG Sync Parity | `server/db/stores/inventoryAdminStore.js` | 3145 | Store-level treasury operations relied only on route guards without verifying actor role directly, and PostgreSQL `updateRepresentative` omitted `opening_balance`/`current_balance` updates. | High | Fixed | Enforced explicit `representative`/`customer` role denial (`FORBIDDEN_REP_CASHBOX_OP`) inside treasury, cheque, installment, and cashbox store functions, and updated PostgreSQL `updateRepresentative` (line 4138) to persist balances consistently. |
| Report & Source Document Cost Exposure | `server/db/stores/reportsStore.js` | 2994 | `getSourceDocumentForReport` and representative report loaders could return purchase invoices, return documents, `purchasePriceAtTime`, `unitCost`, `auditTrail`, or `balanceAfter` to representatives. | High | Fixed | Filtered out purchase invoices and purchase returns for representatives across JSON and PostgreSQL report queries, applied `sanitizeProductForRepresentative` and `sanitizeInvoiceForRepresentative`, and stripped `balanceAfter`, `auditTrail`, `unitCost`, and `totalLoss` from representative outputs. |
| Development Dependency Advisory | `package.json` | — | `bun audit` reported 1 moderate transitive ReDoS advisory in `minimatch` inside dev tooling (`electron-builder` / `@capacitor/cli`); 0 advisories in production server/client runtime dependencies. | Low | Needs Follow-Up | Keep production bundle free of dev build dependencies (verified in `dist/`), and update dev tooling (`electron-builder` / `@capacitor/cli`) in a scheduled maintenance upgrade. |

### Safeguards Verified
| Area | File | How It's Protected |
|---|---|---|
| Role & Cashbox Balance Isolation | `server/utils/errors.js` | `sanitizeCashboxForViewer` strips `openingBalance`, `currentBalance`, and `accountNumber` for representatives and sets `balanceHidden: true`, while frontend components safely render a masked label instead of balances. |
| Customer Scope for Representatives | `server/routes/core.js` | Representatives retain unrestricted access to all customers across listing, search, invoices, and collections without artificial customer-assignment filters. |
| Cross-Rep Data Protection | `server/routes/admin.js`, `server/routes/sync.js` | Non-admin representatives receive only their own profile across `/api/admin/bootstrap`, `/api/sync/pull`, and rep listings; sensitive fields of other reps (balances, commissions, phones, vehicle numbers, notes) are omitted. |
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
**Fix Verified** - Representatives cannot inspect cashbox balances or execute administrative treasury, expense, supplier payment, cheque, or installment operations regardless of granular permission flags.

---

### 2. Representative Inspecting Purchase Cost & Balance Data via Reports

#### Summary
| Field | Value |
|---|---|
| Issue Type | Insufficient Sensitive Field Redaction in Reporting & Source Documents |
| Impact | High |
| Affected File | `server/db/stores/reportsStore.js:2994` |
| Test Scenario | Authenticated `representative` requests `GET /api/reports/source-document?docType=purchase_invoice&docId=<id>` or `GET /api/reports/comprehensive?productId=<id>` |

#### How It Was Fixed
Filtered out purchase invoices and purchase returns for representatives in both JSON and PostgreSQL `loadFullReportDataset` loaders, returned `null` (404/denied) in `getSourceDocumentForReport` for purchase documents, applied `sanitizeProductForRepresentative` and `sanitizeInvoiceForRepresentative`, and stripped `unitCost`, `totalLoss`, `balanceAfter`, `profit`, and `auditTrail`.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Representative calls `/api/reports/source-document` or `/api/reports/comprehensive?productId=...`. | Request enters `reportsStore.js` with `isRep = true` |
| 2 | `loadFullReportDataset` (`reportsStore.js:426,449,806`) sanitizes products and strips purchase records; `getSourceDocumentForReport` checks `if (!inv || (isRep && inv.type === 'purchase')) return null;` at `reportsStore.js:2994`. | Purchase documents & cost fields dropped |
| 3 | `getSourceDocumentForReport` destructures away `balanceAfter` (`reportsStore.js:3127`), zeroes `unitCost`/`totalLoss` (`reportsStore.js:3079-3080,3164`), and returns empty `auditTrail` (`[]`). | **Handled Safely (Redacted/Denied)** |

#### Conclusion
**Fix Verified** - Purchase pricing, item cost (`purchasePriceAtTime`), profit margins, and cashbox `balanceAfter` cannot leak to representative accounts through reports or drill-down source documents.

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

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Non-admin representative invokes `GET /api/sync/pull` or `GET /api/sync/conflicts`. | Enters sync handler with caller identity |
| 2 | Conflict and rep mappers check `canManageSyncConflictsGlobally(user)` (`errors.js:206`) and `canViewAllRepresentatives(user)` (`errors.js:201`). | Peer rep records & other users' conflicts filtered out |
| 3 | Remaining payloads pass through `sanitizeSyncPayload` (`errors.js:259`), removing secrets, `cashboxBalance`, `balanceAfter`, and cost/profit keys. | **Handled Safely (Scoped & Sanitized)** |

#### Conclusion
**Fix Verified** - Representatives only receive their own profile and own sync context while administrators and authorized staff retain full visibility.

---

### 4. Cross-Customer IDOR & Privilege Escalation Attempts

#### Summary
| Field | Value |
|---|---|
| Issue Type | Horizontal & Vertical Access Control Violation |
| Impact | High |
| Affected File | `server/routes/core.js`, `server/routes/orders.js` |
| Test Scenario | Authenticated `customer` A requests `/api/customers/<customer_B_id>`, `/api/orders/<customer_B_order_id>`, `/api/invoices`, `/api/sync/pull`, or `/api/reports/comprehensive` |

#### How It Was Fixed
Enforced strict `actor.role === 'customer'` ownership scoping on customer records, orders, and invoices, and explicitly blocked customer accounts from staff/rep sync, admin bootstrap, and comprehensive report routes across both JSON and PostgreSQL stores.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Customer A sends `GET` with Customer B's ID or staff endpoint path. | Enters route middleware with Customer A session |
| 2 | Ownership and role checks compare target `customerId` / `userId` against Customer A's bound customer ID and deny staff-only routes. | Mismatch detected on server |
| 3 | Server responds with HTTP `403` / `404` without exposing Customer B's data or staff ledgers. | **Handled Safely (Isolated)** |

#### Conclusion
**Fix Verified** - Verified in both JSON Ledger and PostgreSQL (`finalSecurityAuditTests.mjs` Group 9) that customers are strictly isolated to their own account data.
