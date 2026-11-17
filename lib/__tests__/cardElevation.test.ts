import { DARK, LIGHT } from '@/context/ThemeContext';
import { cardElevation } from '@/lib/tokens';

describe('رفعة الكروت', () => {
  it('الفاتح عنده لون ظل والغامق لأ', () => {
    expect(LIGHT.shadow).not.toBeNull();
    expect(DARK.shadow).toBeNull();
  });
  it('الغامق: cardElevation فاضي', () => {
    expect(cardElevation(DARK)).toEqual({});
  });
  it('الفاتح: ظل خفيف بلون الثيم', () => {
    expect(cardElevation(LIGHT)).toMatchObject({ shadowColor: LIGHT.shadow, shadowOpacity: 0.07, elevation: 2 });
  });
  it('controlBg الغامق = surface2 (من غير تغيير) والفاتح = surface', () => {
    expect(DARK.controlBg).toBe(DARK.surface2);
    expect(LIGHT.controlBg).toBe(LIGHT.surface);
    expect(DARK.border).toBe(DARK.surface2);
  });
});
