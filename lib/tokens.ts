import type { ThemeColors } from '@/context/ThemeContext';
import type { DimensionValue, TextStyle, ViewStyle } from 'react-native';

/**
 * توكنات التصميم — المفردات المشتركة للواجهة.
 *
 * الأرقام هنا مش مخترعة: دي القيم اللي التطبيق مستخدمها فعلاً وبكثافة
 * (مثلاً fontSize 13 مستخدم 54 مرة، و12.5 واحد وأربعين مرة، وborderRadius 10
 * واحد وستين مرة). الفايدة إن أي واجهة جديدة تختار من اللستة دي فتطلع شكلها
 * زي باقي التطبيق من غير ما حد يحزر الرقم.
 *
 * مهم: إحنا **مش** بنعيد كتابة الـ 262 مكان اللي فيهم fontSize ولا المسافات
 * الموجودة. تطبيق المقاس بالعافية على كل حاجة قديمة معناه تغيير شكل التطبيق
 * كله — وده قرار تصميم لوحده، مش تنضيف كود. اللي اتوحّد فعلاً هنا هو الورقة
 * المنسدلة (كانت متكرّرة بالحرف 5 مرات) وحد اللمس.
 */

/**
 * **سلّم الخط الجديد** (دراسة الشكل 2026-11-05، قرار مؤمن 2026-11-06 «موافق على كل الترشيحات»): 4 مقاسات بس،
 * ووزنين (عادي وعريض)، ومفيش حاجة تحت 12. الشاشات بتتنقل عليه واحدة واحدة (فرع `design/premium`) — `font` اللي تحت
 * فاضل للي لسه ما اتنقلش. أي شاشة اتنقلت **مبتستخدمش** `font` تاني.
 */
export const typeScale = {
  /** تعليق: التاريخ، العلامات، السطر التوضيحي */
  caption: 12,
  /** النص العادي والأزرار */
  body: 14,
  /** عنوان الشاشة أو الكارت */
  title: 17,
  /** مبلغ ثانوي بارز في كارت — مش الرقم البطل */
  figure: 22,
  /** الرقم البطل — رقم واحد لكل شاشة */
  hero: 34,
} as const;

/**
 * ارتفاع السطر للنص اللي ممكن يلف على أكتر من سطر. العربي محتاج 1.4–1.6× من
 * مقاس الخط (الحروف بنقطها فوق وتحت)، وكان فيه 53 رقم صريح من 16 لـ26 لنفس
 * المقاسين. أي `lineHeight` برقم صريح في app/ أو components/ بيقع في
 * `tokensInventory.test.ts`.
 */
export const leading = {
  /** مع `typeScale.caption` (12) — 1.5× */
  caption: 18,
  /** مع `typeScale.body` (14) — ~1.57× */
  body: 22,
  /** جملة الترحيب بس (`OnboardingScreen`) — أوسع عن قصد */
  loose: 26,
} as const;

/** مقاس المسافات (gap / padding / margin) */
export const space = {
  xxs: 4,
  xs: 6,
  sm: 8,
  md: 10,
  lg: 12,
  xl: 14,
  xxl: 16,
  xxxl: 20,
  huge: 24,
} as const;

/** مقاس دايرة أيقونة الفئة (`CategoryIcon`): شريحة فلتر / صف قايمة / عمود تقرير */
export const categoryIconSize = { chip: 22, row: 24, bar: 28 } as const;
/** داخل دايرة الفئة: الإيموجي/الأيقونة نسبة من القطر، ارتفاع سطره، وشفافية خلفية الـtint (hex 2E ≈ 18%) */
export const categoryIconGlyph = { fontRatio: 0.55, lineRatio: 0.7, tintAlpha: '2E' } as const;

/** مقاس الخطوط */
export const font = {
  micro: 10.5,
  caption: 11,
  footnote: 11.5,
  label: 12,
  body: 12.5,
  text: 13,
  subtitle: 14,
  heading: 15,
  title: 17,
  amount: 22,
} as const;

/** مقاس استدارة الحواف */
export const radius = {
  track: 3,
  xxs: 4,
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  sheet: 20,
  /** كبسولة/دايرة كاملة (شريط، نقطة، حبة): أي قيمة أكبر من نص الارتفاع بترسم نفس الشكل */
  pill: 999,
} as const;

/** مقاسات رموز مالهاش درجة في `typeScale` (رمز سهم، شعار تسجيل الدخول) */
export const glyphSize = { chevron: 20, logo: 36 } as const;

/** دايرة الأيقونة الكبيرة (`HeroIcon`) بدل الإيموجي الزخرفي: الترحيب / أول تجهيز / الحالة الفاضية، والأيقونة نسبة من القطر */
export const heroIconSize = { welcome: 80, setup: 64, empty: 56, inline: 40 } as const;
export const heroIconGlyphRatio = 0.5;
/** المسافة تحت الدايرة قبل العنوان — نفسها في الشاشات التلاتة */
export const heroIconGap = space.xl;

/**
 * أصغر هدف لمس مقبول. أي حاجة بتتدوس لازم توصل للرقم ده — إما بارتفاع/عرض
 * فعلي أو بـ hitSlop. زرار جهات الاتصال كان ~26 وده كان صعب يتلمس، والثابت
 * ده موجود عشان الحالة دي تبقى ملحوظة بالـ grep مش مستنية حد يشتكي.
 */
export const MIN_TOUCH = 44;

/** حالات الزرار (`components/Button`): مضغوط، معطّل/مشغول، وتصغير الضغطة */
export const pressedOpacity = 0.85;
export const disabledOpacity = 0.6;
export const pressedScale = 0.98;

/** صف أفقي بترتيب عربي صح (من اليمين للشمال) */
export function rowRTL(gap?: number): ViewStyle {
  return gap === undefined
    ? { flexDirection: 'row-reverse' }
    : { flexDirection: 'row-reverse', gap };
}

/** الغطاء الغامق ورا الورقة المنسدلة من تحت */
export const overlayStyle: ViewStyle = {
  flex: 1,
  backgroundColor: 'rgba(0,0,0,0.6)',
  justifyContent: 'flex-end',
};

/** نفس الغطاء بس للمودالات اللي بتتوسّط الشاشة (زي التقويم) */
export const overlayCenteredStyle: ViewStyle = {
  flex: 1,
  backgroundColor: 'rgba(0,0,0,0.6)',
  alignItems: 'center',
  justifyContent: 'center',
};

/**
 * الورقة المنسدلة من تحت — الشكل الأساسي لكل المودالات في التطبيق.
 *
 * الطول مش بياخد قيمة افتراضية عن قصد: كل ورقة بتقول طولها بنفسها زي ما هي
 * دلوقتي (فيه اللي بـ maxHeight 90%، واللي بـ height ثابت عشان جواها ليست،
 * وفيه اللي مالوش حد خالص). لو حطينا افتراضي كنا هنضيف قيد على ورقة مكانش
 * عليها قيد قبل كده.
 */
export function sheetStyle(c: ThemeColors, size?: { height?: DimensionValue; maxHeight?: DimensionValue }): ViewStyle {
  return {
    backgroundColor: c.nav,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    padding: space.xxxl,
    ...(size?.height !== undefined ? { height: size.height } : {}),
    ...(size?.maxHeight !== undefined ? { maxHeight: size.maxHeight } : {}),
  };
}

/** عنوان الورقة المنسدلة */
export function sheetTitleStyle(c: ThemeColors, marginBottom: number = space.md): TextStyle {
  return {
    color: c.text,
    fontSize: font.title,
    fontWeight: '700',
    textAlign: 'right',
    marginBottom,
  };
}

/**
 * فوتر لاصق تحت فورم قابل للتمرير — زرارات الحفظ/الإلغاء بتتحط برّه الـ
 * ScrollView (مش آخر عنصر جواه)، فتفضل مثبتة فوق الكيبورد دايمًا مهما طال
 * المحتوى، من غير ما المستخدم يلف يدوّر عليها. اتعمل بعد ما زرار الحفظ في
 * مودال العملية وDebtPaymentModal وDebtIncreaseModal اختفى تحت الكيبورد لما
 * AmountPreview زوّدت طول الفورم.
 */
export function stickyFooterStyle(c: ThemeColors, bg: string, extraBottom: number = 0): ViewStyle {
  return {
    flexDirection: 'row-reverse',
    gap: space.md,
    padding: space.xxxl,
    paddingBottom: space.xxxl + extraBottom,
    borderTopWidth: 1,
    borderTopColor: c.borderStrong,
    backgroundColor: bg,
  };
}

/** خانة المبلغ البطل (مودال العملية والاشتراك والجمعية): الرقم هو البطل، وحافة ≥ 3:1 (`controlEdge`) */
export function bigAmountInputStyle(c: ThemeColors): TextStyle {
  return {
    backgroundColor: c.surface2,
    borderWidth: 1.5,
    borderColor: c.controlEdge,
    borderRadius: radius.lg,
    color: c.text,
    fontSize: typeScale.hero,
    fontWeight: '700',
    paddingHorizontal: space.xxl,
    paddingVertical: space.md,
  };
}

/** دايرة التقدّم (`ProgressRing`، ميزانية التخطيط): القطر وسُمك الخط، و`compact` للكارت الضيق (كارت الشهر في الرئيسية) */
export const progressRing = { size: 64, stroke: 7, durationMs: 600, compact: { size: 44, stroke: 5 } } as const;

/**
 * رفعة الكارت (الفاتح بس): ظل خفيف دافي بدل إطار — التباين surface/bg في الفاتح 1.13:1 والكروت كانت مسطّحة.
 * في الغامق `shadow` = null فمفيش حاجة بتتضاف. ممنوع على صفوف القوايم والشرايح والسيجمنت وأي خلفية شفافة/selectedBg.
 * الكارت اللي عليه `overflow: 'hidden'` بيتلف بـView برّاني شايل الظل (iOS بيقص الظل).
 */
export function cardElevation(c: { shadow: string | null }): ViewStyle {
  if (!c.shadow) return {};
  return { shadowColor: c.shadow, shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 };
}
