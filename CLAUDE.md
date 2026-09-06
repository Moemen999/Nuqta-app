@AGENTS.md

# نقطة (Nuqta)

## المشروع ده إيه

"نقطة" تطبيق موبايل لتتبع المصاريف الشخصية، مبني بـ **React Native + Expo (SDK 54)** و**Expo Router** لتوجيه الشاشات، والداتا كلها متخزنة في **Firebase** (Auth + Firestore) مع مزامنة لحظية (realtime) باستخدام `onSnapshot`.

الواجهة **عربي بالكامل و RTL بالكامل**، والنصوص كلها بعامية مصرية واضحة (مش فصحى ومش مبالغ فيها). التصميم مستوحى من ألوان قناع توت عنخ آمون (دهبي + أزرق لازوردي + درجات دافية) وده متطبق في الثيمين الفاتح والغامق.

> **مهم:** إكسبو اتغيّر كتير في النسخ الحديثة — لو هتضيف كود بيعتمد على APIs معينة من Expo، ارجع لتوثيق النسخة v54 هنا: https://docs.expo.dev/versions/v54.0.0/ قبل ما تكتب أي حاجة.

## الستاك

- **React Native 0.81** + **React 19** + **Expo SDK 54**
- **Expo Router** (`expo-router/entry`) — التوجيه بالفولدرات (`app/`)
- **Firebase JS SDK v12** — `firebase/auth` (مع `getReactNativePersistence` عشان تسجيل الدخول يفضل محفوظ) و`firebase/firestore`
- **AsyncStorage** لحاجات محلية بسيطة (تفضيل الثيم، حالة الـ onboarding)
- **expo-secure-store** + **expo-crypto** لتخزين قفل التطبيق (PIN/باسورد) بشكل آمن
- **@expo-google-fonts/tajawal** لخط Tajawal
- **expo-contacts** لاختيار شخص من جهات الاتصال في شاشة الديون
- **expo-file-system** + **expo-sharing** + **xlsx** لتصدير الأرشيف إكسيل
- **react-native-chart-kit** + **react-native-svg** للرسوم في التقارير
- **expo-notifications** — نظام إشعارات نظام حقيقي وشغال (مش بانرات داخلية بس): `lib/notifications.ts` بيظبط قناة أندرويد ويطلب الإذن ويجدول الإشعارات، و`context/NotificationsContext.tsx` بيدير تفعيل/تعطيل الإشعارات وإعدادات التذكير اليومي من الإعدادات (`settings.tsx`)

## البنية (إيه اللي في كل فولدر)

### `app/` — الشاشات (Expo Router)
- `_layout.tsx` — الـ Root layout: بيلف كل الـ Providers (`ThemeProvider` → `AppLockProvider` → `AuthProvider` → `DataProvider`)، بيحمّل خطوط Tajawal ويطبّقها عالميًا، وبيقرر أي شاشة تظهر (onboarding / قفل / auth / تابات) حسب حالة كل Context
- `(auth)/` — شاشة تسجيل الدخول/التسجيل (`index.tsx`) و`_layout.tsx` بتاعها
- `(tabs)/` — التابات الخمسة الأساسية:
  - `index.tsx` — الرئيسية: أرصدة المحافظ + بانرات التنبيهات (رصيد قرب يخلص، ميزانية قربت تخلص، اشتراك/قسط جمعية مستحق) + آخر العمليات
  - `reports.tsx` — التقارير والرسوم البيانية
  - `planning.tsx` — التخطيط: فيها تاب فرعي بين "الميزانية" (`BudgetView`) و"شخبطة" (`ShakhbataView`)
  - `debts.tsx` — الديون: فيها تاب فرعي بين "الديون" و"الاشتراكات" (`SubscriptionsView`) و"الجمعية" (`GamiyaView`)
  - `settings.tsx` — الإعدادات: المحافظ، الفئات، الثيم، قفل التطبيق، تسجيل الخروج، إعادة عرض شاشة الترحيب
- `modal.tsx` — مودال إضافة/تعديل عملية (مصروف/إيراد/سحب)
- `archive.tsx` — أرشيف العمليات بفلترة تاريخ + تصدير إكسيل
- `person-ledger.tsx` — كشف حساب شخص معين في الديون (تاريخ كامل للزيادات والسدادات)
- `user-guide.tsx` — دليل استخدام التطبيق
- `oauth2redirect.tsx` — صفحة استقبال الرجوع من تسجيل الدخول بجوجل (لازم تشتغل حتى قبل تسجيل الدخول)

### `components/`
- `BudgetView.tsx` — إدارة ميزانية كل فئة شهريًا
- `ShakhbataView.tsx` — توزيع الدخل الشهري بالنسب (احتياجات/رغبات/مستقبل) على طريقة الـ 50/30/20 (قابلة للتعديل)
- `SubscriptionsView.tsx` — إدارة الاشتراكات الدورية (شهري/سنوي/عدد أيام مخصص)
- `GamiyaView.tsx` — إدارة الجمعية (شهور، شهر الاستلام، تسديد كل شهر)
- `LockScreen.tsx` — شاشة إدخال PIN/باسورد قفل التطبيق
- `SetLockModal.tsx` — مودال تفعيل/تغيير/إلغاء قفل التطبيق
- `OnboardingScreen.tsx` — شاشة الترحيب لأول مرة (`ONBOARDING_KEY` في AsyncStorage)
- `CalendarPickerModal.tsx` — اختيار تاريخ (مستخدم في أماكن كتير: مودال العملية، الأرشيف، إلخ)
- `external-link.tsx`, `haptic-tab.tsx`, `hello-wave.tsx`, `parallax-scroll-view.tsx`, `themed-text.tsx`, `themed-view.tsx` — كومبوننتس مساعدة عامة (جزء منها من قالب Expo الافتراضي)
- `ui/icon-symbol.tsx` (+ `.ios.tsx`), `ui/collapsible.tsx` — أيقونات وكومبوننتس UI عامة

### `context/` — الـ Contexts والدور بتاع كل واحدة
- **`AuthContext.tsx`** — تسجيل الدخول/الخروج (إيميل+باسورد، جوجل)، `sendEmailVerification`، بيكتب بيانات المستخدم الأساسية في `users/{uid}` عند أول تسجيل
- **`DataContext.tsx`** — قلب التطبيق: كل الداتا المالية (محافظ، فئات، عمليات، ميزانيات، شخبطة، ديون، اشتراكات، جمعية) وكل الـ CRUD operations عليها، مع `onSnapshot` لكل collection عشان المزامنة اللحظية. فيها منطق مهم:
  - `claimSeeding` — بيستخدم `runTransaction` عشان يضمن إن المحافظ والفئات الافتراضية بتتزرع **مرة واحدة بس** لكل مستخدم جديد (شوف "مشاكل معروفة" تحت)
  - العمليات المرتبطة بالديون/الاشتراكات/الجمعية (سداد، قسط، استلام) كل واحدة منها بتولّد `Transaction` فعلي في نفس الوقت، وبتتربط بـ `transactionId` عشان لو اتحذفت يتحذف معاها
- **`ThemeContext.tsx`** — ألوان الثيم (فاتح/غامق) بألوان قناع توت عنخ آمون، محفوظة في AsyncStorage (`nuqta-theme`). **كل الألوان لازم تيجي من هنا (`colors.xxx`) مش hardcoded في الكومبوننت**
- **`AppLockContext.tsx`** — قفل التطبيق بـ PIN أو باسورد (مشفّر SHA-256 عبر `expo-crypto`، متخزن في `expo-secure-store`)، مع خيار "قفل عند الفتح" أو "قفل عند كل رجوع" ومهلة سماح (grace period) قبل ما يقفل تاني
- **`NotificationsContext.tsx`** — بيدير حالة إشعارات النظام (مفعّلة أو لأ، التذكير اليومي ومعاده)، محفوظة في AsyncStorage. بيراقب `subscriptions` و`gamiyas` من `DataContext` وكل ما تتغيّر بيعيد جدولة كل التذكيرات من الأول عبر `lib/scheduleAllReminders.ts`

### `lib/`
- `applyGlobalFont.ts` — بتـpatch كومبوننتس `Text` و`TextInput` من react-native عشان تطبّق خط Tajawal على **كل** نص في التطبيق تلقائيًا (تختار الوزن المناسب حسب `fontWeight`)، بدل ما تحط `fontFamily` يدوي في كل ملف
- `finance.ts` — دوال حسابية مشتركة: `walletBalance` (رصيد محفظة من كل العمليات)، `monthSpend`، `fmt` (تنسيق أرقام)، `todayStr`، `formatTime` (12 ساعة بصيغة ص/م)، `categoryLabel`، وقائمة `CATEGORY_ICONS`
- `notifications.ts` — طبقة رفيعة فوق `expo-notifications`: إعداد قناة أندرويد وسلوك الإشعارات (`setupNotifications`)، طلب/فحص الإذن، وجدولة إشعار في تاريخ معين أو تذكير يومي متكرر
- `scheduleAllReminders.ts` — بيمسح كل التذكيرات المجدولة ويعيد جدولتها من الأول بناءً على الاشتراكات والجمعية الحالية (كل واحد قبل موعده بـ `reminderDaysBefore` يوم) + التذكير اليومي لو مفعّل — بينادى من `NotificationsContext` كل ما البيانات أو الإعدادات تتغيّر

### `hooks/` و`constants/`
- `use-color-scheme.ts` / `.web.ts`, `use-theme-color.ts` — هوكس مساعدة لثيم النظام (منفصلة عن `ThemeContext` بتاع التطبيق)
- `constants/theme.ts` — ثوابت ثيم من قالب Expo الافتراضي (مش المصدر الأساسي للألوان — المصدر الحقيقي `ThemeContext`)

### `firebaseConfig.js`
إعداد Firebase (apiKey, projectId, إلخ) وتصدير `auth` و`db`. **قواعد أمان Firestore بتتحقق من شكل البيانات وبتتدار من كونسول Firebase مباشرة (مش موجودة كملف في الريبو)** — فأي حقل جديد بتضيفه لأي نوع بيانات (Transaction, Debt, Subscription, Gamiya...) لازم تتأكد إنه مسموح بيه في الـ rules، وإلا الكتابة هترجع `permission-denied`.

## المميزات الأساسية

1. **المحافظ (Wallets)** — كل محفظة ليها اسم، رصيد افتتاحي، وحد تنبيه لو الرصيد قرب يخلص. الرصيد الفعلي بيتحسب من مجموع العمليات مش بيتخزن مباشرة (`walletBalance` في `lib/finance.ts`)
2. **العمليات (Transactions)** — 3 أنواع: `expense` (مصروف)، `income` (إيراد)، `withdraw` (تحويل بين محفظتين — بياخد من واحدة ويحط في التانية عبر `walletId`/`toWalletId`)
3. **التقارير (Reports)** — رسوم بيانية على العمليات (مصروفات حسب الفئة، اتجاه شهري، إلخ)
4. **التخطيط (Planning)**:
   - **ميزانية** — حد شهري لكل فئة، وبانر تنبيه لو قربت تخلص أو خلصت
   - **شخبطة** — توزيع الدخل الشهري على 3 نسب قابلة للتعديل (احتياجات/رغبات/مستقبل)، افتراضيًا 50/30/20
5. **الديون (Debts)** — تاب واحد فيه 3 تحت-تابات:
   - **ديون** — `owed_to_me` (له عندك) أو `i_owe` (عليك له)، ممكن تكون قسط (installment)، وممكن تربط الدين بشخص من جهات الاتصال (`personContactId`) عشان تفتح كارت جهة الاتصال بضغطة، فيها زيادات (`increases`) وسدادات (`payments`) كل واحدة بتولّد Transaction
   - **اشتراكات (Subscriptions)** — دفعات دورية (شهري/سنوي/عدد أيام)، `markSubscriptionPaid` بيسجل العملية ويحسب `nextDueDate` تلقائي
   - **الجمعية (Gamiya)** — جدول شهور بمبلغ ثابت وشهر استلام واحد فيه المبلغ التراكمي، كل شهر بيتحدد `pending`/`done` وبيولّد Transaction عند التسديد/الاستلام
6. **الأرشيف (Archive)** — عرض كل العمليات بفلاتر تاريخ جاهزة (الشهر ده، آخر 7 أيام، الشهر اللي فات، الكل، مخصص) وتصدير Excel عبر `xlsx` + `expo-file-system` + `expo-sharing`
7. **القفل (App Lock)** — PIN أو باسورد، بيتفعل عند فتح التطبيق أو عند كل رجوع من الخلفية مع مهلة سماح اختيارية
8. **الإشعارات** — نوعين مختلفين، ماتلخبطش بينهم:
   - **إشعارات نظام حقيقية** (`expo-notifications` عبر `NotificationsContext` + `lib/notifications.ts` + `lib/scheduleAllReminders.ts`) — بتتفعّل من الإعدادات، وبتذكّر بمواعيد الاشتراكات وأقساط الجمعية قبلها بـ `reminderDaysBefore` يوم، وفيها كمان تذكير يومي اختياري بمعاد محدد لتسجيل مصاريف اليوم. أي حقل جديد يأثر على الجدولة (تاريخ استحقاق، مبلغ، `reminderDaysBefore`) لازم يتغطى في `scheduleAllReminders.ts`
   - **بانرات تنبيه داخل شاشة الرئيسية** — عرض بصري بس جوه `index.tsx`، بتظهر لما: رصيد محفظة يقرب يخلص، ميزانية (فئة أو إجمالية) تقرب تخلص. دي مش إشعارات نظام ومش مرتبطة بالجدولة اللي فوق

## قواعد شغل مهمة

1. **كل النصوص عربي مصري عامي واضح** — مش فصحى، ومش عامية مبالغ فيها أو ألفاظ غريبة. لو بتكتب رسالة خطأ أو تسمية زرار، اكتبها زي ما حد بيتكلم عادي
2. **كل الواجهات RTL بالكامل** — أي `View` فيه صف أفقي لازم `flexDirection: 'row-reverse'`. راجع أي كومبوننت جديد وتأكد الترتيب البصري من اليمين للشمال
3. **الألوان دايمًا من `ThemeContext`** — استخدم `const { colors } = useTheme()` واستخدم `colors.bg`, `colors.text`, `colors.accent`... إلخ. ممنوع تحط لون hex مباشر في `StyleSheet` إلا لو لون وظيفي ثابت مش جزء من الثيم (زي ألوان التصنيف في `TYPE_LABELS`)
4. **خط Tajawal مطبق عالميًا** — `lib/applyGlobalFont.ts` بيتنادى مرة واحدة في `app/_layout.tsx` بعد ما الخطوط تحمّل. منعندناش داعي نحط `fontFamily: 'Tajawal...'` يدوي في كل `Text` — ده بيتطبق أوتوماتيك حسب `fontWeight`
5. **أي شاشة/مودال فيها إدخال (TextInput) لازم يكون فيها `KeyboardAvoidingView`** (مع `Platform.OS === 'ios' ? 'padding' : undefined` غالبًا) — عشان الكيبورد ميغطيش الحقول. ده باگ اتصلح قبل كده وميتكررش (شوف تحت)
6. **قواعد Firestore بتتحقق من شكل البيانات** — أي حقل جديد تضيفه لأي نوع (`Wallet`, `Transaction`, `Debt`, `Subscription`, `Gamiya`...) في `DataContext.tsx` لازم يتضاف كمان في قواعد الأمان في كونسول Firebase، وإلا العملية هتفشل بصمت أو بـ `permission-denied`
7. لما تضيف عملية مالية جديدة مرتبطة بكيان تاني (دين/اشتراك/جمعية)، اتبع نفس النمط الموجود: ولّد الـ Transaction الأول واحفظ الـ `transactionId` جوه الكيان، عشان لو اتحذف الكيان أو العنصر يتحذف معاه الـ Transaction بدل ما يفضل يتيم

## مشاكل معروفة اتصلحت قبل كده — ميتكررش

- **تكرار المحافظ الافتراضية** — كان ممكن يحصل لو المستخدم فتح التطبيق مرتين بسرعة أول تسجيل، فبتتزرع المحافظ والفئات الافتراضية مرتين. اتحل بـ `claimSeeding` في `DataContext.tsx` اللي بيستخدم `runTransaction` ذرية على `users/{uid}.seeded` — أي كود جديد بيزرع بيانات افتراضية للمستخدم الجديد لازم يمر بنفس النمط ده (claim ذري) مش `if (!seeded)` عادي
- **الكيبورد بيغطي حقول الإدخال** — أي شاشة أو مودال فيه `TextInput` لازم يتلف بـ `KeyboardAvoidingView` (زي `modal.tsx`, `settings.tsx`, `debts.tsx`) — من غير كده المستخدم مش شايف اللي بيكتبه على الشاشات الطويلة
- **اختفاء/كراش مع الأسماء العربية في جهات الاتصال** — بعض جهات الاتصال العربية مالهاش حقل `name` موحّد وبس فيها `firstName`/`lastName` منفصلين، فكان بيرجع اسم فاضي أو يعمل كراش. الحل في `debts.tsx`: اطلب `Contacts.Fields.Name` و`FirstName` و`LastName` مع بعض، واعمل fallback: لو `name` فاضي، ادمج `firstName` + `lastName` (`composed`) واستخدمه بدله
