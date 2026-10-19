# Study: `feat/installment-residue` — mergeability and the three open decisions

> **الحالة:** جديد — لسه محدش رد عليه
> **مين كتبه:** Claude Code (cloud session, read-only study)
> **التاريخ:** 2026-10-19
> **السؤال:** هل فرع `feat/installment-residue` لسه ينفع يتدمج على `main`، وإيه الخيارات وتكلفتها في القرارات التلاتة المستنية مؤمن (D1، D2، D3)؟

**Labels:** **[VERIFIED]** = read from the repo (file:line) · **[SOURCE]** = outside source with a link · **[JUDGEMENT]** = opinion / inference (= **(استنتاج)** in `reports/README.md` terms). Nothing in this report is a decision.

**Snapshot:** `main` = `0f04f5b`, `origin/feat/installment-residue` = `e6fb27e`. Cloud container — `npm run test:db` was **not** run (environmental failures in this container are known). No merge, rebase, build, or deploy was done.

---

## TL;DR

- **Part 1:** **small rework** — 2 textual conflicts (both mechanical), no semantic clash with the archived-wallet guards or the font wrapper. Not "green" until `test:db` runs on the merged result on the laptop.
- **D1:** the rounding cap makes **dust instalments** (e.g. a 13th instalment of 0.07–0.09) after a few-piastre increase. Money is correct; the count and suggestion are the problem.
- **D2:** mixed old/new app versions **can write a wrong stored `installmentCount` and `installmentResidue`** (metadata). **No stored money amount** (payments, increases, totals, transactions, balances) is ever wrong.
- **D3:** deleting a linked transaction from the transaction modal changes the instalment count **silently**; the debt screen path does tell the user.
- **Part 3:** `test:db` 292/292 on the branch is recorded nowhere in the repo; the branch already contains the `DataContext` guard that main's item 15 lists as still open; four non-debt forms are still unguarded against "1e999".

---

## Step 0 — Lock + sync

- No `.agent-lock` existed (`ls: cannot access '.agent-lock'`). Nothing deleted, no lock taken (per the session's instruction).
- [VERIFIED] `main` = `origin/main` = **0f04f5b**; `origin/feat/installment-residue` = **e6fb27e**.

---

## Part 1 — Can the branch still be merged?

**Method:** `git merge-tree --write-tree` only (writes no working tree, index, or refs). `git merge --no-commit` was **not** used.

[VERIFIED] Merge base = `b04422e`, which is PR #2's tip; `git diff b04422e 7f9030b` is empty. So PR #2 is **already fully inside the branch**; only three of the four "moves" are new to it: the guards round (`dd40bb6`), the Infinity fix (`ea47f3e`), and the font wrapper (`3e23fb9`).

### Conflicts (2 files)

1. **`components/DebtEntryModals.tsx` — 4 hunks, all the Infinity fix.**
   - Hunk 1, imports (:14): main adds `isValidDebtAmount`; the branch adds `toMoneyAmount`, `planInstallments`, `storableCount`, `suggestedInstallmentPayment`, `INSTALLMENT_VALUE_TOO_SMALL`.
   - Hunks 2–4: the same three lines on both sides — payment (main :93), increase (:208), new debt (:330).
     - main: `isValidDebtAmount(Number(x))` — finite and > 0 only.
     - branch: `toMoneyAmount(Number(x))` — **rounds to the piastre first, then checks**; also rejects 0.004 and 1e307 (which becomes Infinity after rounding).
   - [JUDGEMENT] The branch version is a strict superset. Resolution = take the branch lines and keep `isValidDebtAmount` exported, since main's `lib/__tests__/debtAmountGuard.test.tsx:9` imports it. Its behavioural cases (0.01 accepted; 1e999/NaN/0/−5 rejected) should also pass with `toMoneyAmount` — **unrun**.
2. **`TIMELINE.md` — 4 hunks:** the map block (section 1 status, items 6–9, section 8) and the top of the log. Union resolution: main's map + the branch's facts; the branch's three 2026-09-30 rows go below main's 2026-10-18/19 rows.

### The branch's 11 files vs. main since the merge base [VERIFIED]

| File | Changed on main? | What main changed |
|---|---|---|
| `components/DebtEntryModals.tsx` | yes — **conflict** | `isValidDebtAmount` (:94/:210/:331), AppText import, testIDs `debt_add_person`/`debt_add_amount`, `lineHeight` 16→17 |
| `app/(tabs)/debts.tsx` | yes — auto-merges | AppText import, `lineHeight` |
| `app/dev-seed.tsx`, `app/user-guide.tsx` | yes — auto-merges | AppText import only |
| `lib/finance.ts` | yes — auto-merges | only adds `isValidDebtAmount` (:391–400) |
| `TIMELINE.md` | yes — **conflict** | — |
| `context/DataContext.tsx` | **no** | zero lines changed since the merge base |
| 4 branch test files | no | — |

### Semantic overlap

- **(a) Archived-wallet guards — none in code.**
  - [VERIFIED] `cascadeDeleteBlock` already existed at the merge base. Main's round added `walletDeleteBlock` (`lib/archiving.ts:166`), changes in `ArchivedSettlement.tsx`, and `wallets.tsx`. The branch touches none of them.
  - Only meeting point: deleting a linked transaction. `app/modal.tsx:139` now runs `settle.request(...)` → `deleteTransaction` → `stageReconcile`, and the branch adds residue/count fields to the debt patch inside `stageReconcile` (branch `DataContext.tsx:1161`). Count metadata only — never balances or settlements.
  - [JUDGEMENT] Should be safe. Whether main's `settlementBlocked.emulator.test.tsx` asserts exact debt-document fields is unchecked → **needs the laptop**.
- **(b) Infinity fix — yes, the same three lines.** That *is* the conflict above; resolving it is choosing an approach, not combining both.
- **(c) Font wrapper — no regression.**
  - [VERIFIED] In the merged tree all six branch source files keep `import { Text… } from '@/components/AppText'`.
  - A grep for `Text`/`TextInput` imported from `react-native`, or for `fontFamily`, across the branch's files found nothing.
  - The branch's new tests are under `__tests__`, which `lib/__tests__/appFont.test.tsx:34` skips.
  - `renderDataProvider(extra?)` changed on main in a compatible way (optional parameter).

### Verdict

**Small rework:** resolve 2 conflicts → `npx tsc --noEmit`, `npm test`, and `npm run test:db` on the merged result **on the laptop**.

---

## Part 2 — The three open decisions

To check numbers instead of guessing, both versions of `lib/finance.ts` (branch and main) were compiled in the session scratchpad and the `DataContext` write paths were replayed by hand. Because the write paths were copied by hand, the simulated figures below are **[JUDGEMENT]-grade until the laptop tests confirm them**.

### D1 — The cap counts the whole plan's instalments, not the remaining ones

**Where** [VERIFIED, branch `lib/finance.ts`]:

- `isRoundingResidue` (:851): `|amount| ≤ 0.005 × over`, where `over` = full instalments in the plan.
- Pass → the last instalment absorbs the residue (`installmentResidueOf`, :837). Fail → the residue reads as 0 and `installmentsLeft` (:791) adds an instalment.

**What happens** (1000 over 12 → 83.33, residue 0.04, cap 0.06) — simulated:

| Increase | Result (branch) | main's old rule (0.5%) |
|---|---|---|
| +0.01 | 12, last 83.38 | 12 |
| +0.02 | 12, last 83.39 | 12 |
| +0.03 | **13th instalment of 0.07** | 12 |
| +0.05 | **13th instalment of 0.09** | 12 |
| +1.00 | 13 | 13 |

Same result whether the increase comes before any payment or after 11 payments.

- **Who:** anyone who adds a few piastres to an instalment debt (rounding a payment up, a small fee). They see "القسط 13 من 13" for 7–9 piastres.
- **Money:** no stored amount is wrong. The count and the suggestion are. It fails the project bar (no surprising money behaviour): a dust instalment the user has to pay.
- [JUDGEMENT] Switching the cap to the **remaining** instalments makes it *stricter* at the end of a plan (0.005 × 1), so it does not fix this. The real question is how the threshold is defined.

**Options (owner decides):**

| # | Option | Cost |
|---|---|---|
| 1 | Keep as written | Consistent and tested; dust instalments stay |
| 2 | Leftover < X folds into the last instalment (e.g. X = 1 EGP, or % of instalment) | A new number to justify — conflicts with the 2026-09-29 decision "متخترعش حد تاني"; new review round |
| 3 | Any leftover < one instalment folds into the last one ("odd final payment") | Last instalment can be almost 2× normal; must be said to the user (copy) |
| 4 | Ask the user when it happens | New copy and flow |

**[SOURCE]:**

- US Regulation Z official staff commentary to 12 CFR §1026.17(c)(3): creditors may ignore whole-cent effects because *"the amount of the last payment may require adjustment to account for the rounding of the other payments to whole cents."* Reached **only as a quote** on an industry forum — [BankersOnline thread](https://www.bankersonline.com/forum/ubbthreads.php/topics/2153574/re-whole-number-for-total-of-interest-paid). Verify against [eCFR Part 1026](https://www.ecfr.gov/current/title-12/chapter-X/part-1026) / [Fed staff commentary page](https://www.federalreserve.gov/frrs/regulations/consumer-financial-protection-bureaus-official-staff-commentary-on-regulation-z.htm). Supports "last instalment absorbs rounding"; silent on dust instalments.
- Martin Fowler's Money **allocate** pattern (*Patterns of Enterprise Application Architecture*): leftover cents are spread so none are lost. Seen only via secondary write-ups: [Verraes](https://verraes.net/2011/04/fowler-money-pattern-in-php/), [go-money](https://github.com/rhymond/go-money).
- **Not determined:** no authoritative source found on "sane" caps for instalment counts or amounts.

### D2 — Mixed old and new app versions can flip the residue (most important)

Old installs (1.0.0.000 / .002 / .003 on testers' phones) know nothing about `installmentResidue`. They write **patches**, so they don't delete the field either — a stale value stays on the document.

- [VERIFIED] `firestore.rules:124–147` does not check this field.
- [VERIFIED] `expo-updates` was rejected (`TIMELINE.md:227`), so an old APK can stay installed indefinitely.
- [VERIFIED] The card shows the **stored** count (`installmentProgress`, branch `lib/finance.ts:722–728`).

**What each mix does** (simulated, 1000/12 created by the new version):

| Sequence | Stored result | Correct |
|---|---|---|
| **Old** adds +500 | count 18 (old rule); residue still `{0.04, over 12}` | new code now computes 19 (stale residue) |
| …then **new** deletes that +500 | **count 13 written**; residue `{0.02, over 6}` written | 12, last 83.37 |
| Old +100, then new deletes it | **count 13**; residue `{−16.63, over 11}` | 12 |
| Old +0.05, then new deletes it | **count 13**; residue `{−0.01}` | 12 |
| **New** adds an increase, **old** deletes it | `storedResidue` sees plan > total → ignored → old rule (+ log line) | safe fallback, as designed |
| **Old** pays suggested 83.33 × 12 | count 12, 0.04 still open | pre-branch bug; new code then suggests 0.04 |

**Wrong stored number, or only a wrong display — precisely:**

- **Yes, stored values go wrong — metadata only:** `installmentCount` and `installmentResidue`. Later writes from the new version do **not** heal them; once 13 is stored it stays.
- **No stored money amount goes wrong.** [VERIFIED] On the branch, the residue feeds only the count (`installmentsLeft`), the suggestion (`suggestedInstallmentPayment`), and message text. Payments, increases, `totalAmount`, transactions, and balances never read it.
- **What the user sees:** a phantom instalment of 0.02–0.04 at the end; the modal pre-fills 83.33 where 83.37 would close the debt.
- **Who is exposed:** one user on two devices with different versions, or a tester who never updates.

**[SOURCE] — established patterns:**

- **Expand / contract (parallel change):** add the new shape, migrate, contract only when every client has moved — [Fowler, ParallelChange](https://www.martinfowler.com/bliki/ParallelChange.html). [JUDGEMENT] On mobile, "every client has moved" is unknowable without a version gate.
- **Minimum-version gate:** block or prompt old builds from the cloud — [Firebase: Enforce a minimum app version with Remote Config](https://firebase.google.com/docs/remote-config/use-cases/minimum-version); Play's [In-app updates (immediate)](https://developer.android.com/guide/playcore/in-app-updates). [JUDGEMENT] A gate only works for builds that already ship the check — today's APKs don't.
- **Compatibility taxonomy:** [Google AIP-180](https://google.aip.dev/180) — source / wire / semantic compatibility. [JUDGEMENT] This case is *semantic*: old clients write valid documents but break a meaning newer data depends on.
- **Version number per record:** [Kleppmann, DDIA ch. 5 "Encoding and Evolution"](https://www.oreilly.com/library/view/designing-data-intensive-applications/9781098119058/ch05.html) — reached only through a summary.
- **Not found:** official Firestore guidance on backfill / migration.

**Options for this app (none picked):**

| # | Option | Cost |
|---|---|---|
| 1 | Accept and document | Phantom piastre instalments for mixed-version users; money stays correct and the error is bounded |
| 2 | Detect stale data on read: store something old versions *do* change (e.g. increase count or a hash of `increases`) inside `installmentResidue`; mismatch → ignore residue, old rule | Schema change + re-review + tests; mixed-version debts lose the improvement but are never wrong. Same idea as `forInstallment`, extended |
| 3 | Ship a minimum-version gate first; residue in a later build | Two builds, a gate design (Remote Config or a Firestore field), testers forced to update; useless for phones that never update |
| 4 | Lazy repair: new writes recompute the residue from full history instead of folding a delta | Requires the residue to be derivable — exactly what step 5 got wrong ("مبنستنتجش فرق"); riskiest |
| 5 | Server-side repair (Cloud Function) | New infrastructure, paid tier; still races with old clients |
| 6 | Don't merge until no old builds remain | No way to know when that is |

### D3 — Deleting a linked transaction doesn't warn that the count will change

[VERIFIED] Current behaviour on `main`:

- Transaction-modal delete: `app/modal.tsx:126–139` → `transactionLinkWarning` (`context/DataContext.tsx:1244–1249`) says only "هتتشال من الدين كمان".
- `stageReconcile` (`context/DataContext.tsx:1119–1137`) then recounts and writes `installmentCount` with no message before or after.
- The same deletion from the debt screen **does** state the count change: `app/(tabs)/debts.tsx:149–154` → `debtEntryDeletePlan` / `debtEntryDeleteMessage` (`lib/finance.ts:805` / `:854`). The user guide says it always does.

**Why it matters:** a silent money-related change, against the project bar. The amount isn't wrong; the count is, and nothing tells the user. Predates the branch — the branch only adds the residue to the same patch.

**Options (product / copy decision first; research secondary):**

| # | Option | Cost |
|---|---|---|
| 1 | Reuse `debtEntryDeletePlan` inside `transactionLinkWarning` so the warning matches the debt screen | One money-path change + new copy (`arabic-copy-reviewer`; money path → `money-reviewer` + `silent-failure-hunter`) |
| 2 | Show a notice after the delete | Modal is already closed — needs the root `useNotice` |
| 3 | Leave it; correct the user guide | Inconsistency stays |

**Overlap with merged work:** this is the same delete path that now goes through the archived-settlement sheet (`app/modal.tsx:138`, `components/ArchivedSettlement.tsx:59`). A count line would sit next to or inside that two-step flow — the copy for both should be designed together.

---

## Part 3 — What's on the branch that `main` doesn't record

[VERIFIED] `main`'s TIMELINE says only that the branch's rows live on the branch (`TIMELINE.md:12`, `:26`). It does **not** record:

- **`npm run test:db` 292/292 on this branch** — nowhere in the repo (no grep hit for "292"); the branch's own rows still say "⏳ مستني `test:db`". It exists only in the owner's conversation.
- The three 2026-09-30 rows:
  - `toMoneyAmount` and `storableCount`;
  - the fold model (`over`);
  - the changed example: 1000.29 + 2000 over 60, then deleting the increase → **21**, not 20;
  - the deliberate leftover: deleting an increase through its linked transaction is not atomic — a concurrent increase from another device loses its shift;
  - `over ≤ 0` read as a real fraction;
  - pre-field debts stay on the 0.5% rule.
- D1 / D2 / D3 as pending owner decisions.
- Open NITs: fixed `dev-seed` message for any rejection; modal `catch` doesn't log; `addDebt` doesn't check the count on non-instalment debts; source-text tests fragile to rewording.
- The 9 emulator tests in `context/__tests__/installmentResidue.emulator.test.tsx`.
- **Main's item 15 lists "guard in `DataContext`" as still open — the branch already has it:** `addDebt`, `addDebtPayment`, `addDebtIncrease` all go through `toMoneyAmount`.

### Infinity — is `ea47f3e` complete?

[VERIFIED] It covers only the three debt modals. Still open on `main`:

- **Debt write paths:** `addDebt` (`context/DataContext.tsx:1288`) and `addDebtPayment` (`:1374`) don't check at all; `addDebtIncrease` (`:1535`) checks `isFinite` only. The modals accept 1e307 (finite; overflows only when rounded) and 0.004.
- **The four non-debt forms (confirmed):**
  - `app/modal.tsx:87` — `!amt || amt <= 0`; Infinity passes and an Infinity transaction amount reaches the rules.
  - `components/SubscriptionsView.tsx:153` (add) and `:322` (edit) — same check. (The owner's :152 / :321 are the `Number()` lines one above.)
  - `components/GamiyaView.tsx:180` — same check for `monthly` and `payout`. `totalMonths` = "1e999" also passes, but `Array.from({ length: Infinity })` throws `RangeError` in `addGamiya` (`context/DataContext.tsx:2103`; checked in node) — not stored; the user gets an error instead.
  - Adjacent: `customDays: Number(customDays) || 30` (`components/SubscriptionsView.tsx:158` / `:331`) lets Infinity through as a day count.
- **Already guarded** [VERIFIED]: `IncomesView` (via `validateIncomeDraft`, `lib/recurringIncome.ts:211`), `components/ChargeHomeCards.tsx:276`, `components/IncomeHomeCards.tsx:191`, wallet / budget input (`parseBudgetInput`).

---

## Not determined / needs the laptop

**Needs the laptop:**

- `npm run test:db` on the merged result.
- Whether `settlementBlocked.emulator.test.tsx` asserts exact debt fields.
- Whether Firestore rules accept `Infinity > 0` (emulator).
- `npx tsc --noEmit` and `npm test` on the merged tree.
- Confirming the simulated D1/D2 figures with real tests.

**Not determined:**

- Authoritative sources on instalment-count / amount caps, and official Firestore migration guidance.
- The official Reg Z wording — seen only as a forum quote (CFPB, Fowler, and Firebase pages couldn't be fetched from the cloud container; their content here is from search results).
- How many old APKs are actually in use.

## Sources with a commercial interest

- Firebase and Android docs are Google documenting its own products.
- BankersOnline is an industry forum.
- go-money is open source; Verraes is a personal blog.

## What this study did not do

No repo file changed during the study; nothing committed, pushed, merged, rebased, or deployed; no build; no `test:db`. `main` stayed at `0f04f5b`, the branch at `e6fb27e`. No lock existed, none was taken. (This report file itself was added afterwards at the owner's request.)
