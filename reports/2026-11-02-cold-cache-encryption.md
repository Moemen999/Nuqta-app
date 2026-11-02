> **الحالة:** جديد — لسه محدش رد عليه
> **مين كتبه:** Claude Code (rnd-researcher، لوب الليل)
> **التاريخ:** 2026-11-02
> **السؤال:** كاش أول فتحة باردة (آخر أرصدة وعمليات) لازم يتشفّر، ولا AsyncStorage عادي يكفي؟

## اللي اتقرا (بمصدر)
- أندرويد: التخزين الداخلي "accessible only to your app… sufficient for most applications" — developer.android.com/privacy-and-security/security-tips. الأجهزة من أندرويد 10 بتشفّر القرص بالملفات (FBE) — source.android.com/docs/security/features/encryption.
- Auto Backup بياخد shared prefs وقواعد البيانات افتراضيًا؛ النسخة end-to-end على أندرويد 9+ **بشرط قفل شاشة**، ونقل جهاز لجهاز من غير تشفير — developer.android.com/identity/data/autobackup. `android.allowBackup` افتراضيًا true — docs.expo.dev/versions/v54.0.0/config/app/. `app.json` عندنا مفيهوش `allowBackup`.
- RN: AsyncStorage "unencrypted"، وممنوع للتوكنز والأسرار — مصدر صفحة reactnative.dev/docs/security.
- SecureStore SDK 54: بعض نسخ iOS رفضت قيم فوق ~2048 بايت، وأندرويد بيشفّر بالـKeystore، وشغال في Expo Go — docs.expo.dev/versions/v54.0.0/sdk/securestore/.
- **expo-crypto 15.0.9 (عندنا) مفيهوش AES**؛ AES-GCM اتضاف في 55.0.0 (2026-01-21) — CHANGELOG بتاع expo-crypto (اتأكد بـgrep في node_modules).
- MMKV v4 Nitro ومحتاج prebuild؛ v3 بيرمي "not supported in Expo Go!" — github.com/mrousavy/react-native-mmkv.
- OWASP MASVS-STORAGE-1 "securely stores sensitive data… independently of the target location"؛ STORAGE-2 بيذكر الباك أب واللوجات؛ MASWE-0006 "Sensitive Data Not Excluded From Backup".
- Actual Budget: "Data on your local device is still unencrypted. We recommend full disk encryption" — docs Actual (sync.md).
- Google Play Data safety: البيانات اللي بتتعالج على الجهاز بس مش "collected"، وسؤال التشفير عن in transit — support.google.com/googleplay/android-developer/answer/10787469.
- **من الريبو:** `firebaseConfig.js:19` `getReactNativePersistence(AsyncStorage)` — توكن فايربيز متخزّن من غير تشفير في AsyncStorage **من دلوقتي**.

## مش متأكد
مكان قاعدة AsyncStorage على أندرويد (الملف ما اتفتحش)، توافق quick-crypto مع SDK 54، `getRandomValues` في expo-crypto 15، سياسات Wallet/Monarch/Firefly (ملقتش مصدر عام).

## الاختيارات (استنتاج)
- (أ) AsyncStorage + قفل الباك أب: مفيش اعتمادية، Expo Go وMaestro شغالين. مبيحميش الجهاز المروّت (مخالفة حرفية لـSTORAGE-1).
- (ب) AES والمفتاح في SecureStore: مفيش AES في SDK 54؛ noble-ciphers JS (audit cure53 2024) محتاج polyfill لـgetRandomValues.
- (ج) MMKV متشفّر: بيكسر Expo Go وطقم Maestro كله.
- (د) أرقام من غير أسامي: نص حل.
**أهم نقطة:** اللي يقرا AsyncStorage بياخد التوكن اللي بيفتح **كل** البيانات من السيرفر — تشفير الكاش لوحده مبيقفلش الباب.

## الترشيح
**(أ):** AsyncStorage من غير تشفير، + `allowBackup: false` (أو استثناء الكاش) + مسح الكاش مع تسجيل الخروج + الحد الأدنى (أرصدة وآخر N عملية، من غير ديون وأسامي ناس) + علامة "قديم". ولما نروح SDK 55: AES-GCM من expo-crypto والمفتاح في SecureStore ترقية رخيصة.

## لمؤمن
1. الجهاز المروّت برّه الحماية — مقبول؟ (ده نفس وضع التوكن دلوقتي)
2. `allowBackup: false` للتطبيق كله (المستخدم يخسر نقل الثيم والجلسة لجهاز جديد) ولا استثناء للكاش بس (config plugin)؟
3. أسامي الناس والديون تدخل الكاش ولا لأ؟
