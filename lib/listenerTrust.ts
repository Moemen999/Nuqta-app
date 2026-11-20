/**
 * snapshot نقدر نبني عليه كتابة؟ (الميزة 6، الجولة الأخيرة — money-reviewer + silent-failure-hunter)
 *
 * snapshot فاضي **من الكاش** مش معناه إن المستخدم مالوش سقوف/دخل/نسب — معناه إننا لسه ما سألناش السيرفر (فتحة باردة من
 * غير نت: الكاش في الذاكرة بس). الخانة لو اتفتحت ساعتها كانت هتكتب فوق رقم المستخدم الحقيقي وهو مش شايفه. فيه بيانات
 * (حتى من الكاش) = اتشافت؛ من السيرفر = الإجابة الحقيقية حتى لو فاضية.
 */
export function snapshotTrusted(s: { fromCache: boolean; hasData: boolean }): boolean {
  return s.hasData || !s.fromCache;
}
