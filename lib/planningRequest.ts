/**
 * طلب واحد معلّق لتاب التخطيط — نفس فكرة `lib/reportsRequest.ts`. بانر الميزانية في الرئيسية بيسجّل الطلب وبعدين
 * يفتح التخطيط، والتخطيط بياخده مرة واحدة لما ياخد الفوكس ويفتح التاب الفرعي ده. من غيره كان بيفتح على آخر تاب فرعي
 * المستخدم كان فيه (توزيع الدخل أو الدخل الثابت) والبانر كان بيقول «الميزانية» (a11y-architect، الميزة 6).
 */
export type PlanningSection = 'budget' | 'shakhbata' | 'incomes';

let pending: PlanningSection | null = null;

export function requestPlanning(section: PlanningSection): void {
  pending = section;
}

/** بيرجّع الطلب المعلّق ويمسحه — المرة التانية `null` */
export function takePlanningRequest(): PlanningSection | null {
  const req = pending;
  pending = null;
  return req;
}
