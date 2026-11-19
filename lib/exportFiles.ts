import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

/**
 * كتابة ملف التصدير ومشاركته — **للتصديرين** (الفترة والكامل في `app/archive.tsx`). الملف فيه بيانات مالية كاملة:
 * - بيتكتب في الكاش (مش مجلد التطبيق الدائم)، و**بيتمسح بعد المشاركة** (Feature 9 بند 3) — المشاركة بتاخد نسخة.
 * - المشاركة مش متاحة ← **فشل** بجملة ثابتة، ومفيش ملف بيتكتب أصلاً. قبل كده كان بيتكتب ويتقال للمستخدم مسار الكاش —
 *   مكان مش هيوصله، وهيتمسح.
 * - الخروج من الحساب ومسحه بيكنسوا أي ملف فاضل (`sweepExportFiles` — مشاركة اتقطعت في النص مثلاً).
 */

/** نتيجة التصدير لما ميكملش — جمل ثابتة مش نص الخطأ الخام */
export const EXPORT_FAIL: Record<'failed' | 'no-share', [string, string]> = {
  failed: ['الملف ما اتعملش', 'حصلت مشكلة وإحنا بنجهّز الملف. جرّب تاني.'],
  'no-share': ['الملف ما اتعملش', 'مقدرناش نفتح المشاركة على الموبايل ده، فالملف ما اتحفظش في أي حتة.'],
};

export class ShareUnavailableError extends Error {
  constructor() { super('share-unavailable'); this.name = 'ShareUnavailableError'; }
}

/** كل ملفات التصدير اسمها كده (`nuqta-export-…`، `nuqta-all-data-…`) — الكنس مبيلمسش غيرها */
export const EXPORT_FILE_RE = /^nuqta-.*\.xlsx$/;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const errName = (e: unknown) => (e instanceof Error ? e.name : 'unknown');

function baseDirs(): string[] {
  const fs = FileSystem as unknown as { cacheDirectory?: string | null; documentDirectory?: string | null };
  return [fs.cacheDirectory, fs.documentDirectory].filter((d): d is string => !!d);
}

async function removeFile(uri: string) {
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch (e) {
    // الملف ممكن يفضل لحد الكنس الجاي (الخروج) — اسم الخطأ بس، من غير المسار
    console.warn('[export] cleanup failed', errName(e));
  }
}

/** بيرمي `ShareUnavailableError` أو خطأ الكتابة/المشاركة — والملف بيتمسح في الحالتين */
export async function writeAndShare(base64: string, filename: string, dialogTitle: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new ShareUnavailableError();
  // الكاش الأول؛ من غير مجلد خالص ← خطأ صريح مش مسار نسبي ساكت
  const baseDir = baseDirs()[0];
  if (!baseDir) throw new Error('no-directory');
  const uri = `${baseDir}${filename}`;
  try {
    await FileSystem.writeAsStringAsync(uri, base64, { encoding: 'base64' });
    await Sharing.shareAsync(uri, { mimeType: XLSX_MIME, dialogTitle });
  } finally {
    await removeFile(uri);
  }
}

/** الرسالة المناسبة لخطأ من `writeAndShare` (أو من تجهيز الملف قبله) — واللوج باسم الخطأ بس */
export function exportFailure(e: unknown, logTag: string): [string, string] {
  console.warn(`[export] ${logTag} failed`, errName(e));
  return e instanceof ShareUnavailableError ? EXPORT_FAIL['no-share'] : EXPORT_FAIL.failed;
}

/** بيمسح أي ملف تصدير فاضل في الكاش ومجلد التطبيق — مبيرميش أبدًا (الخروج مبيقفش عليه) */
export async function sweepExportFiles(): Promise<void> {
  for (const dir of baseDirs()) {
    let names: string[];
    try {
      names = await FileSystem.readDirectoryAsync(dir);
    } catch (e) {
      console.warn('[export] sweep read failed', errName(e));
      continue;
    }
    for (const name of names) if (EXPORT_FILE_RE.test(name)) await removeFile(`${dir}${name}`);
  }
}
