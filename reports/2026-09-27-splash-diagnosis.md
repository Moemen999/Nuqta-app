> **الحالة:** اتقرا — 2026-09-28. القرار: التصليح اتعمل مع حزام في مستوى الموديول (`b986379`)، ومستني بناء حقيقي يتأكد (TIMELINE)
> **الكاتب:** Claude Code · **التاريخ:** 2026-09-27
> **السؤال:** الـsplash (بند Antigravity اللي اتساب من غير سبب): المستخدم بيشوف إيه فعلاً في أول فتحة باردة، وإيه أنضف تصليح؟ **تشخيص بس — مفيش تصليح.**

## الخلاصة

**الـsplash بيختفي بدري — في أول frame — قبل ما الخطوط تحمّل وقبل ما التطبيق يعرف
هيعرض إيه.** اللي بعده **شاشة فاضية بلون خلفية النافذة (`#0B0D10` غامق)** لحد ما
الخطوط تحمّل **و**حالة الدخول/القفل/الترحيب تتقري. في الثيم الفاتح ده معناه:
لوجو ← فراغ غامق ← الواجهة الفاتحة (ومضة).

ده **استنتاج من قراية كود المكتبات المتثبّتة** (مذكور تحت بالسطر) — **مش متشاف على
جهاز.** Expo Go بيعرض الـsplash بتاعه هو، فمينفعش يتقاس غير على بناء حقيقي.

## ليه — من الكود نفسه

1. **`expo-router` بيمسك الـsplash أول ما يبدأ** — `renderRootComponent.js:83`:
   `SplashScreen._internal_preventAutoHideAsync()` جوه `setTimeout` (عشان يدّي
   فرصة للتطبيق ينادي بنفسه الأول). ده بيحط `preventAutoHideCalled = true` في
   `SplashScreenManager.kt:16` فالـsplash ميختفيش مع أول محتوى.
2. **وبيسيبه أول ما الـnavigation يبقى جاهز** — `router-store.js:104`:
   `onReady()` ← `_internal_maybeHideAsync()` ← `SplashScreenModule.kt:52`: بيخفي
   **لو التطبيق نفسه ما نادى `preventAutoHideAsync`** — وإحنا ما بنناديهاش خالص.
3. **و`onReady` بييجي في أول render مهما كان اللي بنعرضه** — `ExpoRoot.js:161`:
   expo-router بيلف `app/_layout.tsx` في navigator داخلي بتاعه
   (`useNavigationBuilder(StackRouter)`)، و`isReady()` في
   `BaseNavigationContainer.js:152` معناها "فيه navigator متسجّل" — مش "الشاشة
   بتاعتك ظهرت". فحتى و`RootLayout` بيرجّع `null`، الـsplash بيختفي.
4. **وإحنا بنرجّع `null` مرتين قبل أي حاجة تظهر:**
   - `app/_layout.tsx` — `if (!fontsLoaded) return null;` (خطوط Tajawal)
   - `RootNavigator` — `if (loading || lockLoading || onboardingDone === null) return null;`
     (استرجاع تسجيل الدخول من الجهاز + حالة القفل من SecureStore + مفتاح الترحيب)
   - وأول مرة على الجهاز بس: `SetupChecking` ("بنتأكد من حسابك…") لحد ما الفحص يخلص.
5. **ولون اللي بيبان في الفراغ:** `app.json` — `backgroundColor: "#0B0D10"` (غامق
   للثيمين)، وده لون النافذة ورا React. `ThemeContext` الفاتح خلفيته فاتحة — فالمستخدم
   اللي على الفاتح بيشوف غامق ← فاتح.

**مدة الفراغ (تقدير، مش قياس):** تحميل الخطوط من الـassets (عادة أقل من ثانية) +
استرجاع Firebase Auth + قراية SecureStore/AsyncStorage. أغلب الوقت كسر من
الثانية، وأطول على موبايل بطيء — بس **مش صفر**، وكل فتحة باردة.

## أنضف تصليح (مقترح — مستني قرارك)

في `app/_layout.tsx`:

```ts
import * as SplashScreen from 'expo-splash-screen';

// برّه الكومبوننت — زي initSentry، عشان يتنادى قبل setTimeout بتاع expo-router
SplashScreen.preventAutoHideAsync();
```

وجوه `RootNavigator`: أول ما يبقى عنده حاجة يعرضها فعلاً (مش `null`) — يعني
`fontsLoaded && !loading && !lockLoading && onboardingDone !== null` —
`SplashScreen.hideAsync()` مرة واحدة (في `useEffect`).

**وحزام أمان لازم:** `setTimeout(() => SplashScreen.hideAsync(), 5000)` من أول
التشغيل. من غيره، أي باج يخلي شرط الإخفاء ميتحققش (مثلاً قراية SecureStore
بتعلّق) يبقى **التطبيق واقف على اللوجو للأبد** — أوحش من الفراغ الحالي. (expo-router
بيخفي لوحده على أي crash — `renderRootComponent.js:97` وحارس الـErrorUtils في
`splash.js` — بس ده مش بيغطي حاجة معلّقة من غير خطأ.)

**ومش جزء من التصليح:** شاشة "بنتأكد من حسابك…" (أول مرة بس) — دي حالة حقيقية
بتتقال، مش فراغ، وتفضل بعد الـsplash زي ما هي.

## المخاطر والحاجات اللي محتاجة تتأكد

- **محتاج بناء حقيقي عشان يتقاس قبل وبعد** — Expo Go مبيوريش الـsplash بتاعنا.
  حصة EAS خلصت لحد 1 أكتوبر.
- `expo-splash-screen` 31.0.13 / `expo-router` 6.0.24 — السلوك ده من الكود
  المتثبّت دلوقتي؛ أي ترقية لازم تتراجع عليه.
- **اختبار:** نقدر نختبر في Jest إن `hideAsync` بيتنادى لما الشروط تتحقق وإن
  الحزام بيشتغل (mock لـ`expo-splash-screen`) — بس ده بيثبّت إننا بننادي، مش إن
  الشاشة شكلها صح.
- **لون الفراغ:** حتى بعد التصليح، لو حصل أي فراغ (مثلاً بين إخفاء الـsplash وأول
  رسم)، لون النافذة غامق. ممكن يتظبط لون النافذة حسب الثيم — بس ده `app.json`
  ومش بيعرف الثيم اللي المستخدم مختاره (محفوظ في AsyncStorage)، فمش حل كامل.
