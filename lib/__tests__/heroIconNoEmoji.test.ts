import { readFileSync } from 'fs';
import { join } from 'path';
import * as tokens from '@/lib/tokens';

/** موجة البريميم 6: الإيموجي الكبير الزخرفي اتبدّل بـ`HeroIcon` في الترحيب و"نبدأ بإيه؟" والحالة الفاضية */
const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');
const FILES = ['components/OnboardingScreen.tsx', 'components/FirstRunSetup.tsx', 'app/(tabs)/index.tsx'];
const EMOJI = /[\u{1F300}-\u{1FAFF}]/u;

describe('مفيش إيموجي زخرفي كبير', () => {
  it('ثوابت الإيموجي الكبير اتشالت من tokens', () => {
    expect('onboardingEmoji' in tokens.glyphSize).toBe(false);
    expect('emptyEmoji' in tokens.glyphSize).toBe(false);
    expect(tokens.heroIconSize).toEqual({ welcome: 80, setup: 64, empty: 56, inline: 40 });
  });
  it.each(['components/OnboardingScreen.tsx', 'components/FirstRunSetup.tsx'])('%s: مفيش إيموجي في الكود ولا ثابت حجمه', (f) => {
    const src = read(f);
    expect(src).not.toMatch(EMOJI);
    expect(src).not.toMatch(/glyphSize\.(onboardingEmoji|emptyEmoji)|SETUP_EMOJI_SIZE|bigEmoji/);
  });
  it('الحالة الفاضية في الرئيسية بقت HeroIcon مش 👛', () => {
    const src = read(FILES[2]);
    expect(src).not.toContain('👛');
    expect(src).toContain('<HeroIcon');
  });
});
