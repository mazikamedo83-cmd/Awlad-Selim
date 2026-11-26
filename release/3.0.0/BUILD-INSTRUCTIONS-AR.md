# تعليمات البناء والتوقيع وإنتاج النسخ النهائية — AWLAD SELIM v3.0.0

يوضح هذا الدليل الخطوات والأوامر الدقيقة لإنتاج حزم التثبيت الرسمية على المنصات الثلاث (**Windows** و**Android** و**iOS**) باستخدام ملفات التشغيل الآلية في `.github/workflows/` أو بيئات التطوير المعتمدة، دون تضمين أي مفاتيح أو أسرار داخل المستودع.

---

## 1. المتطلبات العامة والتحقق المسبق (CI & PostgreSQL 16)

1. التحقق من الكود، و`TypeScript` (`tsc --noEmit`)، وبناء الواجهة (`vite build`)، وجميع ملفات الاختبار (20 حزمة اختبار + اختبار PostgreSQL 16 الفعلي) يتم عبر:
   - ملف التشغيل: `.github/workflows/ci.yml`
   - أوامر الاختبار المحلية الكاملة:
     ```bash
     npm run lint
     npm run build
     node server/tests/runAllTests.mjs
     node server/tests/repPurchaseCustomerRbacTests.mjs
     node server/tests/masterRepairVerificationTests.mjs
     node server/tests/comprehensiveReportsTests.mjs
     node server/tests/auditVerificationTests.mjs
     npx tsx server/tests/pairingVerificationTests.mts
     node server/tests/strictPostgresModeTests.mjs
     npx tsx server/tests/strictClientBehaviorTests.mts
     node server/tests/verifyElectronBootstrap.mjs
     node server/tests/securityCompletionTests.mjs
     npx tsx server/tests/clientSecurityCompletionTests.mts
     node server/tests/fullCompletionSuite.mjs
     node server/tests/finalSecurityAuditTests.mjs
     node server/tests/productionReadinessAuditTests.mjs
     node server/tests/identityAndFiltersTests.mjs
     node server/tests/branchCollectionAndAuditTests.mjs
     node server/tests/storefrontAndLocationTests.mjs
     node server/tests/offlineRefreshAndDispatchTests.mjs
     npx tsx server/tests/diagnosticsTests.mts
     ```
2. تشغيل اختبار قاعدة البيانات المركزية **PostgreSQL 16** الفعلي:
   ```bash
   AWLAD_REQUIRE_POSTGRES=true \
   DATABASE_URL="postgres://postgres:<PASSWORD>@localhost:5432/awlad_selim_ci" \
   JWT_SECRET="<STRONG_JWT_SECRET>" \
   BOOTSTRAP_ADMIN_SECRET="<BOOTSTRAP_SECRET>" \
   node server/tests/postgresRealIntegrationTests.mjs
   ```

---

## 2. بناء نسخة Windows النهائية (Setup EXE + Portable EXE + Customer ZIP)

- **البيئة المطلوبة**: نظام **Windows x64** (`windows-latest` على GitHub Actions أو جهاز Windows مزوّد بـ Node.js 22 / Bun 1.4.4).
- **ملف التشغيل الآلي**: `.github/workflows/windows-build.yml` (أو `.github/workflows/windows-desktop.yml`).
- **الأوامر التنفيذية على Windows**:
  ```powershell
  bun install --frozen-lockfile
  node scripts/generate-win-icon.mjs
  bun run lint
  bun run electron:dist
  node server/tests/verifyElectronBootstrap.mjs
  bun run windows:customer-zip
  node scripts/package-windows-customer-zip.mjs --verify-only --dist-dir=dist-electron --version=3.0.0
  ```
- **المخرجات المتوقعة في `dist-electron/`**:
  - `AWLAD-SELIM-Setup-3.0.0.exe` (NSIS Installer x64 — محفوظ بيانات العميل في `%APPDATA%\AWLAD SELIM\`)
  - `AWLAD-SELIM-Portable-3.0.0.exe` (نسخة محمولة x64)
  - `AWLAD-SELIM-Windows-Customer-3.0.0.zip` (حزمة تسليم العملاء المنظّمة التي تحتوي فقط على `01-Installer/` و`02-Instructions/` و`SHA256SUMS.txt` دون أي أسرار أو بيانات)

---

## 3. بناء نسخة Android الإنتاجية الموقّعة (Signed APK & AAB)

- **البيئة المطلوبة**: JDK 21 + Android SDK (API 36, Build Tools 36.0.0) عبر `.github/workflows/android-release.yml` على `ubuntu-latest`.
- **إنشاء مفتاح الإنتاج RSA 4096-bit لأول مرة (خارج المستودع نهائيًا)**:
  ```bash
  bash scripts/generate-android-release-key.sh
  ```
  > يحفظ السكربت ملف `AWLAD-SELIM-Release.jks` والنسخة الاحتياطية وملف `ANDROID_KEYSTORE_BASE64.txt` في `$HOME/.awlad-selim-keys` خارج مجلد المشروع تمامًا.
- **الأسرار المطلوب إضافتها في GitHub Actions Secrets (`Settings -> Secrets and variables -> Actions`)**:
  1. `ANDROID_KEYSTORE_BASE64` — محتوى ملف `ANDROID_KEYSTORE_BASE64.txt`
  2. `ANDROID_KEYSTORE_PASSWORD` — كلمة مرور الـ Keystore
  3. `ANDROID_KEY_ALIAS` — الاسم المستعار للمفتاح (مثل `AWLAD-SELIM`، ويُرفض `androiddebugkey` تلقائيًا)
  4. `ANDROID_KEY_PASSWORD` — كلمة مرور المفتاح الخاص
- **أوامر البناء بعد توفر الأسرار**:
  ```bash
  bun run build
  npx cap sync android
  cd android
  ./gradlew assembleRelease bundleRelease --no-daemon
  ```
- **المخرجات المتوقعة في `dist-android/`**:
  - `AWLAD-SELIM-3.0.0-Release.apk`
  - `AWLAD-SELIM-3.0.0-Release.aab`
  - يتم التحقق آليًا داخل الـ workflow عبر `apksigner verify` و`aapt2 dump badging` و`jarsigner -verify` من عدم التوقيع بـ `Android Debug` ومن `com.awladselim.erp` و`android:debuggable="false"`.

---

## 4. بناء نسخة iOS الإنتاجية الموقّعة (Xcode Archive & Signed IPA)

- **البيئة المطلوبة**: نظام **macOS** (`macos-latest` على GitHub Actions) مع **Xcode** وأدوات Apple Code Signing.
- **ملف التشغيل الآلي**: `.github/workflows/mobile-ios.yml`.
- **الأسرار المطلوب إضافتها في GitHub Actions Secrets**:
  1. `APPLE_TEAM_ID` — معرّف فريق مطوري Apple
  2. `IOS_DIST_CERT_BASE64` — شهادة التوزيع Apple Distribution (`.p12`) محوّلة إلى Base64
  3. `IOS_DIST_CERT_PASSWORD` — كلمة مرور ملف `.p12`
  4. `IOS_PROVISIONING_PROFILE_BASE64` — ملف `.mobileprovision` محوّل إلى Base64 لـ `com.awladselim.erp`
- **المخرجات المتوقعة في `dist-ios/`**:
  - `AWLAD-SELIM-3.0.0-Release.ipa`

---

## 5. تنبيهات أمنية إلزامية قبل النشر

- يُمنع رفع أي ملف `.env` أو `.jwt_secret` أو `database.json` أو `.jks` أو `.keystore` أو `.p12` أو `.mobileprovision` أو مجلد `AWLAD_SELIM_BACKUP/` إلى المستودع أو تضمينها داخل الحزم النهائية.
- لتشغيل السيرفر المركزي بالإنتاج مع PostgreSQL 16، اضبط `AWLAD_REQUIRE_POSTGRES=true` و`DATABASE_URL` و`JWT_SECRET` قوي من `.env.example`.
