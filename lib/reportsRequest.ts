import type { ComparePreset } from '@/lib/periodCompare';

/**
 * طلب واحد معلّق للتقارير — بدل باراميترز الراوتر. كارت «صرفت الشهر ده» في الرئيسية بيسجّل الطلب وبعدين يفتح تاب
 * التقارير **من غير باراميترز**؛ التقارير بتاخده مرة واحدة لما تتفتح/تاخد الفوكس (`takeReportsRequest`).
 *
 * ليه مش باراميترز: (1) مش مضمون إن Expo Router بيوصّل باراميترز جديدة لتاب متفتح أصلاً — المستخدم كان ممكن يوصل لفترة
 * غير اللي داس عليها من غير ما حد يعرف؛ (2) الباراميترز بتفضل على الراوت، فلو التقارير اتشالت واتركّبت تاني التأثير كان
 * بيشتغل بالـ`at` القديم ويمسح فلتر المستخدم اللي اختاره بعدها. هنا الطلب بيتاخد مرة وبيتمسح، وزيارة عادية للتاب من غير
 * طلب مبتغيّرش أي حاجة.
 */
export type ReportsRequest = { preset: ComparePreset; clearFilter: boolean };

let pending: ReportsRequest | null = null;

export function requestReports(req: ReportsRequest): void {
  pending = { ...req };
}

/** بيرجّع الطلب المعلّق ويمسحه — المرة التانية `null` */
export function takeReportsRequest(): ReportsRequest | null {
  const req = pending;
  pending = null;
  return req;
}
