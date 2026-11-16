import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * جرد تاب الالتزامات (ديون/اشتراكات/جمعية): مفيش `fontSize` ولا `borderRadius`
 * حرفي — المقاسات من `typeScale` و`radius` في `lib/tokens.ts`.
 */
const root = join(__dirname, '..', '..');
const FILES = ['components/SubscriptionsView.tsx', 'components/GamiyaView.tsx', 'app/(tabs)/debts.tsx'];

describe.each(FILES)('%s', (file) => {
  const src = readFileSync(join(root, file), 'utf8');
  it('مفيش fontSize حرفي', () => {
    expect(src.match(/fontSize:\s*[0-9]/g)).toBeNull();
  });
  it('مفيش borderRadius حرفي', () => {
    expect(src.match(/borderRadius:\s*[0-9]/g)).toBeNull();
  });
});
