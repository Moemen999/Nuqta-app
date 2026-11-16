/**
 * الطابور المحلي المتشفّر (`lib/outbox.ts`) — الجزء الصافي بس: التشفير والفك والقراية وخطة الإعادة.
 * التصميم: reports/2026-11-16-outbox-design.md
 */
import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import {
  OUTBOX_MAX, OUTBOX_PREFIX, canPersistMore, hasLinkFields, mergePatch, openEntry, outboxSecureKeyName, outboxStorageKey,
  parseStorageKey, parseStored, planReplay, rejectedReplayBody, sealEntry, unreadableReplayBody, type StoredEntry,
} from '@/lib/outbox';

const rng = (n: number) => new Uint8Array(randomBytes(n));
const KEY = rng(32);
const UID = 'userA';
const TX = 'tx123';
const DATA = { type: 'expense', amount: 4321.5, walletId: 'w1', categoryId: 'c1', note: 'سرّ المصروف', date: '2026-11-15', createdAt: '2026-11-15T10:00:00.000Z' };

function seal(over: Partial<Parameters<typeof sealEntry>[0]> = {}) {
  return sealEntry({ uid: UID, txId: TX, data: DATA, sid: 's1', savedAt: '2026-11-15', key: KEY, rng, ...over });
}

describe('seal/open', () => {
  it('round trip بيرجّع نفس البيانات', () => {
    const r = openEntry(seal(), UID, TX, KEY);
    expect(r).toEqual({ ok: true, data: DATA });
  });

  it('uid تاني ← unreadable (الـAAD مربوط بالحساب)', () => {
    expect(openEntry(seal(), 'userB', TX, KEY)).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('id تاني ← unreadable (مينفعش تتنقل لمستند تاني)', () => {
    expect(openEntry(seal(), UID, 'otherTx', KEY)).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('مفتاح تاني أو مفيش مفتاح ← unreadable', () => {
    expect(openEntry(seal(), UID, TX, rng(32))).toEqual({ ok: false, reason: 'unreadable' });
    expect(openEntry(seal(), UID, TX, null)).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('نص متلاعب فيه ← unreadable', () => {
    const s = seal();
    const flipped = s.c.slice(0, 10) + (s.c[10] === '0' ? '1' : '0') + s.c.slice(11);
    expect(openEntry({ ...s, c: flipped }, UID, TX, KEY)).toEqual({ ok: false, reason: 'unreadable' });
    const nflip = s.n.slice(0, 4) + (s.n[4] === '0' ? '1' : '0') + s.n.slice(5);
    expect(openEntry({ ...s, n: nflip }, UID, TX, KEY)).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('الـnonce جاي من الـrng اللي اتبعت، 24 بايت، ومبيتكررش', () => {
    const fixed = new Uint8Array(24).fill(7);
    const calls: number[] = [];
    const s = seal({ rng: n => { calls.push(n); return fixed.slice(0, n); } });
    expect(calls).toEqual([24]);
    expect(s.n).toBe('07'.repeat(24));
    const a = seal();
    const b = seal();
    expect(a.n).not.toBe(b.n);
    expect(a.c).not.toBe(b.c);
  });

  it('النص المخزّن مفيهوش المبلغ ولا الملاحظة ولا المحفظة', () => {
    const json = JSON.stringify(seal());
    expect(json).not.toContain('4321');
    expect(json).not.toContain('سرّ');
    expect(json).not.toContain(encodeURIComponent('سرّ').slice(0, 9));
    expect(json).not.toContain('w1');
    expect(json).not.toContain('expense');
    expect(Object.keys(JSON.parse(json)).sort()).toEqual(['alg', 'c', 'n', 'savedAt', 'sid', 'v']);
  });
});

describe('parseStored', () => {
  const good = () => JSON.parse(JSON.stringify(seal())) as Record<string, unknown>;
  it('بيقبل الشكل الصح', () => {
    const g = good();
    expect(parseStored(JSON.stringify(g))).toEqual(g);
  });
  it.each([
    ['null', null],
    ['مش JSON', '{oops'],
    ['مصفوفة', '[]'],
    ['نسخة تانية', JSON.stringify({ ...good(), v: 2 })],
    ['خوارزمية تانية', JSON.stringify({ ...good(), alg: 'aes-gcm' })],
    ['sid مش نص', JSON.stringify({ ...good(), sid: 5 })],
    ['savedAt ناقص', JSON.stringify({ ...good(), savedAt: undefined })],
    ['nonce قصير', JSON.stringify({ ...good(), n: 'abcd' })],
    ['nonce مش hex', JSON.stringify({ ...good(), n: 'zz'.repeat(24) })],
    ['نص مشفّر فاضي', JSON.stringify({ ...good(), c: '' })],
    ['نص مشفّر مش hex', JSON.stringify({ ...good(), c: 'xyz' })],
  ])('بيرفض: %s', (_n, raw) => {
    expect(parseStored(raw as string | null)).toBeNull();
  });
});

describe('planReplay', () => {
  const e = (txId: string, sid: string) => ({ txId, stored: { ...seal(), sid } as StoredEntry });
  it('بيتخطّى مدخلات الجلسة الحالية', () => {
    const plan = planReplay([e('a', 'old'), e('b', 'now'), e('c', 'older')], 'now');
    expect(plan.map(x => x.txId)).toEqual(['a', 'c']);
  });
  it(`بحد ${OUTBOX_MAX}`, () => {
    const many = Array.from({ length: OUTBOX_MAX + 5 }, (_, i) => e(`t${i}`, 'old'));
    expect(planReplay(many, 'now')).toHaveLength(OUTBOX_MAX);
  });
});

describe('مساعدات', () => {
  it('المفتاح في AsyncStorage فيه الـuid والـid، وبيتقري تاني', () => {
    const k = outboxStorageKey(UID, TX);
    expect(k).toBe(`${OUTBOX_PREFIX}${UID}:${TX}`);
    expect(parseStorageKey(k)).toEqual({ uid: UID, txId: TX });
    expect(parseStorageKey('nuqta-cold:userA')).toBeNull();
    expect(parseStorageKey(`${OUTBOX_PREFIX}onlyuid`)).toBeNull();
  });

  it('اسم مفتاح SecureStore في الحروف المسموحة بس', () => {
    expect(outboxSecureKeyName('ab'.repeat(32))).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(outboxSecureKeyName('ab'.repeat(32))).toBe(`nuqta_outbox_k_${'ab'.repeat(32)}`);
  });

  it('canPersistMore بيقف عند الحد', () => {
    expect(canPersistMore(OUTBOX_MAX - 1)).toBe(true);
    expect(canPersistMore(OUTBOX_MAX)).toBe(false);
  });

  it('mergePatch بيدمج ويشيل undefined', () => {
    expect(mergePatch({ amount: 100, note: 'x', categoryId: 'c' }, { amount: 120, categoryId: undefined }))
      .toEqual({ amount: 120, note: 'x', categoryId: 'c' });
  });

  it('hasLinkFields بيمسك كل حقول الربط', () => {
    expect(hasLinkFields(DATA)).toBe(false);
    for (const f of ['incomeId', 'subscriptionId', 'gamiyaId', 'periodKey', 'isSettlement', 'archivedWalletId', 'autoRecorded']) {
      expect(hasLinkFields({ ...DATA, [f]: f === 'isSettlement' || f === 'autoRecorded' ? true : 'x' })).toBe(true);
    }
  });

  it('رسالة الرفض فيها المبلغ والتاريخ', () => {
    expect(rejectedReplayBody(150, '2026-11-12', '2026-11-16'))
      .toBe('عملية 150 يوم 12 نوفمبر كانت مستنية النت واترفضت لما حاولنا نرفعها. سجّلها تاني من "+".');
  });

  it('رسالة "مقدرناش نقراها" بالعدد والتاريخ', () => {
    expect(unreadableReplayBody(1, '2026-11-12', '2026-11-16'))
      .toBe('كان فيه عملية واحدة متسجلة على الموبايل وما اترفعتش، ومقدرناش نقراها تاني. بصّ على مصاريفك من يوم 12 نوفمبر وسجّل اللي ناقص.');
    expect(unreadableReplayBody(2, '2026-11-12', '2026-11-16')).toContain('كان فيه عمليتين متسجلين على الموبايل وما اترفعوش، ومقدرناش نقراهم تاني');
    expect(unreadableReplayBody(3, '2025-12-30', '2026-11-16')).toContain('كان فيه 3 عمليات متسجلة على الموبايل وما اترفعتش');
    expect(unreadableReplayBody(3, '2025-12-30', '2026-11-16')).toContain('من يوم 30 ديسمبر 2025');
  });
});

describe('جرد: `durable` من مودال العملية الجديدة بس', () => {
  const root = path.resolve(__dirname, '../..');
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of fs.readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.') || name === '__tests__') continue;
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  }
  it('مفيش ملف تاني بيطلب durable', () => {
    const users = ['app', 'components', 'lib', 'hooks', 'context']
      .flatMap(d => walk(path.join(root, d)))
      .filter(f => /durable:\s*true/.test(fs.readFileSync(f, 'utf8')))
      .map(f => path.relative(root, f));
    expect(users).toEqual(['app/modal.tsx']);
  });
});

describe('رسالة الخروج', () => {
  it('بتقول العدد وإنها هتضيع', () => {
    const { outboxLogoutSentence } = require('@/lib/outbox');
    expect(outboxLogoutSentence(1)).toBe('فيه عملية واحدة متسجلة على الموبايل ولسه ما اترفعتش — لو خرجت دلوقتي هتضيع.');
    expect(outboxLogoutSentence(2)).toBe('فيه عمليتين متسجلين على الموبايل ولسه ما اترفعوش — لو خرجت دلوقتي هيضيعوا.');
    expect(outboxLogoutSentence(5)).toContain('فيه 5 عمليات');
  });
});
