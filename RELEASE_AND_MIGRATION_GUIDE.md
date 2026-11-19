# دليل الإصدار الإنتاجي النهائي والترحيل الآمن — AWLAD SELIM v3.0.0

يغطي هذا الدليل مساري الإنتاج المتوازيين (Windows Setup Production + Android Production APK & AAB) مع ضمان حفظ بيانات الشركات الحالية وأمن تسجيل الدخول واستمرار حسابات المستخدمين على السيرفر المركزي.

---

## 1. توقيع Android Production بمفتاح جديد مستقل تماماً

- **الهوية المنطقية المحفوظة**:
  - `applicationId`: `com.awladselim.erp`
  - `versionCode`: `3`
  - `versionName`: `3.0.0`
- **منع مفتاح Debug والمفاتيح القديمة**:
  - تم حظر `debug.keystore` و`androiddebugkey` برمجياً داخل `android/app/build.gradle` وفي `.github/workflows/android-release.yml`.
  - تم ضبط `android:debuggable="false"` و`android:allowBackup="false"` في الإصدار الإنتاجي لمنع استعادة أي جلسات أو رموز مصادقة قديمة عبر Google Auto Backup.

### خطوات إنشاء وحفظ مفتاح الإنتاج الجديد الثابت:
1. نفّذ أحد الأمرين التاليين (خارج مجلد المستودع تماماً في `~/.awlad-selim-keys` أو `%USERPROFILE%\.awlad-selim-keys`):
   - **Windows PowerShell**:
     ```powershell
     powershell -ExecutionPolicy Bypass -File scripts\generate-android-release-key.ps1 -Rotate
     ```
   - **macOS / Linux**:
     ```bash
     bash scripts/generate-android-release-key.sh --rotate
     ```
   *(استخدام `--rotate` / `-Rotate` يؤرشف أي مفتاح قديم في مجلد `backups/` ويهيئ مفتاح RSA 4096-bit جديداً مستقلاً، ثم يظل هذا المفتاح ثابتاً لجميع التحديثات المستقبلية).*
2. احتفظ بنسخة آمنة خارجية من:
   - `AWLAD-SELIM-Release.jks` ونسخته في `backups/`
   - ملف `GITHUB_SECRETS_REFERENCE.txt`
   *(تحذير: لا ترفع أي ملف `.jks` أو `keystore.properties` أو `ANDROID_KEYSTORE_BASE64.txt` إلى Git).*
3. سجّل الأسرار الأربعة في **GitHub Repository -> Settings -> Secrets and variables -> Actions**:
   - `ANDROID_KEYSTORE_BASE64`
   - `ANDROID_KEYSTORE_PASSWORD`
   - `ANDROID_KEY_ALIAS` (القيمة: `AWLAD-SELIM`)
   - `ANDROID_KEY_PASSWORD`

---

## 2. المخرجات الإنتاجية الرسمية

### أ. مسار Android Production (`.github/workflows/android-release.yml`)
- يبني الواجهة ويُزامن أصول Capacitor (`npx cap sync android`) ويصدر:
  - `AWLAD-SELIM-3.0.0-Release.apk`
  - `AWLAD-SELIM-3.0.0-Release.aab`
- يتحقق تلقائياً عبر `apksigner` و`jarsigner` و`aapt2` من التوقيع غير التجريبي وهوية الحزمة `com.awladselim.erp` وخلو الملفات من أي أسرار أو قواعد بيانات.

### ب. مسار Windows Setup Production + ZIP منظم للعملاء (`.github/workflows/windows-build.yml`)
- ينفذ الفحوصات ويصدر:
  - `AWLAD-SELIM-Setup-3.0.0.exe` (المثبت الرسمي)
  - `AWLAD-SELIM-Portable-3.0.0.exe` (نسخة محمولة منفصلة خارج حزمة ZIP الافتراضية للعميل)
  - `AWLAD-SELIM-Windows-Customer-3.0.0.zip` (الحزمة المنظمة للتسليم للعملاء عبر `npm run windows:customer-zip`، وتحتوي `01-Installer/AWLAD-SELIM-Setup-3.0.0.exe` و`02-Instructions/` و`SHA256SUMS.txt` فقط، بدون نسخة Portable إلا عند الطلب الصريح وبدون أي `.env` أو `database.json` أو `sessions.json`).

---

## 3. خطوات انتقال العميل من النسخة القديمة إلى Android Production الجديد دون فقدان بيانات

بما أن النسخة الإنتاجية الجديدة موقعة بمفتاح جديد مستقل، لن يسمح Android بالتثبيت فوق النسخة القديمة مباشرة:

1. **قبل حذف النسخة القديمة (في التطبيق القديم)**:
   - افتح **مركز المزامنة (Sync Center)** وتأكد أن بطاقة حالة الجاهزية للترقية تعرض **0 عمليات معلقة / متعارضة**.
   - إذا كانت هناك فواتير أو دفعات غير متزامنة (مثل عمل المندوب أو العميل بدون إنترنت)، اضغط **مزامنة الكل الآن** عند توفر السيرفر، أو اضغط **تصدير المعلق** لحفظ نسخة JSON آمنة تحتوي العمليات غير المتزامنة ومعرف التثبيت (`installationId`).
2. **حذف النسخة القديمة وتثبيت النسخة الجديدة**:
   - قم بإلغاء تثبيت (Uninstall) التطبيق القديم يدوياً من الهاتف.
   - ثبّت `AWLAD-SELIM-3.0.0-Release.apk` الموقّع بالمفتاح الجديد.
3. **الربط وتسجيل الدخول بالحساب القديم**:
   - افتح التطبيق واربطه بنفس السيرفر المركزي (الشبكة المحلية أو رابط الدعوة / QR أو الدومين الثابت أو Cloud VPS).
   - ستظهر شاشة تسجيل الدخول **ولن يفتح التطبيق أي حساب Admin تلقائياً**.
   - أدخل **نفس اسم المستخدم وكلمة المرور السابقة** (مدير / مندوب / عميل / موظف) — لا تنشئ حساباً جديداً.
   - يستعيد التطبيق من السيرفر المركزي جميع الصلاحيات والأصناف والعملاء وكشف الحساب والفواتير السابقة فوراً.
4. **استعادة أي عمليات معلقة (إن وجدت)**:
   - إذا كنت قد صدّرت ملف عمليات معلقة في الخطوة 1، افتح **مركز المزامنة** واختر **استيراد نسخة معلقة** ثم يتم دفعها تلقائياً للسيرفر المركزي عبر `operationId` المتفرد دون أي تكرار.

---

## 4. تثبيت وتشغيل Windows للعملاء الجدد والحاليين

- **عميل جديد على جهاز نظيف**:
  - يفك ضغط `AWLAD-SELIM-Windows-Customer-3.0.0.zip` ويشغّل `01-Installer/AWLAD-SELIM-Setup-3.0.0.exe`.
  - يفتح البرنامج على شاشة تسجيل الدخول فقط بدون أي حساب أو بيانات افتراضية تخص صاحب المشروع.
  - إذا لم يكن هناك مدير أول للشركة بعد، يظهر خيار **إعداد حساب المدير الأول للشركة** ويُسجَّل على السيرفر مع إغلاق التسجيل الأول فور وجود مدير للشركة.
- **عميل حالي / تحديث على نفس الجهاز**:
  - تحفظ قاعدة البيانات داخل `%APPDATA%\AWLAD SELIM\data` ولا يتم مسحها عند الترقية، مع فرض شاشة تسجيل الدخول والتحقق الفعلي من السيرفر عند التشغيل.
