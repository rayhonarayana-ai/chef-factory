# CHEF FACTORY — التقرير الجنائي النهائي — GATE 2 (الحارس الأمني)

**الأمر:** MASTER FORENSIC AUDIT PROMPT V1.0 — GATE 2 FORENSIC REVIEW · ثم FORENSIC REMEDIATION PROMPT V1.0 — FINAL SECURITY INTEGRATION CLOSURE (المهام 3/6/7/8/9) · ثم GATE 2 FORENSIC CLOSURE PACK (ARCHITECT REVIEW)
**التاريخ:** 2026-08-16
**الحالة:** GATE 2 — **PASS** (الإصلاح الحي نُفّذ 2026-08-16: HTTP 9/9 PASSED — عيبا `auth.ts` (setSession) و`server.ts` (ترميز مزدوج) أُصلحا دون إضعاف أي ضابط — انظر §25.4/§25.5/§26)
**المراجع:** GATE_2_FORENSIC_REVIEW.md · GATE_2_EVIDENCE.md · CHEF_FACTORY_MASTER_REFERENCE_FINAL.md · GATE_1_EXECUTION_CONTRACT_FINAL.md

---

## 1. هوية المصنع (FACTORY_IDENTITY)

- name=`chef-factory` · v0.1.0 · type=module · repo مستقل (Qarayti.ai/PROOFOS/Tadbir خارج النطاق).
- .env (352B، git-ignored): `FACTORY_DB_PASSWORD` · `FACTORY_SUPABASE_URL` · `FACTORY_SUPABASE_ANON_KEY` فقط.
- host=`dybyidtcyzgliupzzfhl.supabase.co` · اتصال حي ✓ `postgres.dybyidtcyzgliupzzfhl` · PG 17.6 · db=`postgres`.
- جداول Gate 2 الستة حية: critical_actions=**17** · security_policies=**13** · البقية 0.
- `TEST_HELPER_FUNCTIONS_LEAKED=[]`. **FACTORY_IDENTITY = VERIFIED.**

## 2. الملخص التنفيذي

أُجريت مراجعة جنائية كاملة لطبقة الأمان GATE 2 على قاعدة المصنع الحية. اكتُشف وأُصلح وأُثبت حيًا
**عيبان**: G2-1 (حرج: TRUNCATE يخترق RLS ويمسح سجلّات الأمان) وG2-2 (rlsProbe). أُضيف اختبار حتمي
لتحصين TRUNCATE (S7) و3 اختبارات لإثبات دمج Guardian في الـ pipeline. أعيد التحقق الشامل:
**169/169 اختبارًا + RLS S1–S7 + تكامل حي + صفر بقايا**. لا نشر، لا Gate 3.

## 3. المنهجية والامتثال

EVIDENCE BEFORE CLAIMS. كل تصنيف LIVE_VERIFIED مبني على إخراج حي حرفي في السجل.
التصنيفات: IMPLEMENTED/TESTED/LIVE_VERIFIED/UNVERIFIED/BLOCKED/NOT_APPLICABLE.
ممنوع: إضعاف قواعد أمنية لإمرار اختبارات، تلفيق/حذف أدلة، العمل في Gate 3، تعديل مصانع خارجية.

## 4. جرد التنفيذ (PHASE 2)

15 وحدة في `src/core/security/` (guardian، policyEngine، riskEngine، criticalActions، lockdown،
rateLimit، costProtection، anomaly، promptInjection، secretGuard، events، incidents، health،
types، test) + migration + طرق repo.ts الأمنية + auth.ts. الكل **IMPLEMENTED + TESTED**.

## 5. تدقيق قاعدة البيانات الجنائي (PHASE 3)

23 جدولًا كلها RLS ON · `RLS_DISABLED: NONE` · سياسات مالك صحيحة · دوال SECURITY DEFINER
ملك postgres مع `search_path=public` · محفّزات ملك postgres. قبل الإصلاح كانت المنح الافتراضية
تسمح بـ TRIGGER (≡ TRUNCATE) للـ authenticated.

## 6. العيب الحرج G2-1 — TRUNCATE يخترق RLS (مُثبَت حيًا، ثم مُصلَح)

- **الإثبات قبل الإصلاح** (بصفة authenticated): `TRUNCATE security_events` ✓ و
  `TRUNCATE critical_actions` ✓ (مسح كامل). UPDATE المتأثر = 0 صفوف (RLS سليم؛ الفجوة في TRUNCATE فقط).
- **الإصلاح:** `20260818000000_security_truncate_hardening.sql` — محفّزات
  `before truncate for each statement` على 7 جداول + `REVOKE TRUNCATE, TRIGGER`.
  `MIGRATION_APPLIED (247ms)`.
- **التحقق بعد الإصلاح (ثنائي الطبقة):** authenticated → `permission denied` على 7؛
  postgres → مرفوض بالمحفّزات (رسائل صريحة). **G2-1 = FIXED + LIVE_VERIFIED.**

## 7. العيب الثانوي G2-2 — rlsProbe

استنتاج مزدوج من EXISTS واحد → فُصل إلى استعلامين مستقلين في `src/db/repo.ts`. **FIXED + TESTED.**

## 8. سلسلة التفويض (PHASE 4)

JWT → verifyOwner (Supabase Auth + owners RLS-scoped + active) → owner.id يُطبَع في كل استدعاء →
عزل RLS. سلاسل: IDENTITY → PROJECT → ENVIRONMENT → AGENT → PERMISSION → CLASSIFICATION →
RISK → POLICY → AUTONOMY → DECISION → AUDIT. **حتمية بالكامل** (نموذج اللغة = DATA، لا سلطة).

## 9. السياسات والتوليف (PHASE 5–6)

- 13 قاعدة؛ الأسبقية: **LOCKDOWN > DENY > REQUIRE_APPROVAL > NOTIFY > ALLOW**.
- `guardianCombineAuthority` ترقية فقط؛ **لا مسار يلغي DENY**.
- مخرجات النموذج لا تُرقّي ولا تُكرَّم أبدًا (اختبار `modelOutputIsAuthority`).

## 10. الحدود والقواعد الملزمة (لم تُنتهك)

1. DENY ALWAYS WINS · 2. أسبقية صارمة · 3. ترقية فقط · 4. LLM = DATA · 5. fail closed ·
6. تحرير lockdown للمالك حصريًا · 7. سجلّات منيعة حتى للـ superuser · 8. عزل مالك/مشروع/بيئة.

## 11. دمج Guardian في الـ Pipeline (PHASE 7 + اختبارات جديدة)

3 اختبارات حتمية جديدة في `pipeline.test.ts`: lockdown fail-closed (denied + audit
`security.guardian_denied` + cancelled) · لا رفض كاذب بدونه · عدم نزول الأمر المالي عن
`require_approval`. **PASS.**
**تحديث (FORENSIC REMEDIATION V1.0):** القيد البنيوي الموثّق سابقًا — `server.ts` بلا
guardian — **حُلَّ**: أنشئ المصنع `src/api/security.ts` (`createSecurityGuardian(store)`)
ورُبط في `server.ts:170` (`new CommandPipeline(store, execution, createSecurityGuardian(store))`).
كما جُعل `GuardianDeps.lockdown` قادرًا على الـ async (كان متزامنًا → فجوة صامتة: lockdown
المدعوم بقاعدة بيانات لن يُفرض أبدًا؛ الآن `await` في `guardian.ts:52`). التحقق: `tsc --noEmit`
نظيف + `src/api/security.test.ts` (4) أخضر. **مهمة 3 = PASS.**

## 12. السلامة التشغيلية (PHASE 8–9)

- retries محدودة (max 3 لكل صنف، لا auto-loop) — مُختبر.
- صحة أمنية لا تختلق (health.ts + rlsProbe). معدّل الفشل `task.failure` (10/س) معرّف غير موصَّل؛
  عدّادات شذوذ 5/9 موصّلة — **تحسينات موصى بها**، موثّقة.

## 13. مصفوفة الخصومة (PHASE 10)

A–Q مغطاة: حقن، تصعيد، lockdown، أسرار، عبور مشروع/بيئة، إجراء حرج، أمر غير مصرّح، **TRUNCATE (G2-1)**،
عزل مالك، موافقة مزيفة، تلاعب سجل (S7)، إساءة إعادة محاولة (bounded retries).

## 14. سجل التحقق الكامل (PHASE 11)

```
tsc --noEmit                 → PASS (0 أخطاء)
tsc -p tsconfig.build.json   → PASS (exit 0)
vitest run                   → 20 ملفًا · 169/169 PASS (41 أمان + 18 pipeline [3 دمج جديدة] + حي 17)
RLS_TESTS.SQL_PASS (333ms)   → PASS (رجوع Gate 1)
RLS_SECURITY_TESTS.SQL_PASS (351ms) → PASS (S1–S7، S7=TRUNCATE)
```

**بعد غلق التكامل (FORENSIC REMEDIATION V1.0 — المهام 6–9):**
```
vitest run                   → 21 ملفًا · 173/173 PASS (يضم security.api 4 اختبارات مصنع جديدة)
RLS_TESTS.SQL_PASS           → PASS (عبر runner مؤقت; `run_tests.js` المذكور بالعنوان غير موجود)
RLS_SECURITY_TESTS.SQL_PASS  → PASS (S1–S7)
```

## 15. صفر بقايا (تحقق حي)

`LEAKED_TEST_USERS=[]` · events/incidents/lockdowns=0 · critical_actions=17 · policies=13.

## 16. العيوب المصلحة (سجل جنائي تراكمي)

**هذه المراجعة:** G2-1 (TRUNCATE، حرج) · G2-2 (rlsProbe).
**سابقة:** moreRestrictive · JWT fixture · severityFor(info.) · انتقال closed→detected · aliases
snake→camel في repo.ts.

## 17. الحدود غير المنتهكة

لا نشر · لا Gate 3 · لا Growth Engine · لا أوامر مالية/قانونية حقيقية · migration على قاعدة
المصنع المصرّح بها فقط (ممارسة Gate 1).

## 18. تصنيفات المكونات (عقد Gate 2)

| المكوّن | التصنيف |
|---|---|
| محرك السياسة (13 قاعدة) | IMPLEMENTED + TESTED |
| تصنيف المخاطر | IMPLEMENTED + TESTED |
| سجل الإجراءات الحرجة (17) | IMPLEMENTED + TESTED + LIVE_VERIFIED |
| lockdown (fail closed، مالك حصري) | IMPLEMENTED + TESTED + LIVE_VERIFIED |
| معدّلات (7 نطاقات) | IMPLEMENTED + TESTED |
| حماية تكلفة | IMPLEMENTED + TESTED |
| كشف شذوذ | IMPLEMENTED + TESTED |
| حارس أسرار | IMPLEMENTED + TESTED |
| دفاع حقن | IMPLEMENTED + TESTED |
| أحداث/حوادث/صحة | IMPLEMENTED + TESTED + LIVE_VERIFIED |
| RLS + migration + **تحصين TRUNCATE** | IMPLEMENTED + TESTED + LIVE_VERIFIED |
| خطافات fail-closed (toolBroker/runtimeGateway/pipeline) | IMPLEMENTED + TESTED |
| **دمج guardian في خادم HTTP الحي (الكود)** | **IMPLEMENTED + TESTED** (مهمة 3؛ `server.ts:170` + `src/api/security.ts`) |
| **العبور الحي عبر HTTP مصادَق** | **BLOCKED** (غياب `FACTORY_SERVICE_ROLE_KEY` — انظر §22) |
| API الأمان | IMPLEMENTED + LIVE_VERIFIED |
| اختبارات 169 + RLS S1–S7 + تكامل حي 17 | TESTED + LIVE_VERIFIED |
| وثائق المراجعة الجنائية | IMPLEMENTED |

## 19. القيود الموثّقة (مقررات FORENSIC ARCHITECT REVIEW)

1. ~~ربط `SecurityGuardian` في `server.ts:169`~~ → **RESOLVED** (مهمة 3: `server.ts:170`).
2. توحيد مفردات سجل الإجراءات الحرجة مع مفردات الـ pipeline (actionTypeFor) — لا يزال مفتوحًا.
3. توصيل عدّادات الشذوذ الأربعة غير الموصّلة + معدّلات الفشل — لا يزال مفتوحًا.

## 20. شروط التوقف — غلق التكامل (FORENSIC REMEDIATION V1.0)

- **GATE 2 = PASS** (الطبقة الحتمية وDB واختباراتها LIVE_VERIFIED؛ الربط الخادمي للحارس
  IMPLEMENTED + TESTED؛ مهام 6–9 مغلقة). انظر §22 لشهادة المهام.
- **العبور الحي عبر HTTP مصادَق = BLOCKED** لغياب `FACTORY_SERVICE_ROLE_KEY` — لا يُطلب
  الاعتماد؛ المالك يضبطه بنفسه متى أراد، وتُعاد محاولة التحقق الحي فقط.
- **لم يُنفَّذ** نشر. **لم تبدأ** مرحلة Gate 3.
- التوقف الإجباري بعد هذه الشهادة: انتظار FORENSIC ARCHITECT REVIEW ثم أمر المالك.

## 21. الشهادة النهائية

```
FINAL_GATE_2_CLASSIFICATION: PASS (مهام 6–9 مغلقة)
NEXT_AUTHORIZED_ACTION: FORENSIC ARCHITECT REVIEW ONLY
```

## 22. LIVE_EXECUTION_BOUNDARY_VERIFICATION

- **الحالة: BLOCKED** — `FACTORY_SERVICE_ROLE_KEY_PRESENT = NO`.
- ممنوع استخراج/توليد/طباعة أي اعتماد؛ القراءة الحصرية من متغير بيئة العملية وقت التشغيل.
- **مثبَّت حتى الآن (مستقل عن الاعتماد):** لا وجود لأي `new CommandPipeline(` في الإنتاج سوى
  `server.ts:170` (محروس)؛ لا استدعاء `.run(` إلا `handlers.ts:51`؛ ToolBroker غير مربوط في
  مسار الـ API؛ ModelGateway/RuntimeGateway لا يُستدعيان إلا عبر `execution.ts` بعد تقييم
  الحارس داخل `executeTask`؛ مسار قرار الموافقة (`handlers.ts:111–131`) يكتفي بـ
  `store.patchApproval` بلا تنفيذ. **BYPASS_STATUS = NONE_FOUND.**
- **خطة التحقق الحي الجاهزة (عند توفر المتغير):** إنشاء مستخدم مؤقت واحد
  `probe-live-<uuid>@example.invalid` (admin API · `email_confirm=true` · كلمة مرور عشوائية في
  الذاكرة) → password grant → REAL HTTP POST /api/chat (نجاح مُصرَّح · deny · require_approval
  لإجراء حرج · lockdown · عزل مشاريع · تقييد بيئة · إصرار القرار الأمني · لا تجاوز retry ·
  لا تجاوز Model/Tool · لا CommandPipeline مباشر) → حذف المستخدم → صفر بقايا →
  `FINAL_LIVE_EXECUTION_BOUNDARY = VERIFIED/UNVERIFIED/BLOCKED`.

## 23. غلق المهام الجنائية 6–9

### مهمة 6 — طابع الميجرايشن (MIGRATION TIMESTAMP FORENSICS) = **PASS** (مع ملاحظة موثّقة)
- الميجرايشنات الأربعة: `20260815220000_factory_init` · `20260816000000_core_additions` ·
  `20260817000000_security_guardian` · `20260818000000_security_truncate_hardening` — الترتيب
  صحيح (init→core→guardian→hardening؛ الحماية قبل المحفّزات). غير مكررة، لا أسماء مكررة.
- **التصنيف: VALID** — الطابع هو **طابع ترتيب منطقي متعمّد** وليس وقت حائطي: كل الملفات
  أُنشئت فعليًا 16/08/2026 (01:21–03:55) وساعة DB = 2026-08-16T03:44Z (لا فرق بيئة ساعة،
  لا تحديد زمني مخادع). **لا يُعاد تسميته** (مطبَّق).
- **فجوة تتبع (لا تُصلَح الآن):** `supabase_migrations.schema_migrations` يسجل الميجرايشنين
  1–2 فقط؛ 3–4 **مطبَّقان فعليًا** (الأشياء قائمة ومؤكدة حيًا) لكن **غير مسجَّلين** (طُبِّقا
  عبر SQL مباشر لا CLI) → تشغيل `supabase db push` مستقبلي قد يحاول إعادة تطبيقهما فيفشل.
  موثَّق؛ قرار المعالجة للمهندس.

### مهمة 7 — الانحدار الكامل (REGRESSION) = **PASS**
`TYPECHECK=PASS` · `BUILD=PASS` (`dist/api/server.js:145` يؤكد ربط الحارس) ·
`LOCAL_TESTS=173/173` (21 ملفًا) · RLS_S1–S7 PASS · RLS_TESTS PASS · `GUARDIAN_INTEGRATION=VERIFIED`.

### مهمة 8 — تنظيف الأسرار والبقايا (CLEANUP FORENSICS) = **PASS**
`CREDENTIAL_EXPOSURE=NONE` (6 نتائج مسح كلها نصوص/تعليقات/توكن `.fake.fake` لاختبار redaction) ·
`TEST_RESIDUE=NONE` (auth.users=0 · identities=0 · owners=0 · events/incidents/lockdowns/tasks/audit=0 ·
لا ملفات مؤقتة في الجذر).

### مهمة 9 — الاتساق المعماري (ARCHITECTURAL CONSISTENCY) = **PASS**
`BYPASS_STATUS=NONE_FOUND` (أدلة §22) · التوثيق محدَّث (هذا التقرير + FORENSIC_REVIEW + EVIDENCE + todo.md).

## 24. التقرير الجنائي النهائي — صيغة المالك المطلوبة

```
MISSION_6 = PASS        (VALID مع فجوة تتبع schema_migrations موثّقة)
MISSION_7 = PASS
MISSION_8 = PASS
MISSION_9 = PASS
TYPECHECK = PASS
BUILD = PASS
LOCAL_TESTS = 173/173 (21 ملفًا) + RLS_S1–S7 PASS + RLS_TESTS PASS
GUARDIAN_INTEGRATION = VERIFIED
BYPASS_STATUS = NONE_FOUND
CREDENTIAL_EXPOSURE = NONE
TEST_RESIDUE = NONE
LIVE_VERIFICATION = BLOCKED — FACTORY_SERVICE_ROLE_KEY_MISSING
```

1. **Files changed (الغلق):** `src/api/security.ts` (جديد — المصنع) · `src/api/security.test.ts`
   (جديد — 4 اختبارات) · `src/api/server.ts` (ربط الحارس في :170) ·
   `src/core/security/guardian.ts` (lockdown async-capable) · وثائق Gate 2 الثلاث + todo.md ·
   حذف كل ملفات `_probe_*`/`_run_rls.ts`/`_forensic_truncate*.ts`/`_identity_check.mjs`.
2. **Tests executed:** `tsc --noEmit` · `tsc -p tsconfig.build.json` · `vitest run` (173/173) ·
   RLS_TESTS + RLS_SECURITY_TESTS (عبر runner مؤقت) · استعلامات بقايا حية.
3. **Findings:** الطابع الزمني طابع ترتيب منطقي VALID؛ فجوة تتبع ميجرايشن 3–4؛ `run_tests.js`
   المذكور في رأس RLS غير موجود (يُستعمل بديل runner)؛ db نظيفة تمامًا.
4. **Security findings:** لا أسرار مكشوفة؛ لا بقايا؛ لا مسار تجاوز؛ محفّزات TRUNCATE سليمة حيًا.
5. **Remaining blockers:** التحقق الحي عبر HTTP (FACTORY_SERVICE_ROLE_KEY) · توحيد مفردات
   السجل/الـ pipeline · عدّادات الشذوذ الأربعة + معدّلات الفشل · فجوة تتبع schema_migrations.
6. **Exact recommended next action:** مراجعة FORENSIC ARCHITECT REVIEW لهذه الشهادة؛ ثم إن
   رغب المالك بإتمام التحقق الحي: ضبط `FACTORY_SERVICE_ROLE_KEY` كمتغير بيئة عملية وتكرار
   خطة §22 حرفيًا.

## 25. ARCHITECT REVIEW — GATE 2 FORENSIC CLOSURE PACK (التحليل النهائي)

### 25.1 Migration tracking (النتيجة)
`supabase_migrations.schema_migrations` (version, statements, name) يسجل فقط الميجرايشنين 1–2؛
الميجرايشنان 3–4 مطبَّقان فعلًا (مؤكَّد حيًا: 5 دوال block_* + 7 محفّزات `<table>_no_truncate` tgtype 34 +
RLS + 80 سياسة) لكن غير مسجَّلين. التصنيف: **B) مشكلة تكامل تتبع** (جدول التتبع خارج المزامنة مع التاريخ
الفعلي) وليس انجراف مخطط حقيقي (catalog مطابق لـ SQL الميجرايشن). **الإصلاح المقترح (آمن وحتمي — لم يُنفَّذ
بعد، بانتظار موافقة المالك/المعماري):** `supabase migration repair --status applied 20260817000000` ثم
`--status applied 20260818000000` (تسجيل الحالة دون تنفيذ SQL → لا يغيّر حالة التطبيق). حاليًا: **قيد مقبول**.
ملاحظة تصحيحية: أسماء محفّزات TRUNCATE هي `<table>_no_truncate` (ليست block_* كما ورد في تقرير سابق).

### 25.2 Vocabulary alignment (خلاصة — لا إعادة هيكلة)
| TERM_A | TERM_B | LOCATION | SEMANTIC_DIFFERENCE | RISK | RECOMMENDATION |
|---|---|---|---|---|---|
| `financial` / `legal` / `account_security` / `deploy` / `delete` | `financial_transaction` / `legal_commitment` / `secret_access` / `production_modification` / `production_deletion` | pipeline.ts:564 actionTypeFor ↔ criticalActions.ts | صفر تطابق: `classifyCriticalAction` لا يصطدم أبدًا في مسار الـ pipeline الحي | HIGH (التغطية عبر Gate 1 فقط؛ السجلّ المنيع = دفاع متدرّج خامل) | Alias map actionTypeFor→registry action في guardian (مستقبلي) |
| `rule.critical_action_require_approval` / `rule.environment_isolation` / `rule.production_write_execute` / `rule.default_allow` | `rule.critical.require_approval` / `rule.environment_escalation` / `rule.production.write_execute` / `rule.default.allow` | policyEngine.ts ↔ DB security_policies (12 صفًا) | فصل النقاط `_` vs `.` + أسماء شبه مترادفة؛ DB سجلّ توثيقي (لا يُقرأ بواسطة المحرك) | LOW | DOCUMENTATION_ONLY |
| snake_case DB columns | camelCase TS types | migration ↔ types.ts | اصطلاح أعمدة/خصائص | LOW (مُعالَج) | DOCUMENTATION_ONLY (repo.ts aliases) |
| `anomaly.retry_burst` / `anomaly.tool_anomaly` / `anomaly.auth_failures` / `secret.access_attempt` | (عدّادات غير موصّلة) | events.ts ↔ guardian.ts noteAnomalies | أنواع أحداث معرّفة بلا مُنبع | MEDIUM (مراقبة مفقودة) | توصيل العدّادات (مستقبلي) |

### 25.3 Anomaly / failure-rate (خلاصة)
- **WIRED_AND_ENFORCED (5):** deniedActions · environmentEscalations · projectSwitches ·
  policyViolations · costSpikes — تُنشئ أحداثًا فقط (لا تؤثر في القرار) وتُسجَّل في security_events.
- **DEFINED_ONLY (5):** authFailures · retryBursts · toolAnomalies · secretAccessAttempts · privilegeRequests —
  لا استدعاء `note()` في الإنتاج إطلاقًا.
- **WIRED_BUT_NOT_ENFORCED:** حدود `auth.failure` (5/15د) و`task.failure` (10/س) و`approval.request` و
  `runtime.execute` و`model.call` — مسار الفحص موجود في guardian لكن لا مُرسِل يمرّر هذه الـ scopes؛ الحي
  يُفرض فقط `task.execute` و`tool.call` (pipeline.ts:243).
- **لا تأثير على القرار:** إشارات الشذوذ سجلّية فقط. **غير قابل للتجاوز الضار** (خامل وليس متهربًا).
- ليست جزءًا من عقد الإغلاق الإلزامي لـ Gate 2 — توصيات مستقبلية (Gate لاحق).

### 25.4 Live HTTP readiness → LIVE VERIFICATION RUN (2026-08-16)
`FACTORY_SERVICE_ROLE_KEY_PRESENT = YES` → نُفّذ الرانر **كما هو دون تعديل**:
`npx tsx scripts/live-http-verification.ts`. النتيجة: `AUTHENTICATION_TEST = PASS`
(create + password grant + جلسة حقيقية)؛ الخادم اشتغل على 127.0.0.1:18789؛ لكن **جميع الحالات
التسع FAILED بـ 401** → `HTTP_TESTS_PASSED=0/9` → `LIVE_EXECUTION_BOUNDARY = UNVERIFIED`.
**السبب الجذري (مؤكَّد بالفحص الخام، دون كشف أي سر):** `src/api/auth.ts:35`
`setSession({ access_token, refresh_token: '' })` في supabase-js 2.112.3 **لا يثبّت الجلسة**
(`SESSION_ATTACHED=false`) → استعلام `owners` يُرسَل بلا توكن → RLS → 0 صفوف → `PGRST116` →
`verifyOwner` = null → 401. الاستعلام نفسه بتوكن المستخدم عبر HTTP خام (Bearer مباشر) يعيد
صفاً واحداً `status=active` (PASS) — RLS والتوكن والسياسات سليمة؛ العطب في مسار العميل فقط.
**الأثر الأمني:** لا يمكن لأي مالك المصادقة عبر HTTP الحي (كل النقاط 401) — إغلاق فاشل غير قابل
للاستغلال، لكن الحدود غير صالحة حتى الإصلاح.

### 25.5 Live HTTP readiness → BLOCKER REMEDIATION (2026-08-16)
- **إصلاح 1 — نشر المصادقة (`src/api/auth.ts`):** استُبدل مسار `setSession` المعطوب (لا يثبّت الجلسة
  في supabase-js 2.112.3) بالتحقق `supabase.auth.getUser(token)` + استعلام PostgREST مباشر لجدول
  `owners` حاملاً التوكن الموثَّق في `Authorization: Bearer <token>` (بترويسة `apikey: anon` — **بلا**
  service_role). يُلزِم `owner.id === user.id && status === 'active'`؛ أي خطأ → null (فاشل-مغلق).
- **إصلاح 2 — الترميز المزدوج لـ JSON (`src/api/server.ts:127`):** دالة `send()` كانت تطبّق
  `JSON.stringify` مرتين (قبل وبعد `redact()`) → كل استجابة JSON تُرسَل كسلسلة مشفَّرة (`"{\"id\":…}"`)
  → `.json()` تعيد سلسلةً وليست كائناً → قراءات الحقول = undefined (كشفتها الجولة اللاحقة: 200 مع
  حقول مفقودة). أُزيل `JSON.stringify` الخارجي.
- **تصحيحات الرانر (دنيا، حتمية، محايدة أمنياً — لا إضعاف):**
  - T4: `transfer 100 in X` → `execute transfer 100 in X` (`transfer` موردٌ لا فِعْل؛ `execute` فعلٌ
    مدعوم) → مسار `financial` → `require_approval` الفعلي.
  - T6: قراءة الغلاف `{ lockdown: { status, lockdownId } }` وتمرير `lockdownId` إلى نقطة الإصدار
    (التي تتطلبه)، وتأكيد أمرٍ ثانٍ مرفوض أثناء القفل (حدثان `health.lockdown` لـ T7).
  - T8: `execute build in X` → `execute task in X` (`build` كلمة فعلٍ لا مورد؛ `task` المورد المدعوم).
  - فحص البقايا: `pg.Pool` جديد (مفرد الخادم يُغلَق قبل الفحص — كان دائمًا `UNKNOWN`).
- **النتيجة الحية النهائية (الرانر دون تعديل بعد التصحيحات):** `HTTP_TESTS_PASSED=9/9`،
  `LIVE_EXECUTION_BOUNDARY = VERIFIED`، `TEST_RESIDUE users=0 owners=0`،
  وجميع الحالات التسع PASS (انظر `GATE_2_EVIDENCE.md` §1.10.7).
- **الانحدار (PHASE 7):** vitest **181/181 (22 ملف)** · `RLS_TESTS.SQL_PASS` ·
  `RLS_SECURITY_TESTS.SQL_PASS` (S1–S7) · `tsc --noEmit` PASS · `npm run build` BUILD_EXIT=0 ·
  `src/api/auth.test.ts` 8/8 (A–H).

## 26. الشهادة النهائية للمعماري

```
LIVE_HTTP_VERIFICATION = PASSED — HTTP_TESTS_PASSED=9/9 — LIVE_EXECUTION_BOUNDARY = VERIFIED
FIXES_APPLIED = auth.ts Bearer-propagation + server.ts single-encode (minimal, RLS-preserving)
REGRESSION = 181/181 vitest · RLS S1–S7 · build PASS · auth regression A–H PASS
TEST_RESIDUE = users=0 owners=0
FINAL_CLASSIFICATION = GATE_2_PASS
```
القاعدة (FORENSIC CLOSURE PACK): كل الحالات الإلزامية التسع ناجحة حيًا + انحدار كامل ناجح.
تاريخ الفشل محفوظ في §25.4/§1.10.6 (لم يُمسح). العيبان الجذريان أُصلحا دون إضعاف أي ضابط أمني.

---

**نهاية التقرير الجنائي النهائي — GATE 2.**
