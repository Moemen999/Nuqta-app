/**
 * أول تجهيز للحساب الجديد — "نبدأ بإيه؟".
 *
 * بيحل محل التعبئة الأوتوماتيك القديمة (`claimSeeding`) اللي كانت بتبلع فشلها:
 * لو الـtransaction وقع، المستخدم الجديد كان بيطلع من غير ولا محفظة ومن غير أي
 * كلمة. دلوقتي المستخدم بيختار بنفسه، والحفظ بيستنى السيرفر ويقول النتيجة.
 *
 * الملف ده الاختيارات والتحقق بس (من غير فايربيز) — الحفظ في `completeSetup`
 * جوه `DataContext`، والشاشة `components/FirstRunSetup.tsx`.
 */

export type SetupWallet = { name: string; openingBalance: number };
export type SetupChoice = { wallets: SetupWallet[]; categories: string[] };

/**
 * نتيجة الحفظ. `already-done` = الحساب اتجهّز قبل كده **بنفس الاختيارات** (محاولة
 * سابقة وصلت بعد ما السقف خلص). `already-done-other` = اتجهّز باختيارات **تانية**
 * (محاولة قديمة بأرقام قبل ما تتعدّل، أو جهاز تاني) — ممنوع نقول "اتحفظ" على
 * أرقام مش هي اللي اتكتبت (money-reviewer).
 */
export type SetupOutcome = 'done' | 'already-done' | 'already-done-other' | 'no-connection' | 'failed' | 'unconfirmed';

/**
 * `checking`: لسه بنسأل السيرفر. `needed`: السيرفر أكّد إنه حساب جديد.
 * `done`: متجهّز. `unknown`: مقدرناش نتأكد (مفيش نت) — التطبيق بيفتح عادي
 * والسؤال بيتعاد، ومبنقررش على تخمين.
 */
export type SetupStatus = 'checking' | 'needed' | 'done' | 'unknown';

/** المحافظ اللي بتتعرض للاختيار. الرصيد الافتتاحي بيتكتب لكل واحدة */
export const WALLET_OPTIONS = [
  { key: 'cash', name: 'كاش' },
  { key: 'bank', name: 'حساب بنكي' },
  { key: 'mobile', name: 'محفظة موبايل' },
  { key: 'credit', name: 'كارت ائتمان' },
] as const;

export const CATEGORY_OPTIONS = ['أكل', 'مواصلات', 'سوبرماركت', 'فواتير', 'صحة', 'ترفيه', 'لبس', 'أخرى'] as const;

/** اللي مختار من الأول — أكتر حاجة الناس بتبدأ بيها */
export const PRESELECTED_WALLETS = ['cash'] as const;
export const PRESELECTED_CATEGORIES = ['أكل', 'مواصلات', 'سوبرماركت', 'فواتير', 'أخرى'] as const;

/** "تخطي": أقل حاجة معقولة تخلّي التطبيق يشتغل على طول */
export const SKIP_SETUP: SetupChoice = {
  wallets: [{ name: 'كاش', openingBalance: 0 }],
  categories: ['أكل', 'مواصلات', 'سوبرماركت', 'فواتير', 'أخرى'],
};

export const SETUP_NAME_MAX = 40;

/**
 * أي حساب اتعمل **قبل** اللحظة دي اتعمل قبل ما شاشة "نبدأ بإيه؟" تبقى موجودة
 * في أي نسخة — فأول تشغيل ليه عدّى على التعبئة القديمة، ومش "جديد" بالتعريف.
 * ده بيخلّي الفحص فوري ومن غير نت للمستخدمين القدام (من غير الـ8 ثواني).
 *
 * **ممنوع التاريخ ده يتأخر أبدًا.** لو اتأخر بعد أول نسخة فيها الشاشة، حساب
 * جديد اتعمل في الفترة دي هيتعدّى الشاشة. التاريخ ده قبل أي بناء فيه الشاشة
 * (مفيش بناء من 2026-09-20). ولو حساب قديم تعبئته القديمة كانت فشلت (صفر
 * محافظ)، الرئيسية بتقول "مفيش ولا محفظة" وبتودّيه يضيف — مش ساكت.
 */
export const SETUP_FEATURE_CUTOFF = '2026-09-27T00:00:00Z';

/** `creationTime` بتاع Firebase Auth (نص زي "Sat, 26 Sep 2026 10:00:00 GMT") */
export function createdBeforeSetupFeature(creationTime: string | null | undefined): boolean {
  if (!creationTime) return false;
  const t = Date.parse(creationTime);
  return Number.isFinite(t) && t < Date.parse(SETUP_FEATURE_CUTOFF);
}

/** مفتاح على الجهاز: الحساب ده اتأكد إنه متجهّز — ميتسألش السيرفر تاني */
export const setupDoneKey = (uid: string) => `nuqta-setup-done:${uid}`;

const norm = (s: string) => s.trim().toLocaleLowerCase('ar');

/**
 * بصمة الاختيار — بتتخزّن مع `seeded` عشان المحاولة الجاية تعرف إذا اللي اتكتب
 * هو نفس اللي المستخدم شايفه دلوقتي. ترتيب ثابت ومسافات متشالة.
 */
export function setupFingerprint(c: SetupChoice): string {
  const w = c.wallets.map(x => `${norm(x.name)}=${Math.round(x.openingBalance * 100)}`).sort();
  const k = c.categories.map(norm).sort();
  return `w:${w.join('|')};c:${k.join('|')}`;
}

/**
 * خانة الرصيد في أول شاشة: المستخدم الجديد ممكن يكتب "١٥٠٠" أو "1,500" أو
 * "١٬٥٠٠٫٥". بنحوّلهم لرقم إنجليزي قبل `parseWalletAmountInput` بدل ما نقول
 * "مش رقم" (money-reviewer). الشاشة دي بس — باقي الخانات زي ما هي.
 */
export function normalizeAmountInput(raw: string): string {
  return String(raw ?? '')
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[,٬\s]/g, '')
    .replace(/٫/g, '.')
    .replace(/[−–]/g, '-');
}

/** أول مشكلة بالكلام، أو null. الشاشة بتعرضها والحفظ مبيحصلش */
export function validateSetupChoice(c: SetupChoice): string | null {
  if (c.wallets.length === 0) return 'اختار محفظة واحدة على الأقل — من غيرها مش هتقدر تسجل ولا عملية.';
  if (c.categories.length === 0) return 'اختار فئة واحدة على الأقل.';
  const names = c.wallets.map(w => w.name.trim());
  if (names.some(n => !n)) return 'فيه محفظة من غير اسم.';
  if (names.some(n => n.length > SETUP_NAME_MAX)) return `اسم المحفظة طويل — أقصاه ${SETUP_NAME_MAX} حرف.`;
  if (new Set(names.map(norm)).size !== names.length) return 'فيه محفظتين بنفس الاسم.';
  if (c.wallets.some(w => !Number.isFinite(w.openingBalance))) return 'فيه رصيد مش رقم.';
  const cats = c.categories.map(x => x.trim());
  if (cats.some(n => !n)) return 'فيه فئة من غير اسم.';
  if (cats.some(n => n.length > SETUP_NAME_MAX)) return `اسم الفئة طويل — أقصاه ${SETUP_NAME_MAX} حرف.`;
  if (new Set(cats.map(norm)).size !== cats.length) return 'فيه فئتين بنفس الاسم.';
  return null;
}

/** الرسالة لما الحفظ ما يتمش — دايمًا بتقول إن مفيش حاجة اتسجلت نص نص */
export const SETUP_FAIL_MESSAGE: Record<'no-connection' | 'failed' | 'unconfirmed', { title: string; body: string }> = {
  // السقف خلص والعملية لسه ممكن تكمل — منقولش "ما اتحفظش" على حاجة مش متأكدين منها
  unconfirmed: {
    title: 'ما اتأكدناش إنه اتحفظ',
    body: 'السيرفر ما ردّش في الوقت. لو الحفظ وصل هيفتحلك التطبيق لوحده؛ لو ما فتحش، دوس "جرّب تاني" — مش هيتكرر حاجة.',
  },
  'no-connection': {
    title: 'مفيش نت دلوقتي',
    body: 'ما اتحفظش حاجة لسه. التجهيز محتاج يوصل السيرفر مرة واحدة — اتأكد من النت ودوس "جرّب تاني".',
  },
  failed: {
    title: 'ما اتحفظش',
    body: 'حصلت مشكلة وإحنا بنحفظ، وما اتسجلش أي حاجة. دوس "جرّب تاني"، ولو فضلت كده ابعتلنا.',
  },
};

/** المحاولة اللي قالت "ما اتأكدناش" وصلت السيرفر بعدين واتحفظت — التطبيق بيفتح */
export const SETUP_LATE_DONE_MESSAGE = {
  title: 'حسابك اتجهّز',
  body: 'المحاولة اللي قبل كده وصلت السيرفر بعد شوية واتحفظت بالاختيارات اللي كنت بعتها ساعتها. تقدر تعدّل المحافظ والفئات من الإعدادات.',
};

/** الحساب اتجهّز قبل كده باختيارات مش هي اللي قدام المستخدم دلوقتي */
export const SETUP_OTHER_MESSAGE = {
  title: 'حسابك كان اتجهّز قبل كده',
  body: 'اتحفظت اختيارات من محاولة قبل كده أو من موبايل تاني — مش الأرقام اللي قدامك دلوقتي. بص على محافظك وأرصدتها وعدّلها من الإعدادات لو محتاج.',
};
