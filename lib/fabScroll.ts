/**
 * منطق اختفاء الزرار العايم "+" مع التمرير (قرار مؤمن 2026-11-16):
 * «يختفي في حالة الحركة فقط». دالة صافية — الحالة والحركة في
 * `context/FabScrollContext.tsx`.
 *
 * **بيرجع أول ما التمرير يقف** (تعديل مؤمن 2026-11-16): بيختفي وانت بتمرّر
 * لتحت وبيرجع لما التمرير يقف (`FAB_SETTLE_MS` بعد آخر حدث) أو أول ما تمرّر لفوق.
 *
 * `anchorY` مش آخر y: لو قارنّا بآخر حدث بس، التمرير البطيء (أقل من العتبة في
 * كل حدث) عمره ما كان هيعدّيها. المرساة بتتحرك بس لما العتبة تتعدّى، وبتتبع القمة
 * (لتحت وهو مستخبي، ولفوق وهو ظاهر) فالرجوع بيتحسب من آخر نقطة وصلها المستخدم.
 */

/** أقل من كده من الشاشة = أول الشاشة، الزرار ظاهر دايمًا */
export const FAB_TOP_ZONE = 24;
/** مسافة التمرير اللي بتغيّر الحالة — أصغر منها اهتزاز مش حركة */
export const FAB_SCROLL_THRESHOLD = 8;

/** بعد آخر حدث تمرير بالمدة دي من غير حدث جديد ← التمرير وقف والزرار يرجع (احتياط الـmomentum) */
export const FAB_SETTLE_MS = 250;

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
