import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { NoticeProvider, useHoldNotices, useNotice } from '@/components/NoticeProvider';
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
});
