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
} as const;

/**
 * أصغر هدف لمس مقبول. أي حاجة بتتدوس لازم توصل للرقم ده — إما بارتفاع/عرض
 * فعلي أو بـ hitSlop. زرار جهات الاتصال كان ~26 وده كان صعب يتلمس، والثابت
 * ده موجود عشان الحالة دي تبقى ملحوظة بالـ grep مش مستنية حد يشتكي.
 */
export const MIN_TOUCH = 44;

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
