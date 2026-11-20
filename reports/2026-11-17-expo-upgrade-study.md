# دراسة ترقية Expo SDK (54 ← 58)

> **الحالة:** جديد — مستني قرار مؤمن
> **كتبه:** الجلسة الرئيسية + `rnd-researcher` (بحث) + `code-explorer` (جرد الكود)، 2026-11-17
> **السؤال:** نرقّي من SDK 54؟ لإمتى ولأنهي نسخة؟ وهل ثغرات `npm audit` بتأثر على التطبيق فعلاً؟

> ⚠️ **حدود البحث:** موقعي expo.dev وdocs.expo.dev كانوا مقفولين من شبكة الجلسة، فكلام Expo وجوجل وSheetJS هنا **من ملخصات البحث مش من الصفحات نفسها**. اللي في الريبو و`node_modules` اتقرا بالسطر.

## الخلاصة

**ترشيح: مانرقّيش دلوقتي.** مفيش ميعاد إجباري، ومفيش ثغرة بتأثر على التطبيق وهو شغّال على الموبايل. لكن فيه **خطر على طريقة الشغل** (Expo Go)، فنحط شروط رجوع واضحة ونعمل حاجتين صغيرين دلوقتي.

ده نفس قرار 2026-09-20 (TIMELINE «`expo` 54→57 مترفوض… الثغرات في أدوات البناء مش في الـAPK») — البحث ده **ملقاش سبب جديد يغيّره**، غير نقطة Expo Go.

## النسخ بعد 54

| SDK | نزل | React Native | أهم حاجة |
|---|---|---|---|
| 55 | 2026-02-25 | 0.83 | شال المعمارية القديمة (إحنا أصلاً على الجديدة)؛ أرقام الحزم بقت = رقم SDK |
| 56 | 2026-05-21 | 0.85 | مشكلة ذاكرة في Hermes مع reanimated |
| 57 | 2026-06-30 | 0.86 | نفس مشكلة Hermes |
| **58** (الأحدث) | ~2026-10-14 | 0.88 | الإشعارات بتظهر والتطبيق مفتوح افتراضيًا، R8 شغّال، Node ≥ 22.13 |

Expo بتدعم كل SDK حوالي سنة، و**Expo Go بيشتغل على آخر SDK بس**.

## ميعاد جوجل بلاي

من 2026-08-31 أي تحديث لازم يستهدف **Android API 36** — و**SDK 54 أصلاً بيبني على 36**. مفيش ميعاد معلن لـ37. **مفيش ضغط.**

## الثغرات (41 في `npm audit`)

| الثغرة | داخلة في التطبيق على الموبايل؟ | الأثر الحقيقي |
|---|---|---|
| `shell-quote` (critical) وأغلب الـhigh/moderate (`glob`, `postcss`, `js-yaml`, `node-forge`, `undici`…) | ❌ أدوات بناء وتطوير | مالهاش أثر على المستخدم |
| `@grpc/grpc-js` عبر firebase | ❌ نسخة React Native من Firestore مبتستخدمهاش (اتقرا في `node_modules`) | مفيش |
| `xlsx` (prototype pollution + ReDoS) | ✅ داخلة، بس الثغرتين في **قراية** الملفات، والتطبيق **بيكتب بس** (`app/archive.tsx`) | مش مستغلّة |
| `decode-uri-component` عبر expo-router | ✅ داخلة | أسوأ حاجة: لينك متلعب فيه يعلّق التطبيق لحد ما يتقفل — من غير تسريب ولا فلوس، والمستخدم لازم يدوس عليه. **وممكن 58 متصلحهاش أصلاً** |

## الترقية هتلمس إيه عندنا (لما تيجي)

- **تصدير الإكسيل:** `expo-file-system/legacy` في `app/archive.tsx` — الواجهة القديمة.
- **الإشعارات:** `lib/notifications.ts` — سلوك الإشعار والتطبيق مفتوح اتغيّر في 58.
- **الحماية من الرجوع:** `usePreventRemove` في `app/modal.tsx` (لسه مضاف النهارده) — لازم يتجرّب.
- **تسجيل الدخول بجوجل:** `expo-auth-session` بتحويلة مخصّصة.
- **فايربيز:** `getReactNativePersistence` من `firebase/auth` — فيه مشكلة معروفة مع Metro في نسخ أحدث.
- **الاهتزاز:** `performAndroidHapticsAsync`.
- **الاختبارات:** `jest-expo`، وقايمة `transformIgnorePatterns`، وتحويلة `expo-asset` في إعداد jest.
- **البناء:** Node في الورك فلو (22 ← ≥ 22.13)، و`eas-version: latest` مش مثبّتة، وR8.

## ترشيح

1. **مانرقّيش دلوقتي.** نسجّل **شروط الرجوع** في TIMELINE — أي واحد منهم يفتح الموضوع:
   - Expo Go على الـSamsung (البروفايل الرئيسي) يتحدّث لنسخة بعد 54 → طقم Maestro وفحص الجهاز يقفوا.
   - جوجل تعلن ميعاد لـAPI 37.
   - EAS يبطّل يبني SDK 54.
2. **حاجتين صغيرين دلوقتي (من غير ترقية):**
   - **أوقف التحديث التلقائي لـExpo Go** على الـSamsung في البروفايل الرئيسي (Play ← Expo Go ← ⋮ ← إلغاء التحديث التلقائي). **ده محتاجك إنت.**
   - **`xlsx` لـ0.20.3** من موقع SheetJS (الطريقة الرسمية بتاعتهم؛ npm واقف عند 0.18.5). مش ضروري أمنيًا عندنا، بس بيشيل أكبر بند «مالهوش تصليح» من التقرير. **محتاج السماح بـ`cdn.sheetjs.com` في شبكة البيئة** (مقفول دلوقتي).
3. **لما الترقية تيجي:** جولة لوحدها على فرع، قفزة واحدة لـ58 بـ`npx expo install expo@^58 --fix` + `npx expo-doctor`، ومراجعة البنود اللي فوق واحد واحد، وتجربة كاملة على الجهاز قبل الدمج — ومحتاجة السماح بـexpo.dev في الشبكة عشان نقرا ملاحظات كل نسخة من المصدر.

## المصادر (ملخصات بحث)
- https://expo.dev/changelog/sdk-55 · https://expo.dev/changelog/sdk-56 · https://expo.dev/changelog/sdk-57 · https://expo.dev/blog/how-to-upgrade-to-sdk-58
- https://docs.expo.dev/workflow/upgrading-expo-sdk/ · https://github.com/expo/fyi/blob/main/outdated-sdk-versions.md
- https://support.google.com/googleplay/android-developer/answer/11926878 · https://developer.android.com/google/play/requirements/target-sdk
- https://reactnative.dev/blog/2025/08/12/react-native-0.81
- https://github.com/firebase/firebase-js-sdk/issues/9316
- https://cdn.sheetjs.com/advisories/CVE-2024-22363.html · https://advisories.gitlab.com/npm/xlsx/CVE-2024-22363/
- https://advisories.gitlab.com/npm/decode-uri-component/CVE-2026-45822/
