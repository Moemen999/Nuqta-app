import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { NoticeProvider, useClearNoticesOnAccountChange, useHoldNotices, useNotice } from '@/components/NoticeProvider';
import { ThemeProvider } from '@/context/ThemeContext';

/**
 * قرار مؤمن 2026-11-07: رسالة النتيجة اللي بتوصل والتطبيق مقفول **متظهرش فوق شاشة القفل** (فيها كلام عن الفلوس) —
 * بتستنى في الطابور ومبتضيعش، وبتظهر أول ما القفل يتفتح. و`onDismiss` مبيتناداش غير لما تتقفل فعلًا.
 */
let show: ReturnType<typeof useNotice> = () => {};
function Grab() { show = useNotice(); return null; }
function Gate({ held }: { held: boolean }) { useHoldNotices(held); return null; }

const tree = (held: boolean, withGate = true) => (
  <ThemeProvider><NoticeProvider><Grab />{withGate && <Gate held={held} />}</NoticeProvider></ThemeProvider>
);

it('مقفول ← الرسالة مبتظهرش، ومستنية؛ اتفتح ← بتظهر، و«تمام» بيقفلها وبينادي onDismiss مرة', async () => {
  const onDismiss = jest.fn();
  const view = await render(tree(true));
  await act(async () => { show('الكتابة ما وصلتش', 'جملة', onDismiss); });
  expect(screen.queryByTestId('notice_dialog')).toBeNull();
  expect(onDismiss).not.toHaveBeenCalled();
  await view.rerender(tree(false));
  expect(screen.getByTestId('notice_title')).toHaveTextContent('الكتابة ما وصلتش');
  await act(async () => { fireEvent.press(screen.getByTestId('notice_ok')); });
  expect(onDismiss).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('notice_dialog')).toBeNull();
});

it('رسالة ظاهرة والتطبيق اتقفل ← بتستخبى وترجع بعد الفتح (مش بتتشال)', async () => {
  const view = await render(tree(false));
  await act(async () => { show('t', 'b'); });
  expect(screen.getByTestId('notice_dialog')).toBeTruthy();
  await view.rerender(tree(true));
  expect(screen.queryByTestId('notice_dialog')).toBeNull();
  await view.rerender(tree(false));
  expect(screen.getByTestId('notice_title')).toHaveTextContent('t');
});

it('الماسك اتشال (خروج) ← الرسايل مبتفضلش مستخبية للأبد', async () => {
  const view = await render(tree(true));
  await act(async () => { show('t', 'b'); });
  expect(screen.queryByTestId('notice_dialog')).toBeNull();
  await view.rerender(tree(true, false));
  expect(screen.getByTestId('notice_dialog')).toBeTruthy();
});

it('_layout بيمسك الرسايل وقت شاشة القفل ووقت قراية إعداد القفل', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'app', '_layout.tsx'), 'utf8');
  expect(src).toContain('useHoldNotices(lockLoading || shouldShowLock({ enabled, isLocked, readFailed }))');
  expect(src).toContain('useClearNoticesOnAccountChange(user?.uid ?? null)');
});

function Account({ uid, held }: { uid: string | null; held: boolean }) { useHoldNotices(held); useClearNoticesOnAccountChange(uid); return null; }
const tree2 = (uid: string | null, held: boolean) => (
  <ThemeProvider><NoticeProvider><Grab /><Account uid={uid} held={held} /></NoticeProvider></ThemeProvider>
);

it('«نسيت الكود؟»: خروج + القفل اتفك ← الرسالة المستنية اتشالت ومبتظهرش على شاشة الدخول', async () => {
  const view = await render(tree2('u1', true));
  await act(async () => { show('الكتابة ما وصلتش', 'الدين "صاحبي" ما اتحفظش'); });
  await view.rerender(tree2(null, false));
  expect(screen.queryByTestId('notice_dialog')).toBeNull();
});

it('أول تسجيل دخول (من null) مبيمسحش رسالة اتبعتت قبله', async () => {
  const view = await render(tree2(null, false));
  await act(async () => { show('t', 'b'); });
  await view.rerender(tree2('u1', false));
  expect(screen.getByTestId('notice_dialog')).toBeTruthy();
});
