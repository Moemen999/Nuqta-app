import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import CategoryIconPicker, { ICON_PICKER_KEYBOARD_HINT } from '@/components/CategoryIconPicker';
import { ThemeProvider } from '@/context/ThemeContext';
import { EMOJI_INPUT_MESSAGES } from '@/lib/emojiIcon';

/**
 * سلوك الشيت: الأيقونة المكررة **مش ممنوعة** — الحفظ بيحصل، والشيت بيفضل
 * مفتوح بسطر هادي واقتراح. والأيقونة من الكيبورد بتاخد أول إيموجي بس.
 */

const others = [{ name: 'أكل', icon: '🍔' }, { name: 'مواصلات', icon: '🚗' }];

async function mount(current?: string) {
  const onPick = jest.fn();
  const onClose = jest.fn();
  await render(
    <ThemeProvider>
      <CategoryIconPicker visible current={current} others={others} onPick={onPick} onClose={onClose} />
    </ThemeProvider>,
  );
  return { onPick, onClose };
}

describe('أيقونة مستخدمة في فئة تانية', () => {
  it('بتتحفظ، والشيت بيفضل مفتوح بالملاحظة والاقتراح', async () => {
    const { onPick, onClose } = await mount();
    await act(async () => { fireEvent.press(screen.getByTestId('icon_pick_🍔')); });
    expect(onPick).toHaveBeenCalledWith('🍔');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('الأيقونة دي مستخدمة في أكل')).toBeTruthy();
    expect(screen.getByTestId('icon_pick_suggestion')).toBeTruthy();
  });

  it('الاقتراح بيحفظ البديل ويقفل', async () => {
    const { onPick, onClose } = await mount();
    await act(async () => { fireEvent.press(screen.getByTestId('icon_pick_🍔')); });
    await act(async () => { fireEvent.press(screen.getByTestId('icon_pick_suggestion')); });
    expect(onPick).toHaveBeenCalledTimes(2);
    expect(['🍔', '🚗']).not.toContain(onPick.mock.calls[1][0]);
    expect(onClose).toHaveBeenCalled();
  });

  it('أيقونة مش مستخدمة ← بتتحفظ والشيت بيقفل على طول', async () => {
    const { onPick, onClose } = await mount();
    await act(async () => { fireEvent.press(screen.getByTestId('icon_pick_🎁')); });
    expect(onPick).toHaveBeenCalledWith('🎁');
    expect(onClose).toHaveBeenCalled();
  });
});

describe('أيقونة من الكيبورد', () => {
  it('فاضي ← سطر بيقول يدوس على 😊، وحفظ مقفول', async () => {
    await mount();
    await act(async () => { fireEvent.press(screen.getByTestId('icon_pick_keyboard')); });
    expect(screen.getByText(ICON_PICKER_KEYBOARD_HINT)).toBeTruthy();
    expect(screen.getByTestId('icon_keyboard_save').props.accessibilityState.disabled).toBe(true);
  });

  it('حرف ← رسالة واضحة وحفظ مقفول', async () => {
    const { onPick } = await mount();
    await act(async () => { fireEvent.press(screen.getByTestId('icon_pick_keyboard')); });
    await act(async () => { fireEvent.changeText(screen.getByTestId('icon_keyboard_input'), 'م'); });
    expect(screen.getByText(EMOJI_INPUT_MESSAGES['not-emoji'])).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId('icon_keyboard_save')); });
    expect(onPick).not.toHaveBeenCalled();
  });

  it('عيلة + كلام بعدها ← المعاينة بالعيلة بس، والحفظ بيبعتها هي', async () => {
    const { onPick, onClose } = await mount();
    await act(async () => { fireEvent.press(screen.getByTestId('icon_pick_keyboard')); });
    await act(async () => { fireEvent.changeText(screen.getByTestId('icon_keyboard_input'), '👨‍👩‍👧🍕'); });
    expect(screen.getByText('خدنا أول إيموجي بس.')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId('icon_keyboard_save')); });
    expect(onPick).toHaveBeenCalledWith('👨‍👩‍👧');
    expect(onClose).toHaveBeenCalled();
  });

  it('الأيقونة الحالية لو من برّه القايمة بتبان في خانة الكيبورد', async () => {
    await mount('🦄');
    expect(screen.getByText('🦄')).toBeTruthy();
  });
});
