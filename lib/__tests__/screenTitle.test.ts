import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * جرد عنوان الشاشة: كل شاشة بتعرض عنوانها بـ`ScreenTitle` (حجم `typeScale.title`
 * ودور `header` من مكان واحد)، ومفيش `fontSize: 18` ولا `styles.title` محلي.
 */
const root = join(__dirname, '..', '..');
const SCREENS = [
  'app/settings-screens/lock.tsx',
  'app/settings-screens/wallets.tsx',
  'app/settings-screens/categories.tsx',
  'app/settings-screens/about.tsx',
  'app/settings-screens/feedback.tsx',
  'app/settings-screens/notifications.tsx',
  'app/settings-screens/delete-account.tsx',
  'app/(tabs)/debts.tsx',
  'app/(tabs)/reports.tsx',
  'app/(tabs)/settings.tsx',
  'app/archive.tsx',
  'app/person-ledger.tsx',
  'app/user-guide.tsx',
  'app/modal.tsx',
  'app/dev-seed.tsx',
];

describe('عنوان الشاشة', () => {
  it.each(SCREENS)('%s بيستخدم ScreenTitle من غير حجم حرفي', (file) => {
    const src = readFileSync(join(root, file), 'utf8');
    expect(src).toContain('<ScreenTitle');
    expect(src).not.toMatch(/fontSize:\s*18\b/);
    expect(src).not.toMatch(/styles\.title\b/);
  });

  it('ScreenTitle على typeScale.figure وبدور header', () => {
    const src = readFileSync(join(root, 'components/ScreenTitle.tsx'), 'utf8');
    expect(src).toContain('typeScale.figure');
    expect(src).toContain('accessibilityRole="header"');
  });
});
