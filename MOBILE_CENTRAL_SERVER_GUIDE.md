# دليل تشغيل السيرفر المركزي على لابتوب المحل وربط تطبيق Android و iOS
**نظام أولاد سليم المتكامل — AWLAD SELIM Enterprise 3.0**

---

## 1. البنية المعتمدة للمنظومة
- **لابتوب المحل هو السيرفر المركزي الرئيسي (Central Server)** وقاعدة البيانات الوحيدة للنظام (يدعم السجلات المحلية المؤمنة JSON Ledger أو PostgreSQL).
- **برنامج سطح المكتب (Windows Electron)** يظل يعمل كإدارة كاملة دون أي تغيير على وظائفه أو بياناته.
- **تطبيق الموبايل الواحد (Android & iOS via Capacitor)** يتصل مباشرة بالسيرفر المركزي على اللابتوب، ويحدد بعد تسجيل الدخول هل الحساب:
  - **عميل (`customer`)**: يرى بياناته وفواتيره وكشف حسابه وطلباته والكتالوج وأسعاره المخصصة فقط.
  - **مندوب (`representative`)**: يرى فقط العملاء المصرح له بالتعامل معهم، وعهدة سيارته، ويصدر فواتير/مسودات وطلبات تحويل أصناف.

---

## 2. تجهيز لابتوب المحل كسيرفر مركزي

### أ. تثبيت الإعدادات تلقائياً (Windows Firewall + التشغيل التلقائي)
1. افتح **PowerShell كمسؤول (Run as Administrator)** داخل مجلد المشروع.
2. نفّذ الأمر لتسجيل مهمة السيرفر وفتح الجدار الناري:
   ```powershell
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
   .\scripts\install-windows-server-task.ps1 -Port 3000
   ```
   سيقوم السكربت تلقائياً بـ:
   - فتح منفذ `TCP 3000` في جدار حماية Windows لشبكة المحل (`Private/Domain`).
   - تسجيل مهمة تشغيل تلقائي في Windows Task Scheduler عند فتح الويندوز (مع فحص عدم تكرار التشغيل على المنفذ 3000).
   - عرض روابط الشبكة المحلية مثل: `http://192.168.1.100:3000`.
3. (اختياري) لتسجيل التشغيل التلقائي لنفق Cloudflare مع الويندوز:
   ```powershell
   .\scripts\install-windows-tunnel-task.ps1 -Mode quick -Port 3000
   ```

### ب. التشغيل اليدوي المباشر للسيرفر فقط (بدون فتح واجهة سطح المكتب)
اضغط مرتين على:
`scripts\start-central-server.bat`
أو عبر الطرفية:
```bash
npm run server:start
```

---

## 3. طرق ربط تطبيق الموبايل بسيرفر اللابتوب (نظام الاتصال المتعدد - 4 أوضاع)

### الوضع 1: الشبكة المحلية داخل المحل (`Local Network`)
1. يكتشف التطبيق السيرفر تلقائياً عند الاتصال بنفس شبكة الواي فاي عند الإمكان عبر `GET /api/connection/discovery`.
2. لضمان ثبات IP اللابتوب يفضل تثبيته من إعدادات الراوتر (DHCP Reservation مثلاً `192.168.1.100`).
3. يمكن تعديل الإعداد من **Server & Connection Settings** عبر `http://192.168.1.100:3000`.

### الوضع 2: الاتصال الخارجي المجاني (`Free Remote Connection — trycloudflare.com`)
1. على لابتوب السيرفر، ثبّت `cloudflared` وشغّل `scripts\start-free-tunnel.bat`.
2. يقوم `scripts\tunnel-supervisor.mjs` بالتقاط رابط `https://xxxx.trycloudflare.com` تلقائياً وإرساله إلى `/api/internal/tunnel-status` لتحديث إعدادات السيرفر وتعميم الإصدار للأجهزة المتصلة عند تفعيل خيار الالتقاط التلقائي.
3. **تنبيه مهم**: رابط Quick Tunnel مؤقت وقد يتغير عند إعادة تشغيل النفق؛ وعند تغيّره أعد ربط الأجهزة بسهولة عبر رابط الدعوة أو QR Code أو التزامن التلقائي.

### الوضع 3: الاتصال الخارجي الاحترافي (`Professional Remote Connection`)
1. **Cloudflare Named Tunnel مع دومين ثابت مملوك للعميل**: ضع `CLOUDFLARE_TUNNEL_TOKEN` في ملف `.env` على السيرفر فقط ثم شغّل `scripts\start-pro-tunnel.bat` — لا يُفرض شراء دومين أو باقة محددة.
2. **أو Nginx Reverse Proxy + SSL**: استخدم `scripts\reverse-proxy-nginx.conf` مع `TRUST_PROXY=1`.
3. أدخل الدومين الثابت المشفر مثل `https://erp.yourdomain.com` في وضع **Professional Remote Connection**.
4. لتفعيل Android App Links و iOS Universal Links على الدومين الثابت، اضبط متغيرات `.env`: `ANDROID_APP_LINK_HOST`، `ANDROID_APP_SHA256_FINGERPRINTS`، و`APPLE_TEAM_ID`.

### الوضع 4: السيرفر السحابي الدائم مستقبلاً (`Cloud VPS Connection`)
- عند الرغبة لاحقاً في تشغيل السيرفر على VPS على مدار 24 ساعة، أضف عنوانه المشفر (`https://...`) في وضع **Cloud VPS Connection**، وانقل نفس قاعدة البيانات (النسخة الاحتياطية أو PostgreSQL) يدوياً بموافقة الإدارة دون إنشاء قاعدة منفصلة أو إعادة بناء التطبيقات.

### الربط الذكي عبر الرابط المباشر أو QR Code
- من **الإعدادات ← Server & Connection Settings ← الربط الذكي للأجهزة** ينشئ المسؤول رابطاً مباشراً (`/pair/:token`) ورمز **QR Code** قابلين للمشاركة عبر WhatsApp.
- لا يحتوي الرابط أو الـ QR على أي كلمات مرور أو JWT؛ يقوم فقط بإعداد عنوان السيرفر تلقائياً ثم يفرض شاشة **تسجيل الدخول المعتادة**.

---

## 4. بناء وتثبيت تطبيق Android و iOS (Capacitor)

### المتطلبات:
- لتجهيز ومزامنة كود الويب مع المشاريع الأصلية في أي وقت:
  ```bash
  npm run cap:sync
  ```

### بناء Android (`.apk` / `.aab`) ومفتاح الإنتاج الجديد:
- **مفتاح التوقيع الإنتاجي النهائي المستقل (RSA 4096-bit)**:
  - أنشئ مفتاح إنتاج جديد تماماً خارج مجلد المشروع (أو قم بتدويره وأرشفة أي مفتاح قديم) عبر:
    - على Windows: `powershell -ExecutionPolicy Bypass -File scripts\generate-android-release-key.ps1 -Rotate`
    - على macOS / Linux: `bash scripts/generate-android-release-key.sh --rotate`
  - يُحفظ المفتاح والنسخة الاحتياطية وملف Base64 خارج المشروع (`~/.awlad-selim-keys/`) ولا يُرفع مطلقاً إلى GitHub.
  - أضف الأسرار الأربعة التالية في **GitHub Settings -> Secrets -> Actions**:
    - `ANDROID_KEYSTORE_BASE64`
    - `ANDROID_KEYSTORE_PASSWORD`
    - `ANDROID_KEY_ALIAS` (افتراضياً `AWLAD-SELIM`)
    - `ANDROID_KEY_PASSWORD`
  - **تنبيه مهم للترقية الآمنة**: لا يمكن تحديث نسخة قديمة موقعة بمفتاح Debug أو مفتاح سابق مباشرة فوق نفس التثبيت؛ يجب أولاً مزامنة العمليات المعلقة (أو تصديرها من مركز المزامنة)، ثم إلغاء تثبيت النسخة القديمة مرة واحدة قبل تثبيت APK الإنتاج الجديد، وبعدها تسجيل الدخول بنفس الحساب القديم على السيرفر المركزي.
- **آلياً عبر GitHub Actions**:
  - `.github/workflows/mobile-android.yml` يبني نسخة Debug تجريبية (`app-debug.apk`).
  - `.github/workflows/android-release.yml` يبني النسخة الإنتاجية الموقعة (`AWLAD-SELIM-3.0.0-Release.apk` و`AWLAD-SELIM-3.0.0-Release.aab`) ويتحقق من التوقيع بـ `apksigner` و`jarsigner` وهوية الحزمة `com.awladselim.erp`.
- **محلياً (باستخدام Android Studio + JDK 21)**:
  ```bash
  npm run build
  npx cap sync android
  npx cap open android
  ```
  ثم اختر **Build -> Build Bundle(s) / APK(s) -> Build APK(s)** داخل Android Studio (أو `./gradlew assembleRelease bundleRelease` مع ضبط `android/keystore.properties` محلياً بدون رفعه لـ Git).

### بناء iOS (`.ipa` على macOS + Xcode):
> ملاحظة تقنية: يتطلب تصدير وتوقيع تطبيق iOS جهاز **Mac** مع **Xcode** وحساب **Apple Developer**.
```bash
npm run build
npx cap sync ios
npx cap open ios
```
ثم اختر جهاز البناء أو **Any iOS Device (arm64)** ثم **Product -> Archive** في Xcode لتصدير ملف `.ipa` أو النشر على TestFlight / App Store.

---

## 5. إدارة الصلاحيات والتحكم من برنامج الكمبيوتر
- **تعيين المناديب للعملاء**: من شاشة **العملاء -> إضافة/تعديل عميل -> المناديب المسموح لهم**. لن يرى أي مندوب سوى العملاء المحددين له.
- **عجز مخزون سيارة المندوب**: إذا سجل المندوب فاتورة بكمية غير متوفرة في سيارته، تُحفظ تلقائياً كـ **مسودة**، ويرسل طلب تحويل أصناف مرتبط بها للإدارة. لا يمتلك المندوب صلاحية اعتماد التحويل لنفسه، وبعد تنفيذ الإدارة يستطيع المندوب تأكيد الاستلام ثم اعتماد الفاتورة.
- **صلاحيات الموبايل**: من **الإعدادات -> بوابة الموبايل** يمكن تفعيل/إيقاف تطبيق العملاء وتطبيق المناديب وإخفاء الأسعار عن العملاء.
