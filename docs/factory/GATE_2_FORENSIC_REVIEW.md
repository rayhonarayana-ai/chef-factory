# CHEF FACTORY — GATE 2 — FORENSIC REVIEW (سجل المراجعة الجنائية)

**الأمر:** MASTER FORENSIC AUDIT PROMPT V1.0 — مراجعة جنائية صارمة لقبعة GATE 2 (SECURITY GUARDIAN)
**التاريخ:** 2026-08-16
**بيئة التشغيل:** Windows (PowerShell 5.1) · node v24.19.0 (portable) · Supabase CHEF FACTORY DB (`dybyidtcyzgliupzzfhl`, eu-west-1) · PG 17.6
**المبدأ الحاكم:** EVIDENCE BEFORE CLAIMS — لا تصنيف LIVE_VERIFIED دون تحقق فعلي؛ إصلاح فقط للأعطال الحتمية الآمنة اللازمة لصلاحية Gate 2؛ لا Gate 3؛ توقف إجباري بعد التصنيف.

---

## 1. هوية المصنع (FACTORY_IDENTITY) — VERIFIED

| الفحص | الأمر | النتيجة |
|---|---|---|
| الحزمة | `package.json` | name=`chef-factory` · version=0.1.0 · type=module |
| أسرار البيئة | `.env` (352 بايت، git-ignored) | مفاتيح **حصرية**: `FACTORY_DB_PASSWORD` · `FACTORY_SUPABASE_URL` · `FACTORY_SUPABASE_ANON_KEY` |
| URL | `FACTORY_SUPABASE_URL` | host = `dybyidtcyzgliupzzfhl.supabase.co` |
| ANON key | تحليل المقطع الثالث (JWT HS256) | موقَّع · صالح الشكل · لا يُطبع أبدًا |
| الاتصال الحي | سكربت tsx عبر `src/db/config.ts` | **CONNECTED** — `postgres.dybyidtcyzgliupzzfhl` · db=`postgres` · PG 17.6 |
| جداول Gate 2 الستة | استعلام حي | موجودة: critical_actions=**17** · security_policies=**13** · events/incidents/lockdowns/rate_limits=0 |
| تسريب دوال اختبار | استعلام حي | `TEST_HELPER_FUNCTIONS_LEAKED=[]` |
| عزل المجلد | فحص مسار | repo مستقل تمامًا؛ Qarayti.ai/PROOFOS غائبتان؛ `tadbir` مجلد شقيق منفصل |

> ملاحظة جنائية: الاسم الفعلي للجدول هو `critical_actions` (وليس `security_critical_actions`). العدّاد الأولي
> استهدف الاسم غير الصحيح فارتفعت نتائج الفحص الأولي كإيجابية خاطئة ثم صُحّح الاستعلام.

---

## 2. المنهجية

لكل ادعاء: **المعيار + الأمر الفعلي + الإخراج الحرفي** في سجل التحقق (§11). لا حكم "COMPLETE".
التصنيفات المقبولة: `IMPLEMENTED / TESTED / LIVE_VERIFIED / UNVERIFIED / BLOCKED / NOT_APPLICABLE`.

---

## 3. تدقيق قاعدة البيانات الجنائي (PHASE 3) — قبل الإصلاح

| الفحص | النتيجة الحية |
|---|---|
| جداول public | 23 جدولًا، **كلها RLS ON** · `RLS_DISABLED: NONE` |
| سياسات `security_events` | select_owner + insert_owner فقط (بلا update/delete) |
| سياسات `critical_actions` / `security_policies` | select_all فقط (قراءة فقط) |
| سياسات `security_incidents` / `security_rate_limits` | CRUD مالك كامل |
| سياسات `security_lockdowns` | insert/select/update مالك — بلا delete |
| دوال SECURITY DEFINER | كلها ملك `postgres` · `search_path=public` |
| محفّزات الأمان | ملك postgres؛ رفض update/delete على السجلّات القابلة للتغيير |
| منح Supabase الافتراضية | anon/authenticated تملك DML على مستوى الجدول (يشمل TRIGGER/TRUNCATE) — النموذج الطبيعي لـ Supabase؛ التطبيق عبر RLS |

---

## 4. العيب الحرج G2-1 — TRUNCATE يخترق RLS (مُثبَت حيًا، ثم مُصلَح)

### الحقائق
- في PostgreSQL **لا يخضع TRUNCATE لـ RLS**، ولا تُطلق عليه محفّزات `FOR EACH ROW`.
- منح Supabase الافتراضية (`trigger`) تعادل صراحةً `TRUNCATE` للحرف `authenticated`.

### الإثبات المباشر (بصفة `authenticated`، قبل الإصلاح)
```
TRUNCATE public.security_events      → SUCCESS (مسح كل الأحداث — بما فيها سجلّات الدفاع)
TRUNCATE public.critical_actions     → SUCCESS (اختراق سجل الإجراءات الحرجة "المنيع")
UPDATE  public.security_events       → 0 rows (RLS يعمل على UPDATE — تأكيد الفجوة مقتصرة على TRUNCATE)
```

### الإصلاح — `supabase/migrations/20260818000000_security_truncate_hardening.sql`
1. دالة `block_security_table_truncate()` (SECURITY DEFINER · search_path=public).
2. محفّزات `before truncate ... for each statement` على **7 جداول**:
   `security_events` (يعيد استعمال `block_security_event_mutation`) · `critical_actions`
   (`block_critical_action_mutation`) · `security_lockdowns` (`block_lockdown_deletion`) ·
   `security_incidents` / `security_rate_limits` / `security_policies` / `audit_events`
   (`block_security_table_truncate` / `block_audit_mutation`).
3. `REVOKE TRUNCATE, TRIGGER ON <7 جداول> FROM anon, authenticated`.

### التحقق بعد الإصلاح (ثنائي الطبقة)
| الدور | النتيجة |
|---|---|
| `authenticated` → TRUNCATE على الجداول السبعة | `permission denied` (منع الامتياز) |
| `postgres` (superuser) → TRUNCATE على الجداول السبعة | مرفوض بمحفّزات بأسماء رسائل صريحة |
| رسائل المحفّزات | "security_events is append-only" · "critical_actions registry is immutable" · "security_lockdowns is history; rows cannot be deleted" · "security table truncation is blocked" · "audit_events is append-only" |

```
MIGRATION_APPLIED 20260818000000_security_truncate_hardening.sql (247ms)
```
> الخلاصة: G2-1 **مُصلَح + LIVE_VERIFIED** (طبقتا الامتياز والمحفّز معًا، عبر 7 جداول).

---

## 5. العيب الثانوي G2-2 — rlsProbe (تمييز سجلّي append-only)

- **قبل:** `rlsProbe` في `src/db/repo.ts` كان يستنتج `auditAppendOnly` و`securityEventsAppendOnly`
  معًا من استعلام `EXISTS` واحد على `c.relname in ('audit_events','security_events')` → غير
  دقيق (أي اسم يعطي نفس القيمة للاثنين).
- **بعد:** فُصل إلى استعلامين مستقلين (EXISTS لكل جدول) — `src/db/repo.ts` (~698–715).
- **التصنيف:** مُصلَح + TESTED (النوع سليم + المجموعة خضراء).

---

## 6. سلاسل التفويض والتوليف (PHASE 4–6)

- **الهوية:** JWT → `AuthService.verifyOwner` (Supabase Auth `getUser` + owners عبر عميل
  RLS-scoped + status=`active`) → `owner.id` يُطبَع في كل استدعاءات store → عزل RLS. **حتمي**.
- **التوليف:** `evaluateAuthority` (Gate 1) ثم `evaluatePolicy` (Gate 2) ثم
  `guardianCombineAuthority` (ترقية فقط). `SECURITY_PRECEDENCE`:
  LOCKDOWN > DENY > REQUIRE_APPROVAL > NOTIFY > ALLOW. **لا مسار يلغي DENY.**
- **إثبات عدم التخفيض:** اختبارات الدمج الجديدة (§8) — command مالي عبر guardian لا ينزل
  عن `require_approval`.
- **الوكيل:** `agentHasPermission` قبل أي تنفيذ؛ تخطّي بيئة/مشروع → DENY؛ لا تفعيل lockdown.

---

## 7. المحقّقون الحتميون في الـ Guardian (تأكيد)

| المكوّن | التحقق |
|---|---|
| 13 قاعدة سياسة | securityGuardian.test.ts (41) — مغطاة |
| 17 قاعدة سجل حرجة + تطابق DB | 17 صفًا حيًا + S1 |
| lockdown fail-closed + تحرير المالك حصريًا | T-tests + حي (تحرير الوكيل مرفوض) |
| 7 نطاقات معدّل | T-tests + S6 |
| حماية تكلفة | T-tests |
| كشف الشذوذ (عتبات) | T-tests |
| حارس الأسرار + redaction | T-tests + حي |
| دفاع حقن + `modelOutputIsAuthority` (LLM = DATA) | T-tests (يتضمن:427) |
| أحداث/حوادث/صحة | T-tests + S2/S4 + حي (rlsProbe) |

---

## 8. إثبات دمج Guardian في الـ Pipeline (اختبارات جديدة حتمية)

أُضيفت 3 اختبارات إلى `src/core/pipeline.test.ts` (18 → بعد الإضافة):
1. **lockdown نشط → fail closed عبر الـ pipeline:** outcome=`denied` · سبب يحوي lockdown ·
   `audit security.guardian_denied` · مهمة `cancelled`. **PASS**
2. **بدون lockdown لا رفض كاذب** لأمر عادي: outcome=`executed` · بلا audit رفض. **PASS**
3. **أمر مالي (`execute transfer` → actionType=financial) عبر guardian** — لا نزول تحت
   `require_approval` (waiting_approval أو أشد). **PASS**

### قيد البنية (يُوثَّق، لا يُصلَح في هذه المراجعة)
`src/api/server.ts:169` ينشئ `new CommandPipeline(store, execution)` **بدون securityGuardian** —
الدمج **كود اختياري مُختبَر** لكنه **غير مربوط** في الخادم الحي. الكشف: `grep "new SecurityGuardian"`
يرجع موضعًا واحدًا فقط (داخل ملف الاختبار). ربطه في الخادم **قرار معماري للمهندس**
(FORENSIC ARCHITECT REVIEW) وليس عيبًا يُصلَح هنا.
**الآثار التصنيفية:** قيود lockdown/rate/cost على *التنفيذ الخادمي الحي* = **UNVERIFIED**
بينما الطبقة الحتمية والنواة وطبقة DB = TESTED/LIVE_VERIFIED.

> **تحديث (FORENSIC REMEDIATION V1.0 — مهمة 3):** هذا القيد **حُلَّ**. رُبط الحارس في
> `server.ts:170` عبر المصنع الجديد `src/api/security.ts` (`createSecurityGuardian(store)`
> يربط lockdown→`store.activeLockdown`، rateLimit، anomaly، recordEvent→`recordSecurityEvent`،
> costCheck→CostProtector). كما جُعل `GuardianDeps.lockdown` **async-capable** في
> `src/core/security/guardian.ts` — كان متزامنًا فقط، فقفلً مصدري من DB سيجري رفضه صامتًا؛
> الآن `evaluate` يُنفّذ `await this.deps.lockdown(...)` (`guardian.ts:52`). **BYPASS SILENT
> LOCKDOWN = مغلق.** مثبت بـ `src/api/security.test.ts` (4 اختبارات) + `tsc --noEmit` نظيف.

### عدم تطابق المفردات (يُوثَّق، لا يُصلَح هنا)
مفاتيح سجل الإجراءات الحرجة (`financial_transaction`, `production_modification`, ...) لا تطابق
مفردات الـ pipeline (`actionTypeFor`: `financial`, `deploy`, `delete`, ...). عند ربط الـ guardian
لاحقًا، يجب توحيد المفردات أو إضافة aliases — قرار معماري. (اختبار §8.3 يثبت السلوك الحالي
وليس التخفيض.)

---

## 9. السلامة التشغيلية (PHASE 7–9)

- **Anti-loop:** `taskEngine.ts` — max 3 محاولات متتالية لكل صنف فشل، لا إعادة تلقائية
  (مُختبر: `taskEngine.test.ts` + `pipeline.test.ts` "bounded retries").
- **معدّل الفشل:** `task.failure` maxCount=10/ساعة و`auth.failure` maxCount=5/15د في
  `rateLimit.ts:17-19` **معرّفان لكن غير موصَّلين** (لا شيء يسجلها) — **تحسين موصى به**، ليست
  ثغرة فعلية (الدفاع الفعلي = retries محدودة + decision journal).
- **الشذوذ:** 5/9 عدّادات موصّلة (deniedActions · environmentEscalations · projectSwitches ·
  policyViolations · costSpikes)؛ و`retryBursts/authFailures/toolAnomalies/secretAccessAttempts`
  معرّفة غير موصّلة — **جزئي/موثَّق**.
- **الصحة:** لا تعلن "سليمة" أبدًا عند تعطل تحكم حرج (health.ts + rlsProbe).

---

## 10. مصفوفة الخصومة A–Q (PHASE 10)

| المعرف | الهجوم | الغطاء |
|---|---|---|
| A1 / T15 | حقن الأوامر | promptInjection.ts + 10 خصومية + redaction حي |
| A2 | تصعيد التصريح | authority/autonomy — الترقية فقط |
| A4 / T8 | lockdown | fail closed حي + §8.1 |
| A6 / T22 | سرقة أسرار | secretGuard + redaction حي |
| A7 | عبور مشروع | detectCrossProject + RLS + agent test |
| A8 / T5 | بيئة إنتاج | detectEnvironmentEscalation + require_approval |
| A9 | إجراء حرج | سجل 17 قاعدة منيع |
| A10 | أمر غير مصرّح | agentHasPermission قبل التنفيذ |
| A11 | تخطي RLS/TRUNCATE | **G2-1** (هذه المراجعة) |
| B | عزل مالك | RLS (rls_tests) + وحدوي (pipeline agent tests) |
| H | موافقة مزيفة | `modelOutputIsAuthority` مُختبَر (السطر 427) + سلطة حتمية لا من النموذج |
| K | تلاعب بالسجل | محفّزات no_update/no_delete/TRUNCATE (7 جداول) + S7 |
| N | إساءة إعادة المحاولة | retries محدودة + لا auto-loop + decision journal |

---

## 11. سجل التحقق الكامل (PHASE 11 — إعادة تشغيل كاملة)

```
tsc --noEmit                    → TSC_NOEMIT_EXIT=0        PASS
tsc -p tsconfig.build.json      → BUILD_EXIT=0             PASS
vitest run                      → 20 ملفات · 169/169 PASS  PASS
  (يضم: securityGuardian 41 · pipeline 18 [3 دمج جديدة] ·
   live.integration 8 · security.live 8 · security.api 1 — كلها حية على DB المصنع)
RLS_TESTS.SQL_PASS (333ms)                                   PASS  (رجوع Gate 1)
RLS_SECURITY_TESTS.SQL_PASS (351ms) — S1..S7                  PASS  (S7 = حماية TRUNCATE)
```

- **صفر بقايا** بعد كل تشغيل حي: `LEAKED_TEST_USERS=[]` · events/incidents/lockdowns=0 ·
  critical_actions=17 · policies=13.

---

## 12. سجل العيوب المصلحة (تراكمي — هذه المراجعة + سابقة)

**هذه المراجعة (G2 Forensic):**
1. **G2-1 (حرج)** — TRUNCATE يخترق RLS على 7 جداول → ميجرايشن تحصين + REVOKE + محفّزات → **LIVE_VERIFIED**.
2. **G2-2** — rlsProbe كان يدمج سجلّين في EXISTS واحد → فُصل.

**سابقة (تحقق Gate 2):** moreRestrictive · JWT fixture · severityFor(info.) · انتقال closed→detected ·
aliases snake→camel في repo.ts.

---

## 13. الحدود المقبولة وغير المقبولة

- **لم يُنفَّذ نشر** · لا Gate 3 · لا Growth Engine · لا أوامر مالية/قانونية حقيقية.
- migration تطبيق على **CHEF FACTORY DB** المصرّح بها (ممارسة Gate 1 نفسها).
- **الحدود الموثّقة:** ربط guardian في server.ts — **RESOLVED (مهمة 3: `server.ts:170`)**؛
  توحيد مفردات السجل/الـ pipeline؛ توصيل عدّادات الشذوذ الأربعة ومعدّلات الفشل — قرارات معمارية.

---

## 14. التصنيف

| الجدول | PASS |
|---|---|
| الطبقة الحتمية (نواة + DB + RLS) | **LIVE_VERIFIED** |
| اختبارات وحدة (169) + RLS (S1–S7) + تكامل حي | **TESTED + LIVE_VERIFIED** |
| G2-1 / G2-2 | **FIXED + LIVE_VERIFIED** |
| دمج guardian في خادم HTTP الحي | **RESOLVED — IMPLEMENTED + TESTED** (مهمة 3) |
| العبور الحي عبر HTTP مصادَق | **BLOCKED** (غياب `FACTORY_SERVICE_ROLE_KEY`) |

---

## 15. غلق المهام 6–9 (FORENSIC REMEDIATION V1.0)

### 15.1 مهمة 6 — طابع الميجرايشن
- ميجرايشنات: `20260815220000_factory_init` · `20260816000000_core_additions` ·
  `20260817000000_security_guardian` · `20260818000000_security_truncate_hardening` — **VALID**.
- الأدلة: CreateTime الفعلي لكل ملفات = 16/08/2026 (01:21:34→03:55:58)؛ ساعة DB =
  2026-08-16T03:44Z؛ لا فرق بيئة ساعة. الطابع **ترتيب منطقي متعمّد** — لا تزوير، لا إعادة تسمية.
- **فجوة تتبع:** `supabase_migrations.schema_migrations` يسجل الميجرايشنين 1–2 فقط؛
  الميجرايشنان 3–4 مطبَّقان فعليًا لكن غير مسجَّلين (SQL مباشر لا CLI). **خطر `supabase db push`
  مستقبلي** (فشل إعادة تطبيق). موثَّق — لا يُعدَّل بلا أمر مهندس.

### 15.2 مهمة 7 — الانحدار
`vitest run` = **173/173 (21 ملفًا)** · RLS S1–S7 PASS · RLS_TESTS PASS · build يثبت الـ wiring
في `dist/api/server.js:145` · `GUARDIAN_INTEGRATION = VERIFIED`.

### 15.3 مهمة 8 — الأسرار والبقايا
`CREDENTIAL_EXPOSURE = NONE` · `TEST_RESIDUE = NONE` (auth.users/identities/owners = 0؛ جداول
الأمان والأعمال = 0؛ حُذفت كل ملفات الـ probe/الرانر المؤقت). مسح شامل للمستودع عدا
node_modules/.env/dist/package-lock — 6 نتائج حميدة فقط (نصوص + توكن `.fake.fake` للاختبار).

### 15.4 مهمة 9 — الاتساق المعماري
**BYPASS_STATUS = NONE_FOUND:** الإنتاج `new CommandPipeline(` حصريًا في `server.ts:170` (محروس)؛
`.run(` حصريًا في `handlers.ts:51`؛ ToolBroker غير مربوط بـ API؛ Model/Runtime gateways داخل
`execution.ts` بعد تقييم الحارس؛ قرار الموافقة يكتفي بـ `store.patchApproval` بلا تنفيذ.
سلسلة الحارس→pipeline→authorization→autonomy→approval→execution لا مسار بديل.

### 15.5 LIVE_EXECUTION_BOUNDARY_VERIFICATION = **BLOCKED**
`FACTORY_SERVICE_ROLE_KEY_PRESENT = NO`. لا طلب اعتماد؛ الخطة الحرفية للتحقق الحي جاهزة
(مستخدم مؤقت `probe-live-<uuid>@example.invalid` · admin API · password grant · REAL HTTP ·
حذف · صفر بقايا · تقرير VERIFIED/UNVERIFIED/BLOCKED).

---

## 16. ملاحظات توقف إلزامية (مرحلة ما بعد المراجعة)

- **ممنوع:** أي عمل في Gate 3 أو نشر أو تعديلات بنيوية خارج تفويض المهندس.
- **المفوض:** FORENSIC ARCHITECT REVIEW ONLY — مراجعة قرارات الربط الموثقة (§8/§13).
- **في انتظار:** أمر المالك التالي.

---

## 17. ARCHITECT REVIEW — GATE 2 FORENSIC CLOSURE PACK (2026-08-16)

- **تصحيح سابق:** أسماء محفّزات TRUNCATE على الجداول السبعة هي `<table>_no_truncate` (tgtype 34 =
  BEFORE TRUNCATE FOR EACH STATEMENT) تستدعي دوال `block_*` الخمس — مؤكَّد حيًا في `pg_trigger`.
  منح `TRUNCATE/TRIGGER` مرفوضة عن anon/authenticated (غائبة من `role_table_grants`) — **G2-1 سليم.**
- **التحقق الحي نُفّذ 2026-08-16** (`FACTORY_SERVICE_ROLE_KEY_PRESENT = YES`): الرانر دون تعديل →
  `AUTHENTICATION_TEST = PASS` لكن **0/9 HTTP FAILED (401)**. **عيب حاسم:** `auth.ts:35` `setSession`
  بلا `refresh_token` في supabase-js 2.112.3 لا يثبّت الجلسة (`SESSION_ATTACHED=false`) → استعلام
  owners بلا توكن → RLS → 0 صفوف (PGRST116) → 401. الاستعلام الخام بتوكن Bearer المباشر يعمل (PASS) —
  RLS/التوكن سليمان. الأثر: لا مصادقة لأي مالك عبر HTTP الحي؛ إغلاق فاشل غير قابل للاستغلال.
  الإصلاح الأدنى مقترَح في `GATE_2_FINAL_REPORT.md` §25.4 — **لم يُطبَّق**.
- **مصفوفة الأدلة النهائية** (واحدة لكل قدرة): في `GATE_2_EVIDENCE.md` §1.10.5 — 18 قدرة
  LIVE_VERIFIED/TESTED + **قدرة واحدة LIVE FAILED (0/9)** مع الأدلة في §1.10.6.
- **التصنيف المؤقت: `GATE_2_BLOCKED`** (قاعدة FAILURE CRITERIA: فشل أي خاصية HTTP إلزامية → BLOCKED).
- **التوصية:** مراجعة §1.10.6، الموافقة على الإصلاح الأدنى في `auth.ts`، إعادة التشغيل.
- **النتيجة النهائية (BLOCKER REMEDIATION 2026-08-16):** العيبان أُصلحا — (1) `auth.ts`: استبدال
  `setSession` المعطوب باستعلام PostgREST يحمل التوكن الموثَّق كترويسة Bearer (`apikey: anon`، بلا
  service_role، يلزم `owner.id === user.id && status='active'`)؛ (2) `server.ts:127`: إزالة
  `JSON.stringify` المزدوج الذي كان يُرسِل كل استجابة JSON كسلسلة مشفَّرة. تصحيحات الرانر دنيا
  وحتمية (أوامر بقواعد نحوية مدعومة فعلاً + غلاف الاستجابة الصحيح + `lockdownId` + pool جديد للبقايا).
  الجولة الحية النهائية: **HTTP_TESTS_PASSED=9/9، LIVE_EXECUTION_BOUNDARY=VERIFIED،
  TEST_RESIDUE users=0 owners=0**؛ الانحدار 181/181 (22 ملف) + RLS S1–S7 + build PASS +
  auth regression A–H (8/8).
- **التصنيف النهائي: `GATE_2_PASS`.** تاريخ الفشل محفوظ في §1.10.6/§25.4 (لم يُمسح).

---

**نهاية سجل المراجعة الجنائية — GATE 2.**
