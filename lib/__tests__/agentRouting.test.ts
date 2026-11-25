// توزيع الموديلات إضافة فوق الوكلاء، مش بديل (طلب مؤمن 2026-11-25).
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..', '.claude');
const mdFiles = (dir: string) =>
  fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.md') && f !== 'README.md');
const modelOf = (dir: string, name: string) =>
  fs.readFileSync(path.join(root, dir, `${name}.md`), 'utf8').match(/^model:\s*(\S+)/m)?.[1];

describe('توزيع الموديلات', () => {
  it('مفيش وكيل اتشال: 29 شغّال + 44 متوقّف', () => {
    expect(mdFiles('agents').length).toBeGreaterThanOrEqual(29);
    expect(mdFiles('parked-agents').length).toBeGreaterThanOrEqual(44);
  });

  it('المهارات فاضلة', () => {
    expect(fs.readdirSync(path.join(root, 'skills')).length).toBeGreaterThanOrEqual(288);
  });

  it.each(['money-reviewer', 'silent-failure-hunter', 'security-reviewer', 'database-reviewer'])(
    '%s على opus',
    (name) => expect(modelOf('agents', name)).toBe('opus'),
  );

  it('كل وكيل شغّال متحدد له موديل', () => {
    for (const f of mdFiles('agents')) {
      expect([f, modelOf('agents', f.replace(/\.md$/, ''))]).toEqual([f, expect.stringMatching(/^(haiku|sonnet|opus)$/)]);
    }
  });

  it('القاعدة في CLAUDE.md بتقول إنها إضافة', () => {
    const kit = fs.readFileSync(path.join(root, 'team-kit', 'ROUTING.md'), 'utf8');
    expect(kit).toContain('مش بديل');
  });
});
