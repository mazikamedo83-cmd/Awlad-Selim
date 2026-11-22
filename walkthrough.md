# AWLAD SELIM — Final Security, Database & Production Readiness Walkthrough

# Security Summary

This document summarizes the completed security, database atomicity, session isolation, RBAC, and release-verification hardening implemented on the **AWLAD SELIM – أولاد سليم للمحاسبة وإدارة الأعمال** codebase.

## 1. Dependencies & Lockfile Integrity (`bun.lock`)
- **Root Cause**: `package.json` listed `@fontsource/cairo` without an updated lockfile entry, causing `--frozen-lockfile` CI installations to fail.
- **Fix**: Synchronized `bun.lock` cleanly using Bun `1.4.4` without removing used dependencies or altering runtime library versions. Verified zero runtime dependency vulnerabilities (`bun audit` reports only 1 transitive moderate advisory inside dev/build tooling `electron-builder` and `@capacitor/cli`).

## 2. Native, Desktop & Web Secure Token Storage (`Fail-Closed`)
- **Files**: `electron/vaultCrypto.cjs`, `electron/main.cjs`, `android/app/src/main/java/com/awladselim/erp/SecureVaultPlugin.java`, `ios/App/App/SecureVaultPlugin.swift`, `src/services/native.ts`, `src/services/secureVault.ts`, `src/services/api.ts`, `src/services/accountVault.ts`, `src/context/AuthContext.tsx`
- **Root Cause & Fix**:
  - **Electron / Windows**: Eliminated all plaintext fallback `.vault.key` generation and fail-open recovery. `safeStorage.isEncryptionAvailable()` is strictly required; corrupt `.vault.key.enc` is preserved untouched, legacy `.vault.key` plaintext key migration performs verified `decryptString` read-back before removing `.vault.key`, and any vault failure surfaces a clear Arabic error (`SecureVaultError`) rather than degrading security.
  - **Android & iOS**: `SecureVaultPlugin.java` uses Android Keystore AES/GCM hardware/OS-backed encryption with synchronous `.commit()` persistence and explicit error propagation (zero plaintext SharedPreferences keys). `SecureVaultPlugin.swift` uses Apple Keychain with explicit `OSStatus` error propagation (zero `UserDefaults` storage).
  - **Web**: Tokens are never written to `localStorage`, `IndexedDB`, or Capacitor `Preferences`. Sessions use server-issued `HttpOnly`, `SameSite=Lax` (and `Secure` over HTTPS) cookies plus `credentials: 'include'` and CSRF origin/header verification (`X-Requested-With: awlad-selim-spa`). Account metadata saved in `accountVault.ts` contains zero tokens on Web, prompting cleanly for password re-entry when switching accounts.
  - **Legacy Migration Safety**: `saveStoredTokensAsync()` invokes `purgeLegacyPlaintextTokens()` strictly after verified `sealJson` + `unsealJson` read-back succeeds.

## 3. Atomic First-Admin Bootstrap & Registration Concurrency
- **Files**: `server/db/schema.sql`, `server/db/postgres.js`, `server/db/stores/authStore.js`, `server/routes/auth.js`
- **Root Cause & Fix**:
  - Replaced in-process-only checks with a PostgreSQL singleton lock table (`system_bootstrap_lock`) plus transaction-scoped advisory locks (`acquirePgTxAdvisoryLock`) inside a single serializable transaction in `bootstrapAdmin` and username/phone advisory locks in `registerMobileAccount`.
  - Added constant-time server-side validation for `BOOTSTRAP_ADMIN_SECRET` (`BOOTSTRAP_FORBIDDEN`, generic rejection message, never logged or returned to clients).
  - Added JSON-Ledger singleton file-lock parity and composite PostgreSQL indexes (`idx_invoices_date_type`, `idx_invoices_rep_date`, `idx_stock_movements_prod_date`).

## 4. CORS, HTTPS Enforcement, Trusted Proxies, Cookies & Rate Limiting
- **Files**: `server/app.js`, `server/middleware/auth.js`, `server/routes/auth.js`, `server/routes/admin.js`
- **Root Cause & Fix**:
  - `TRUST_PROXY` defaults strictly to `false` so spoofed `X-Forwarded-For` / `X-Forwarded-Proto` / `X-Forwarded-Host` headers are ignored unless `TRUST_PROXY=true` or a hop count is explicitly configured.
  - `ALLOWED_ORIGINS` is strictly enforced in `production`; Cloudflare Quick Tunnels (`ALLOW_CLOUDFLARE_QUICK_TUNNEL=true`) and LAN HTTP (`ALLOW_MOBILE_LAN_HTTP=true`) are explicit opt-ins rather than automatic bypasses.
  - Added security response headers (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Strict-Transport-Security` on HTTPS) and blocked plain/proxied non-HTTPS production traffic (`403 HTTPS_REQUIRED`) outside local desktop/LAN modes.
  - Added cookie auth (`awlad_access_token`, `awlad_refresh_token`) with rotation on `/api/auth/refresh`, clearance on `/api/auth/logout`, CSRF verification on cookie mutations, and dedicated IP rate limiters on `/api/auth/register`, `/api/auth/bootstrap-admin`, and `/api/auth/refresh`.

## 5. Multi-Account Chooser & Cross-Account Cache Isolation
- **Files**: `src/context/AuthContext.tsx`, `src/context/DataContext.tsx`, `src/components/modules/auth/AccountSwitcherModal.tsx`, `src/components/modules/auth/LoginView.tsx`
- **Root Cause & Fix**:
  - `DataContext` clears cached entity state, customer statements, media cache, notifications, sync queues, and conflict state immediately when `currentUser.id` changes, before asynchronous IndexedDB hydration runs.
  - `AuthContext` shows the account chooser cleanly when multiple accounts exist on device, avoids spurious expiry banners for anonymous Web sessions, blocks login/registration if secure token storage fails, and surfaces server-revocation warnings in the UI when offline logout/removal occurs.

## 6. Orders Delivery State Machine, Sub-Idempotency & Reports RBAC
- **Files**: `server/db/stores/ordersStore.js`, `server/routes/reports.js`, `server/db/stores/reportsStore.js`, `src/components/modules/reports/ReportsView.tsx`, `src/components/modules/reports/ItemLifecycleAndPnlPanel.tsx`
- **Root Cause & Fix**:
  - Enforced `DELIVERY_ALLOWED_SOURCE_STATUSES` on `updateOrderDeliveryStatus` (`409 INVALID_ORDER_TRANSITION` from `pending`/unapproved orders) and distinct `${idempotencyKey}-invpay` sub-keys across invoiced payment creation.
  - Removed inventory-only and unpermitted rep bypasses on `/api/reports/*` (requires `admin` or `canViewReports === true`).
  - Redacted employee salary/advance rows and employee filter lists unless `admin || canManageSalaries || canManageEmployees`.
  - Fixed `ReferenceError: repProfile is not defined` inside `getComprehensiveReport`, restricted representative `warehouses` & `representatives` filters, masked company-wide `drawerBalance`/`reportProfit`/`costValue`/`suppliers` for rep viewers, and replaced any visible `COGS` labels with Arabic financial terminology.

## 7. CI/CD Pipeline Hardening
- **File**: `.github/workflows/ci.yml`
- **Fix**: Fixed PostgreSQL pool usage (`getPool().query`), `AWLAD_REQUIRE_POSTGRES: 'true'`, `bootstrapSecret`, and `adminUser.role`, and integrated both `securityCompletionTests.mjs` and `clientSecurityCompletionTests.mts` plus real PostgreSQL 16 dual-connection concurrency verification into CI.

---

## PoC Verification

All verification checks below were executed on the final codebase state (`Bun 1.4.4`, `Node v22.23.2`):

| Check / Suite | Command | Result | Coverage |
|---|---|---|---|
| Frozen Lockfile Install | `bun install --frozen-lockfile` | PASS (0 warnings, 656 packages) | Clean lockfile parity with `@fontsource/cairo` and native/desktop dependencies |
| TypeScript Type Check | `bun run lint` (`tsc --noEmit`) | PASS (0 errors) | Strict client/server TypeScript verification |
| Production Bundle Build | `bun run build` (`vite build`) | PASS | Production SPA asset bundle in `dist/` |
| Master Backend & E2E Suite | `node server/tests/runAllTests.mjs` | PASS | Core accounting, inventory, RBAC, PostgreSQL (`pg-mem`), JSON Ledger, hardened Test 37 proxy/CORS assertions |
| Security Completion Backend | `node server/tests/securityCompletionTests.mjs` | PASS (10/10 groups) | `BOOTSTRAP_ADMIN_SECRET` constant-time checks, concurrent bootstrap/register locks, CORS/HTTPS enforcement, cookie auth/CSRF & refresh rotation, order transitions & idempotency, reports RBAC & salary redaction, rate limits & `TRUST_PROXY=false` |
| Client & Vault Completion | `npx tsx server/tests/clientSecurityCompletionTests.mts` | PASS (6/6 groups) | Electron fail-closed `safeStorage` & `.vault.key` migration, Web zero-token persistence + cookie headers, `SecureVaultError` behavior, multi-account switcher isolation, Arabic terminology (`COGS` removed) |
| Rep / Purchase / Customer RBAC | `node server/tests/repPurchaseCustomerRbacTests.mjs` | PASS | Representative & customer permission isolation |
| Master Repair Suite | `node server/tests/masterRepairVerificationTests.mjs` | PASS | End-to-end accounting & inventory consistency |
| Comprehensive Reports Suite | `node server/tests/comprehensiveReportsTests.mjs` | PASS | All 23 report tabs, date ranges, and calculations |
| Audit Verification Suite | `node server/tests/auditVerificationTests.mjs` | PASS | Audit logs, journal traceability, security invariants |
| Device Pairing Suite | `npx tsx server/tests/pairingVerificationTests.mts` | PASS | LAN/Tunnel/Domain discovery, pairing claims, App Links |
| Strict Postgres Mode Suite | `node server/tests/strictPostgresModeTests.mjs` | PASS | Production strict-mode fail-closed DB guarantees |
| Strict Client Behavior Suite | `npx tsx server/tests/strictClientBehaviorTests.mts` | PASS | Offline-cache strict server-sync protection |
| Electron Bootstrap Check | `node server/tests/verifyElectronBootstrap.mjs` | PASS | Desktop process/vault boot behavior |
| Static UI/Asset Audit | `! grep -rn "COGS" src/ && ! grep -rn "/assets/aistudio" dist/` | PASS (0 matches) | Confirms Arabic UI labels and clean `dist/` |

### Environment Boundaries
- Real **PostgreSQL 16** dual-connection concurrency assertions, **Android APK**, **iOS Xcode**, and **Windows NSIS** packaging checks run in the `.github/workflows/ci.yml` CI runners (no local Postgres daemon, Android SDK, Xcode, or Windows NSIS toolchain is installed in this Linux workspace).
