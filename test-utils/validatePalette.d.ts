/** أنواع لفاحص الباليتة المنقول (الملف نفسه جافاسكريبت زي ما هو من السكيل) */

/** صف في التقرير: [اسم الفحص، الحالة، التفاصيل] */
export type PaletteCheck = [name: string, state: boolean | string, detail: string];

export type PaletteReport = {
  report: PaletteCheck[];
  /** false لو أي فحص فشل فشل حقيقي (التحذيرات مبتوقعهاش) */
  ok: boolean;
};

export function validate(
  palette: string[],
  options?: { mode?: 'light' | 'dark'; surface?: string; pairs?: 'adjacent' | 'all' }
): PaletteReport;

export function validateOrdinal(
  palette: string[],
  options?: { mode?: 'light' | 'dark'; surface?: string }
): PaletteReport;

export function contrast(a: string, b: string): number;
