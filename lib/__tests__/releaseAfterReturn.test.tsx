import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { RELEASE_AFTER_RETURN_MS, useReleaseAfterReturn } from '@/lib/useReleaseAfterReturn';

/**
 * Feature 9 — الجولة الأخيرة: وعد `shareAsync` ممكن ميرجعش خالص (المستقبِل اتقفل غلط، أندرويد قتل الـchooser)، فزرار
 * التصدير كان بيفضل بيلف للأبد. المستخدم رجع للتطبيق والزرار لسه شغال بعد `RELEASE_AFTER_RETURN_MS` ← بيتفك.
 */
let emit: (s: AppStateStatus) => void = () => {};
beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_t, cb) => {
    emit = cb as (s: AppStateStatus) => void;
    return { remove: jest.fn() } as never;
  });
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

it('شغال، راح الخلفية ورجع ← بعد المهلة بيتفك', async () => {
  const release = jest.fn();
  await renderHook(() => useReleaseAfterReturn(true, release));
  await act(async () => { emit('background'); emit('active'); });
  await act(async () => { jest.advanceTimersByTime(RELEASE_AFTER_RETURN_MS - 1); });
  expect(release).not.toHaveBeenCalled();
  await act(async () => { jest.advanceTimersByTime(1); });
  expect(release).toHaveBeenCalledTimes(1);
});

it('خلص قبل المهلة ← مبيتفكش تاني', async () => {
  const release = jest.fn();
  const { rerender } = await renderHook(({ busy }: { busy: boolean }) => useReleaseAfterReturn(busy, release), { initialProps: { busy: true } });
  await act(async () => { emit('background'); emit('active'); });
  await rerender({ busy: false });
  await act(async () => { jest.advanceTimersByTime(RELEASE_AFTER_RETURN_MS * 2); });
  expect(release).not.toHaveBeenCalled();
});

it('مش شغال ← الرجوع للتطبيق مبيعملش حاجة', async () => {
  const release = jest.fn();
  await renderHook(() => useReleaseAfterReturn(false, release));
  await act(async () => { emit('background'); emit('active'); jest.advanceTimersByTime(RELEASE_AFTER_RETURN_MS * 2); });
  expect(release).not.toHaveBeenCalled();
});
