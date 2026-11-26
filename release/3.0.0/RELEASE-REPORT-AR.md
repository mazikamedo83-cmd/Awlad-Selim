# تقرير الجاهزية والإصدار النهائي — AWLAD SELIM v3.0.0

**التطبيق**: `AWLAD SELIM – أولاد سليم للمحاسبة وإدارة الأعمال`
**رقم الإصدار**: `3.0.0` (`versionCode: 3` لـ Android، `com.awladselim.erp`)
**تاريخ التقرير**: 2026-11-24

---

## 1. ملخص حالة المنصات (تصنيف صريح ودقيق)

| المنصة / المكوّن | التصنيف | ما تم تحققه فعليًا | ما ينقص لإنتاج الملف التنفيذي النهائي |
|---|---|---|---|
| **تطبيق الويب + الخادم المركزي (`Node/Express + Vite`)** | **READY** | نجاح `tsc --noEmit`، وبناء `dist/` (`vite build`)، ونجاح 20/20 حزمة اختبار تشمل الأمان، العهدة، المحاسبة، التقارير الـ 23، وحالة `REFRESH` | تشغيل `postgresRealIntegrationTests.mjs` يتم فعليًا عند التشغيل على خادم PostgreSQL 16 أو GitHub Actions CI |
| **سطح المكتب (`Windows x64 — Electron`)** | **BUILD READY** | نجاح توليد الأيقونات (`build/icon.ico`, `build/icon.png`)، نجاح 7/7 في `verifyElectronBootstrap.mjs`، صحة سكربت حزمة العميل `package-windows-customer-zip.mjs`، واكتمال `.github/workflows/windows-build.yml` | إنتاج ملفات `AWLAD-SELIM-Setup-3.0.0.exe` و`AWLAD-SELIM-Portable-3.0.0.exe` يتطلب تشغيل الـ workflow على **Windows Runner (`windows-latest`)** (أدوات `wine` / `makensis` غير مثبتة في حاوية Linux) |
| **تطبيق أندرويد (`Android — Capacitor 8`)** | **BUILD READY** (موقوف لإصدار الثنائيات لغياب SDK والأسرار هنا) | نجاح `cap sync android`، خلو الأصول من أي أسرار أو `assets/aistudio`، ضبط `build.gradle` على `versionCode 3` و`versionName "3.0.0"` ومنع التوقيع بمفتاح Debug نهائيًا، واكتمال `.github/workflows/android-release.yml` | يتطلب بيئة **JDK 21 + Android SDK 36** وإعداد الأسرار الـ 4 في GitHub Secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) لإنتاج `.apk` و`.aab` موقّعين |
| **تطبيق آيفون (`iOS — Capacitor 8`)** | **BLOCKED** (على Linux — يتطلب macOS وXcode) | نجاح `cap copy ios`، ضبط `Info.plist` بالصلاحيات العربية و`awladselim://` وATS المحلي، واكتمال `.github/workflows/mobile-ios.yml` | يتطلب جهاز **macOS / Xcode Runner (`macos-latest`)** وأسرار Apple Developer (`APPLE_TEAM_ID`, `IOS_DIST_CERT_BASE64`, `IOS_DIST_CERT_PASSWORD`, `IOS_PROVISIONING_PROFILE_BASE64`) لتصدير `.ipa` |

---

## 2. التحقق الأمني والنظافة التشغيلية (Release Hygiene)

- **عدم تسريب أي أسرار أو بيانات**:
  - تم التحقق من خلو مجلدات البناء ومخرجات المزامنة (`dist/`, `android/app/src/main/assets/public/`, `ios/App/App/public/`, و`release/3.0.0/`) من `.env`، `.jwt_secret`، `database.json`، `AWLAD_SELIM_BACKUP`، `.jks`، `.keystore`، `.p12`، `.mobileprovision`، و`assets/aistudio/`.
- **سياسة التثبيت لأول مرة**:
  - تثبت الاختبارات (`verifyElectronBootstrap.mjs` #5 و#6) أن التشغيل النظيف يطلب إنشاء المدير الأول للشركة مرة واحدة فقط دون فتح تلقائي لحساب Admin ودون تسريب بيانات أو رموز JWT بين شركات مختلفة (`installationId`).
- **قاعدة بيانات PostgreSQL 16 المركزية**:
  - عند تفعيل `AWLAD_REQUIRE_POSTGRES=true` وتوقف قاعدة البيانات، يرجع السيرفر `503 DATABASE_UNAVAILABLE` دون الرجوع لملفات JSON محلية، بينما يحافظ تطبيق العميل (`StrictClientBehavior`) على الجلسة والعمليات بأمان دون مسح التوكنات.

---

## 3. الملفات المسلّمة داخل `release/3.0.0/`

- `release/3.0.0/RELEASE-REPORT-AR.md` (هذا التقرير)
- `release/3.0.0/TEST-REPORT-AR.md` (تقرير نتائج الاختبارات الـ 20 التفصيلي)
- `release/3.0.0/BUILD-INSTRUCTIONS-AR.md` (أوامر البناء والأسرار المطلوبة لكل منصة)
- `release/3.0.0/SHA256SUMS.txt` (بصمات SHA-256 الحقيقية للأصول والوثائق المولّدة محليًا في هذا الإصدار؛ تُضاف بصمات `.exe` و`.apk` و`.aab` و`.ipa` تلقائيًا في ملخص GitHub Actions عند تشغيل كل workflow على الـ Runner المختص)
