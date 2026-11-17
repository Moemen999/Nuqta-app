/**
 * منطق اختفاء الزرار العايم "+" مع التمرير (قرار مؤمن 2026-11-16):
 * «يختفي في حالة الحركة فقط». دالة صافية — الحالة والحركة في
 * `context/FabScrollContext.tsx`.
 *
 * **بيرجع بعد عُشر ثانية من ما الشاشة تقف** (تعديل مؤمن 2026-11-16، بعد تجربة
 * 1.0.0.027): لو الصباع اترفع والشاشة بتتزحلق (momentum) الزرار فاضل مستخبي طول
 * التزحليق — كل `onScroll` بيعيد تسليح مهلة `FAB_SETTLE_MS`، فمبتخلصش غير لما
 * الأحداث تقف (من غير اعتماد على `onMomentumScrollEnd` لوحده). رفع من غير
 * تزحليق ← بعد `FAB_SETTLE_MS` من رفع الصباع. التزحليق لفوق بيظهره (زي أي تمرير لفوق).
 *
 * `anchorY` مش آخر y: لو قارنّا بآخر حدث بس، التمرير البطيء (أقل من العتبة في
 * كل حدث) عمره ما كان هيعدّيها. المرساة بتتحرك بس لما العتبة تتعدّى، وبتتبع القمة
 * (لتحت وهو مستخبي، ولفوق وهو ظاهر) فالرجوع بيتحسب من آخر نقطة وصلها المستخدم.
 */

/** أقل من كده من الشاشة = أول الشاشة، الزرار ظاهر دايمًا */
export const FAB_TOP_ZONE = 24;
/** مسافة التمرير اللي بتغيّر الحالة — أصغر منها اهتزاز مش حركة */
export const FAB_SCROLL_THRESHOLD = 8;

/** بعد آخر حدث تمرير (أو رفع الصباع من غير تزحليق) بالمدة دي ← الزرار يرجع */
export const FAB_SETTLE_MS = 100;

export type FabScrollState = { anchorY: number; visible: boolean };

export function fabScrollStep(anchorY: number, y: number, visible: boolean): FabScrollState {
  // أول الشاشة (وأي y سالب من الـbounce في iOS) ← ظاهر
  if (!Number.isFinite(y) || y <= FAB_TOP_ZONE) return { anchorY: Math.max(0, Number.isFinite(y) ? y : 0), visible: true };
  const dy = y - anchorY;
  if (dy > FAB_SCROLL_THRESHOLD) return { anchorY: y, visible: false };
  if (dy < -FAB_SCROLL_THRESHOLD) return { anchorY: y, visible: true };
  // تحت العتبة: الحالة زي ما هي، والمرساة بتتبع القمة في اتجاه الحالة الحالية
  if (!visible && y > anchorY) return { anchorY: y, visible };
  if (visible && y < anchorY) return { anchorY: y, visible };
  return { anchorY, visible };
}

/** الحالة الجاية بس (من غير مرساة): للقراية والاختبار */
export function nextFabVisible(prevY: number, y: number, visible: boolean): boolean {
  return fabScrollStep(prevY, y, visible).visible;
}

/** التمرير وقف ← الزرار ظاهر دايمًا، والمرساة زي ما هي */
export function fabScrollStopped(anchorY: number): FabScrollState {
  return { anchorY, visible: true };
}
