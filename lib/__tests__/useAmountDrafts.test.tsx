import {
  AUTOSAVE_DELAY_MS,
  NEGATIVE_CONFIRM_NO,
  NEGATIVE_CONFIRM_TITLE,
  NEGATIVE_CONFIRM_YES,
  useAmountDrafts,
} from '@/lib/useAmountDrafts';
import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';

/**
 * الاختبارات دي بتشغّل الهوك الحقيقي عشان تغطي الحاجات اللي مش في الدالة
 * الخالصة: مفيش كتابة قبل التأكيد، الإلغاء بيرجّع المحفوظ، الحفظ التلقائي
 * مبيمسحش اللي المستخدم لسه بيكتبه.
 */

type Store = Record<string, number>;

async function setup(initial: Store) {
  const store: Store = { ...initial };
  const write = jest.fn((id: string, value: number) => { store[id] = value; });
  const view = await renderHook(() => useAmountDrafts(id => store[id] ?? 0, write));
  return { view, write, store };
}

/** بيمسك أزرار آخر ديالوج اتفتح */
function alertButtons() {
  const spy = Alert.alert as unknown as jest.Mock;
  const [, , buttons] = spy.mock.calls[spy.mock.calls.length - 1];
  const find = (text: string) => buttons.find((b: any) => b.text === text);
  return { yes: find(NEGATIVE_CONFIRM_YES), no: find(NEGATIVE_CONFIRM_NO) };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('الخروج من الخانة من غير تغيير', () => {
  it('دوس على الخانة واطلع من غير ما تكتب = مفيش كتابة خالص', async () => {
    const { view, write } = await setup({ w1: 5000 });
    await act(() => { view.result.current.onBlur('w1'); });
    expect(write).not.toHaveBeenCalled();
  });

  it('اكتب نفس الرقم المحفوظ واطلع = مفيش كتابة', async () => {
    const { view, write } = await setup({ w1: 5000 });
    await act(() => { view.result.current.onChange('w1', '5000'); });
    await act(() => { view.result.current.onBlur('w1'); });
    expect(write).not.toHaveBeenCalled();
  });

  it('تغيير حقيقي بيتكتب', async () => {
    const { view, write } = await setup({ w1: 5000 });
    await act(() => { view.result.current.onChange('w1', '7500'); });
    await act(() => { view.result.current.onBlur('w1'); });
    expect(write).toHaveBeenCalledWith('w1', 7500);
  });
});

describe('الكلام اللي مش رقم', () => {
  it('مفيش كتابة، والخانة بترجع للقيمة المحفوظة', async () => {
    const { view, write } = await setup({ w1: 5000 });
    await act(() => { view.result.current.onChange('w1', 'abc'); });
    expect(view.result.current.valueFor('w1', 5000)).toBe('abc');

    await act(() => { view.result.current.onBlur('w1'); });
    expect(write).not.toHaveBeenCalled();
    expect(view.result.current.valueFor('w1', 5000)).toBe('5000');
  });
});

describe('السالب', () => {
  it('من موجب لسالب: بيسأل، ومفيش أي كتابة قبل ما المستخدم يرد', async () => {
    const { view, write } = await setup({ w1: 1000 });
    await act(() => { view.result.current.onChange('w1', '-500'); });
    await act(() => { view.result.current.onBlur('w1'); });

    expect(Alert.alert).toHaveBeenCalled();
    expect((Alert.alert as unknown as jest.Mock).mock.calls[0][0]).toBe(NEGATIVE_CONFIRM_TITLE);
    expect(write).not.toHaveBeenCalled();
  });

  it('"أيوه، سالب" بتكتب الرقم', async () => {
    const { view, write } = await setup({ w1: 1000 });
    await act(() => { view.result.current.onChange('w1', '-500'); });
    await act(() => { view.result.current.onBlur('w1'); });
    await act(() => { alertButtons().yes.onPress(); });

    expect(write).toHaveBeenCalledWith('w1', -500);
  });

  it('"عدّل الرقم" مبتكتبش، والخانة بترجع للمحفوظ', async () => {
    const { view, write } = await setup({ w1: 1000 });
    await act(() => { view.result.current.onChange('w1', '-500'); });
    await act(() => { view.result.current.onBlur('w1'); });
    await act(() => { alertButtons().no.onPress(); });

    expect(write).not.toHaveBeenCalled();
    expect(view.result.current.valueFor('w1', 1000)).toBe('1000');
  });

  it('من سالب لسالب: مفيش سؤال، بيتكتب على طول', async () => {
    const { view, write } = await setup({ w1: -500 });
    await act(() => { view.result.current.onChange('w1', '-900'); });
    await act(() => { view.result.current.onBlur('w1'); });

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith('w1', -900);
  });
});

describe('الحفظ التلقائي (نمط BudgetView)', () => {
  it('بيحفظ الرقم الأكيد بعد ثانية من آخر حرف', async () => {
    const { view, write } = await setup({ w1: 100 });
    await act(() => { view.result.current.onChange('w1', '250'); });
    expect(write).not.toHaveBeenCalled();

    await act(() => { jest.advanceTimersByTime(AUTOSAVE_DELAY_MS); });
    expect(write).toHaveBeenCalledWith('w1', 250);
  });

  it('مبيحفظش السالب لوحده — بيستنى إجابة المستخدم', async () => {
    const { view, write } = await setup({ w1: 100 });
    await act(() => { view.result.current.onChange('w1', '-250'); });
    await act(() => { jest.advanceTimersByTime(AUTOSAVE_DELAY_MS); });

    expect(write).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('مبيمسحش اللي المستخدم لسه بيكتبه — "-" نص طريق مش غلط', async () => {
    const { view, write } = await setup({ w1: 100 });
    await act(() => { view.result.current.onChange('w1', '-'); });
    await act(() => { jest.advanceTimersByTime(AUTOSAVE_DELAY_MS * 3); });

    expect(write).not.toHaveBeenCalled();
    expect(view.result.current.valueFor('w1', 100)).toBe('-');
  });

  it('بيحفظ اللي فاضل وقت ما الشاشة تتشال', async () => {
    const { view, write } = await setup({ w1: 100 });
    await act(() => { view.result.current.onChange('w1', '640'); });
    await view.unmount();

    expect(write).toHaveBeenCalledWith('w1', 640);
  });

  it('مبيحفظش السالب وقت الإزالة — مفيش كتابة من غير تأكيد', async () => {
    const { view, write } = await setup({ w1: 100 });
    await act(() => { view.result.current.onChange('w1', '-640'); });
    await view.unmount();

    expect(write).not.toHaveBeenCalled();
  });
});

describe('عرض القيمة', () => {
  it('الصفر المحفوظ بيتعرض "0" مش خانة فاضية', async () => {
    const { view } = await setup({ w1: 0 });
    expect(view.result.current.valueFor('w1', 0)).toBe('0');
  });

  it('المسوّدة بتتشال بعد الكتابة، فالخانة ترجع تقرا من المحفوظ', async () => {
    const { view, write } = await setup({ w1: 100 });
    await act(() => { view.result.current.onChange('w1', '640'); });
    await act(() => { view.result.current.onBlur('w1'); });

    expect(write).toHaveBeenCalledWith('w1', 640);
    expect(view.result.current.valueFor('w1', 640)).toBe('640');
  });
});
