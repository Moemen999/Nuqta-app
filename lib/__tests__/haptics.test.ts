import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * الاهتزاز الخفيف (2026-11-07): على أندرويد اهتزاز النظام (`performAndroidHapticsAsync`) مش الهزاز، والفشل مبيوقّعش حاجة،
 * ومحدش بيستدعي `expo-haptics` غير `lib/haptics.ts` — عشان «مش مع كل دوسة» تفضل قرار في مكان واحد.
 */
const mockHaptics = {
  performAndroidHapticsAsync: jest.fn(async (_t?: string) => {}),
  selectionAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  AndroidHaptics: { Clock_Tick: 'clock-tick', Confirm: 'confirm', Reject: 'reject', Context_Click: 'context-click', Long_Press: 'long-press' },
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
};
jest.mock('expo-haptics', () => mockHaptics);

function load(os: 'android' | 'ios', version = 31) {
  jest.resetModules();
  jest.doMock('react-native', () => ({ Platform: { OS: os, Version: version } }));
  return require('@/lib/haptics') as typeof import('@/lib/haptics');
}

beforeEach(() => { for (const f of [mockHaptics.performAndroidHapticsAsync, mockHaptics.selectionAsync, mockHaptics.notificationAsync]) f.mockClear(); });

it('أندرويد: اهتزاز النظام بالنوع الصح، ومن غير الهزاز — والتابة نوع موجود في كل النسخ (مش segment-tick 14+)', () => {
  const h = load('android');
  h.hapticSelect(); h.hapticSuccess(); h.hapticError();
  expect(mockHaptics.performAndroidHapticsAsync.mock.calls).toEqual([['clock-tick'], ['confirm'], ['reject']]);
  expect(mockHaptics.notificationAsync).not.toHaveBeenCalled();
});

it('آيفون: selection وnotification', () => {
  const h = load('ios');
  h.hapticSelect(); h.hapticSuccess(); h.hapticError();
  expect(mockHaptics.selectionAsync).toHaveBeenCalledTimes(1);
  expect(mockHaptics.notificationAsync.mock.calls).toEqual([['success'], ['error']]);
});

it('الاهتزاز فشل (جهاز من غير موتور) ← الرفض متمسوك (مش unhandledRejection)', async () => {
  const h = load('android');
  const rejected = Promise.reject(new Error('no vibrator'));
  const caught = jest.spyOn(rejected, 'catch');
  mockHaptics.performAndroidHapticsAsync.mockImplementationOnce(() => rejected);
  h.hapticSuccess();
  expect(caught).toHaveBeenCalled();
  await new Promise(r => setImmediate(r));
});

it('الموديول رمى على طول (مش وعد مرفوض) ← مبيطلعش برّه', () => {
  const h = load('android');
  mockHaptics.performAndroidHapticsAsync.mockImplementationOnce(() => { throw new Error('native module missing'); });
  expect(() => h.hapticSuccess()).not.toThrow();
});

it('محدش بيستورد expo-haptics غير lib/haptics.ts', () => {
  const root = join(__dirname, '..', '..');
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (['node_modules', '.git', '__tests__', 'android', 'ios', '.expo'].includes(name)) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|jsx?)$/.test(name) && /['"]expo-haptics['"]/.test(readFileSync(p, 'utf8'))) offenders.push(p.slice(root.length + 1));
    }
  };
  for (const d of ['app', 'components', 'context', 'lib', 'hooks']) walk(join(root, d));
  expect(offenders.map(p => p.replace(/\\/g, '/'))).toEqual(['lib/haptics.ts']);
});

it('أندرويد أقدم من 11 (API 29): مبيبعتش confirm/reject أصلًا — بيبعت النوع اللي موجود (الرفض مبيتمسكش في expo-haptics)', () => {
  const h = load('android', 29);
  h.hapticSelect(); h.hapticSuccess(); h.hapticError();
  expect(mockHaptics.performAndroidHapticsAsync.mock.calls).toEqual([['clock-tick'], ['context-click'], ['long-press']]);
});

it('مفيش نوع 14+ (segment-tick وأخواته) بيتبعت في أي نسخة', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'haptics.ts'), 'utf8');
  const code = src.split('\n').filter((l: string) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
  expect(code).not.toMatch(/Segment_Tick|Segment_Frequent_Tick|Gesture_Start|Gesture_End|Toggle_On|Toggle_Off|Drag_Start|Keyboard_Press|Keyboard_Release|Virtual_Key_Release|No_Haptics|Text_Handle_Move/);
});
