import { Platform } from 'react-native';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sentry from '@sentry/react-native';
import { exportFailure, ShareUnavailableError, writeAndShare } from '@/lib/exportFiles';

/**
 * Feature 9 — الجولة الأخيرة (HIGH، المشكّك أكّدها): على أندرويد `shareAsync` بيرجع لما الـchooser يخلص، **قبل** ما
 * التطبيق المستقبِل (حفظ Drive، Quick Share، تيليجرام) يقرا الملف. المسح بعدها على طول كان بيبعت ملف مش موجود.
 * - أندرويد: بعد مشاركة نجحت الملف **بيفضل**، وبيتكنس في أول التصدير الجاي (قبل كتابة الجديد) وأول ما التطبيق يفتح
 *   والخروج. iOS: بيتمسح على طول (المشاركة هناك بتاخد نسخة قبل ما ترجع).
 * - الكتابة أو المشاركة رمت ← بيتمسح على المنصتين.
 * - الفشل: لوج باسم الخطأ وكوده بس، وحدث Sentry من غير أي بيانات.
 */
jest.mock('@sentry/react-native', () => ({ captureMessage: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/', documentDirectory: 'file:///docs/',
  writeAsStringAsync: jest.fn(async () => {}), deleteAsync: jest.fn(async () => {}),
  readDirectoryAsync: jest.fn(async () => []),
}));

const NEW = 'nuqta-export-all-2026-11-19.xlsx';
const OLD = 'nuqta-export-all-2026-11-18.xlsx';
const deleted = () => (FileSystem.deleteAsync as jest.Mock).mock.calls.map(c => c[0]);

beforeEach(() => {
  jest.clearAllMocks();
  (FileSystem.readDirectoryAsync as jest.Mock).mockImplementation(async (dir: string) => (dir === 'file:///cache/' ? [OLD] : []));
});
afterEach(() => { jest.restoreAllMocks(); });

describe('أندرويد', () => {
  beforeEach(() => { jest.replaceProperty(Platform, 'OS', 'android'); });

  it('مشاركة نجحت ← الملف الجديد مبيتمسحش (المستقبِل لسه هيقراه)', async () => {
    await writeAndShare('AAAA', NEW, 'تصدير');
    expect(Sharing.shareAsync).toHaveBeenCalledWith(`file:///cache/${NEW}`, expect.anything());
    expect(deleted()).not.toContain(`file:///cache/${NEW}`);
  });

  it('الملف القديم بيتكنس في أول التصدير — قبل كتابة الجديد', async () => {
    const order: string[] = [];
    (FileSystem.deleteAsync as jest.Mock).mockImplementation(async (u: string) => { order.push(`del ${u}`); });
    (FileSystem.writeAsStringAsync as jest.Mock).mockImplementation(async (u: string) => { order.push(`write ${u}`); });
    await writeAndShare('AAAA', NEW, 'تصدير');
    expect(order).toEqual([`del file:///cache/${OLD}`, `write file:///cache/${NEW}`]);
  });

  it('المشاركة رمت ← الملف بيتمسح', async () => {
    (Sharing.shareAsync as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    await expect(writeAndShare('AAAA', NEW, 'تصدير')).rejects.toThrow('boom');
    expect(deleted()).toContain(`file:///cache/${NEW}`);
  });

  it('الكتابة رمت ← الملف بيتمسح', async () => {
    (FileSystem.writeAsStringAsync as jest.Mock).mockRejectedValueOnce(new Error('ENOSPC'));
    await expect(writeAndShare('AAAA', NEW, 'تصدير')).rejects.toThrow('ENOSPC');
    expect(deleted()).toContain(`file:///cache/${NEW}`);
  });
});

describe('iOS', () => {
  beforeEach(() => { jest.replaceProperty(Platform, 'OS', 'ios'); });
  it('مشاركة نجحت ← الملف بيتمسح على طول', async () => {
    await writeAndShare('AAAA', NEW, 'تصدير');
    expect(deleted()).toContain(`file:///cache/${NEW}`);
  });
});

describe('الفشل: اسم الخطأ وكوده بس، وحدث Sentry من غير بيانات', () => {
  it('لوج فيه name وcode من غير الرسالة (المسار)، وcaptureMessage بالتاج', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const e = Object.assign(new Error('ENOSPC: /data/user/0/secret/nuqta.xlsx'), { code: 'ERR_FILESYSTEM' });
    exportFailure(e, 'period export');
    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain('Error');
    expect(logged).toContain('ERR_FILESYSTEM');
    expect(logged).not.toContain('/data/user');
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [msg, ctx] = (Sentry.captureMessage as jest.Mock).mock.calls[0];
    expect(msg).not.toContain('/data/user');
    expect(JSON.stringify(ctx)).not.toContain('/data/user');
    expect(ctx).toEqual(expect.objectContaining({ tags: expect.objectContaining({ export_kind: 'period export', export_error: 'Error', export_code: 'ERR_FILESYSTEM' }) }));
  });

  it('المشاركة مش متاحة ← حدث Sentry برضه (ده موبايل مش هيعرف يصدّر خالص)', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    exportFailure(new ShareUnavailableError(), 'full export');
    expect(Sentry.captureMessage).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      tags: expect.objectContaining({ export_error: 'ShareUnavailableError' }),
    }));
  });
});
