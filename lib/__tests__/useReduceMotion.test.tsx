import { AccessibilityInfo } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { useReduceMotion } from '@/lib/useReduceMotion';

it('useReduceMotion: يقرا القيمة، يتابع التغيير، ويشيل الاشتراك', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  const remove = jest.fn();
  let cb: ((v: boolean) => void) | undefined;
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((ev: string, fn: (v: boolean) => void) => {
    if (ev === 'reduceMotionChanged') cb = fn;
    return { remove };
  }) as never);
  const { result, unmount } = await renderHook(() => useReduceMotion());
  await act(async () => { await Promise.resolve(); });
  expect(result.current).toBe(true);
  await act(async () => { cb?.(false); });
  expect(result.current).toBe(false);
  await unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});
