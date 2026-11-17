import { AccessibilityInfo } from 'react-native';
import { renderHook, act } from '@testing-library/react-native';
import { REDUCE_MOTION_ANSWER_TIMEOUT_MS, useReduceMotionKnown } from '@/lib/useReduceMotion';

describe('useReduceMotionKnown — النظام ما ردّش', () => {
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  it('بعد المهلة بيرجع false بدل null للأبد (الدايرة متفضلش فاضية)', async () => {
    jest.useFakeTimers();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockReturnValue(new Promise<boolean>(() => {}));
    const { result } = await renderHook(() => useReduceMotionKnown());
    expect(result.current).toBeNull();
    await act(async () => { jest.advanceTimersByTime(REDUCE_MOTION_ANSWER_TIMEOUT_MS); });
    expect(result.current).toBe(false);
  });

  it('لو النظام ردّ بـtrue قبل المهلة، المهلة متغيّرش الإجابة', async () => {
    jest.useFakeTimers();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const { result } = await renderHook(() => useReduceMotionKnown());
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toBe(true);
    await act(async () => { jest.advanceTimersByTime(REDUCE_MOTION_ANSWER_TIMEOUT_MS); });
    expect(result.current).toBe(true);
  });
});
