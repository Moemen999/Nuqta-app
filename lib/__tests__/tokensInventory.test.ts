import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * جرد التوكنز (موجة البريميم 2): الشاشات اللي اتنقلت مفيش فيها `fontSize` ولا
 * `borderRadius` حرفي — المقاسات من `typeScale` و`radius` في `lib/tokens.ts`.
 * القايمة بتكبر مع كل شاشة تتنقل.
 */
const root = join(__dirname, '..', '..');
const FILES = [
  // تاب الالتزامات
  'components/SubscriptionsView.tsx', 'components/GamiyaView.tsx', 'app/(tabs)/debts.tsx',
  // مودال العملية، الدين، الدخل، كروت الرئيسية، أول تجهيز، الإشعارات
  'app/modal.tsx', 'components/DebtEntryModals.tsx', 'components/IncomesView.tsx',
  'components/ChargeHomeCards.tsx', 'components/IncomeHomeCards.tsx',
  'components/FirstRunSetup.tsx', 'app/settings-screens/notifications.tsx',
];

describe.each(FILES)('%s', (file) => {
  const src = readFileSync(join(root, file), 'utf8');
  it('مفيش fontSize حرفي', () => {
    expect(src.match(/fontSize:\s*[0-9]/g)).toBeNull();
  });
  it('مفيش borderRadius حرفي', () => {
    expect(src.match(/borderRadius:\s*[0-9]/g)).toBeNull();
  });
});
