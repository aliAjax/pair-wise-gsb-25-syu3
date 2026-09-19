import { useEffect, useMemo, useState, type FormEvent } from "react";
import "./styles.css";

/* ================= 领域类型 ================= */

type EyeSide = "OD" | "OS"; // OD 右眼 / OS 左眼
type SessionStatus = "active" | "returned" | "confirmed";
type Finding = "normal" | "abnormal";

interface Patient {
  id: string;
  name: string;
  baseCurve: number; // 基弧 mm
  keratometry: number; // 角膜曲率 D
  astigmatism: number; // 散光 D（负柱镜记法）
  currentBatch: string | null; // 当前承接的镜片批次
  registeredAt: string;
}

interface TrialLens {
  id: string; // 镜片编号
  eye: EyeSide; // 左右眼型号
  model: string;
  baseCurve: number;
  batch: string;
}

interface TrialSession {
  id: string;
  patientId: string;
  lensId: string;
  eye: EyeSide;
  start: string; // ISO 时段起
  end: string; // ISO 时段止
  status: SessionStatus;
}

interface Review {
  id: string;
  patientId: string;
  date: string;
  previousBatch: string; // 承接的上次镜片批次
  resultBatch: string; // 复查后留存批次
  lensFinding: Finding;
  corneaFinding: Finding;
  reason: string; // 异常原因（正常为 ""）
  keptOriginalBatch: boolean;
}

interface Revision {
  id: string;
  patientId: string;
  at: string;
  field: string;
  oldValue: string;
  newValue: string;
  reason: string;
}

interface Conflict {
  id: string;
  at: string;
  action: string;
  patientName: string;
  lensId: string;
  params: string;
  rule: string;
}

interface LedgerState {
  patients: Patient[];
  lenses: TrialLens[];
  sessions: TrialSession[];
  reviews: Review[];
  revisions: Revision[];
  conflicts: Conflict[];
}

/* ================= 适配范围与常量 ================= */

const FIT_RANGE = {
  baseCurve: { min: 7.5, max: 8.6, unit: "mm", label: "基弧" },
  keratometry: { min: 40.0, max: 46.0, unit: "D", label: "角膜曲率" },
  astigmatismAbsMax: 1.5,
};

const STORAGE_KEY = "oklens-ledger-v1";

const eyeLabel = (eye: EyeSide) => (eye === "OD" ? "右眼 OD" : "左眼 OS");

const sessionStatusMeta: Record<SessionStatus, { text: string; badge: string }> = {
  active: { text: "占用中", badge: "badge-warn" },
  returned: { text: "已归还", badge: "badge-info" },
  confirmed: { text: "已确认", badge: "badge-ok" },
};

/* ================= 工具函数 ================= */

const pad2 = (n: number) => String(n).padStart(2, "0");

function fmtDT(iso: string): string {
  const d = new Date(iso);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function toInputDT(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function isoAt(dayOffset: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function nextNum(ids: string[]): number {
  let max = 0;
  for (const id of ids) {
    const m = id.match(/(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

const makeId = (prefix: string, ids: string[]) => `${prefix}-${String(nextNum(ids)).padStart(3, "0")}`;

/** 参数超出适配范围的明细，用于确认试戴拦截与患者适配评估 */
function fitViolations(p: Patient): string[] {
  const v: string[] = [];
  const { baseCurve, keratometry, astigmatismAbsMax } = FIT_RANGE;
  if (p.baseCurve < baseCurve.min || p.baseCurve > baseCurve.max) {
    v.push(`基弧 ${p.baseCurve.toFixed(2)}mm（适配 ${baseCurve.min.toFixed(2)}–${baseCurve.max.toFixed(2)}mm）`);
  }
  if (p.keratometry < keratometry.min || p.keratometry > keratometry.max) {
    v.push(`角膜曲率 ${p.keratometry.toFixed(2)}D（适配 ${keratometry.min.toFixed(2)}–${keratometry.max.toFixed(2)}D）`);
  }
  if (Math.abs(p.astigmatism) > astigmatismAbsMax) {
    v.push(`散光 ${p.astigmatism.toFixed(2)}D（适配上限 ±${astigmatismAbsMax.toFixed(2)}D）`);
  }
  return v;
}

function buildConflicts(existing: Conflict[], items: Array<Omit<Conflict, "id" | "at">>): Conflict[] {
  const at = new Date().toISOString();
  let n = nextNum(existing.map((c) => c.id));
  const created = items.map((item) => ({ ...item, id: `C-${String(n++).padStart(3, "0")}`, at }));
  return [...created, ...existing];
}

/* ================= 示例数据 ================= */

function buildSeed(): LedgerState {
  const lenses: TrialLens[] = [
    { id: "L-OD-01", eye: "OD", model: "CRT-6.0", baseCurve: 8.1, batch: "B2026-08A" },
    { id: "L-OD-02", eye: "OD", model: "CRT-6.0", baseCurve: 8.3, batch: "B2026-08A" },
    { id: "L-OD-03", eye: "OD", model: "Euclid-S", baseCurve: 8.5, batch: "B2026-09A" },
    { id: "L-OS-01", eye: "OS", model: "CRT-6.0", baseCurve: 8.1, batch: "B2026-08A" },
    { id: "L-OS-02", eye: "OS", model: "CRT-6.0", baseCurve: 8.3, batch: "B2026-08A" },
    { id: "L-OS-03", eye: "OS", model: "Euclid-S", baseCurve: 8.5, batch: "B2026-09A" },
  ];

  const patients: Patient[] = [
    { id: "P-001", name: "林小舟", baseCurve: 8.2, keratometry: 43.25, astigmatism: -0.75, currentBatch: null, registeredAt: isoAt(-12, 10) },
    { id: "P-002", name: "陈可", baseCurve: 8.95, keratometry: 44.0, astigmatism: -1.0, currentBatch: null, registeredAt: isoAt(-9, 14) },
    { id: "P-003", name: "赵一鸣", baseCurve: 8.1, keratometry: 42.5, astigmatism: -2.25, currentBatch: null, registeredAt: isoAt(-7, 11) },
    { id: "P-004", name: "何雨桐", baseCurve: 8.4, keratometry: 45.75, astigmatism: -0.5, currentBatch: "B2026-08A", registeredAt: isoAt(-20, 9) },
  ];

  const sessions: TrialSession[] = [
    { id: "T-001", patientId: "P-004", lensId: "L-OD-02", eye: "OD", start: isoAt(-6, 9), end: isoAt(-6, 11), status: "confirmed" },
    { id: "T-002", patientId: "P-001", lensId: "L-OD-01", eye: "OD", start: isoAt(0, 9, 30), end: isoAt(0, 11, 30), status: "active" },
    { id: "T-003", patientId: "P-003", lensId: "L-OS-01", eye: "OS", start: isoAt(-1, 14), end: isoAt(-1, 16), status: "returned" },
  ];

  const reviews: Review[] = [
    {
      id: "R-001",
      patientId: "P-004",
      date: isoAt(-2, 15),
      previousBatch: "B2026-08A",
      resultBatch: "B2026-08A",
      lensFinding: "normal",
      corneaFinding: "normal",
      reason: "",
      keptOriginalBatch: true,
    },
  ];

  const revisions: Revision[] = [
    {
      id: "V-001",
      patientId: "P-002",
      at: isoAt(-4, 16),
      field: "角膜曲率",
      oldValue: "43.75D",
      newValue: "44.00D",
      reason: "复测角膜地形图后修正",
    },
  ];

  return { patients, lenses, sessions, reviews, revisions, conflicts: [] };
}

function loadState(): LedgerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LedgerState;
      if (parsed && Array.isArray(parsed.patients) && Array.isArray(parsed.sessions)) return parsed;
    }
  } catch {
    /* 数据损坏时回退示例数据 */
  }
  return buildSeed();
}

/* ================= 组件 ================= */

const statusColors = ["status-ok", "status-watch", "status-danger"];

function MetricCard({ label, value, index }: { label: string; value: number; index: number }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <i className={statusColors[index % statusColors.length]} />
    </article>
  );
}

function App() {
  const [ledger, setLedger] = useState<LedgerState>(loadState);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
  }, [ledger]);

  /* ---------- 表单状态 ---------- */
  const emptyPatientForm = { name: "", baseCurve: "", keratometry: "", astigmatism: "", reason: "" };
  const [patientForm, setPatientForm] = useState(emptyPatientForm);
  const [editingPatientId, setEditingPatientId] = useState<string | null>(null);
  const [patientError, setPatientError] = useState("");

  const defaultStart = () => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return d;
  };
  const [sessionForm, setSessionForm] = useState(() => {
    const start = defaultStart();
    const end = new Date(start.getTime() + 2 * 3600 * 1000);
    return { patientId: "", eye: "OD" as EyeSide, lensId: "", start: toInputDT(start), end: toInputDT(end) };
  });
  const [sessionError, setSessionError] = useState("");

  const [reviewForm, setReviewForm] = useState({
    patientId: "",
    lensFinding: "normal" as Finding,
    corneaFinding: "normal" as Finding,
    reason: "",
    nextBatch: "",
  });
  const [reviewError, setReviewError] = useState("");

  /* ---------- 派生数据 ---------- */
  const patientById = useMemo(() => new Map(ledger.patients.map((p) => [p.id, p])), [ledger.patients]);
  const lensById = useMemo(() => new Map(ledger.lenses.map((l) => [l.id, l])), [ledger.lenses]);
  const activeSessions = useMemo(() => ledger.sessions.filter((s) => s.status === "active"), [ledger.sessions]);
  const occupiedLensIds = useMemo(() => new Set(activeSessions.map((s) => s.lensId)), [activeSessions]);
  const batches = useMemo(() => Array.from(new Set(ledger.lenses.map((l) => l.batch))), [ledger.lenses]);
  const confirmedPatients = useMemo(() => ledger.patients.filter((p) => p.currentBatch !== null), [ledger.patients]);

  const reviewPatient = reviewForm.patientId ? patientById.get(reviewForm.patientId) : undefined;
  const reviewAbnormal = reviewForm.lensFinding === "abnormal" || reviewForm.corneaFinding === "abnormal";

  /* ---------- 患者登记 / 修订 ---------- */
  function submitPatient(e: FormEvent) {
    e.preventDefault();
    setPatientError("");
    const name = patientForm.name.trim();
    const bc = parseFloat(patientForm.baseCurve);
    const k = parseFloat(patientForm.keratometry);
    const ast = parseFloat(patientForm.astigmatism);
    if (!name) return setPatientError("请填写患者姓名");
    if ([bc, k, ast].some((n) => Number.isNaN(n))) return setPatientError("基弧、角膜曲率、散光须为数字");
    if (ast > 0) return setPatientError("散光按负柱镜记法填写（如 -0.75）");

    if (editingPatientId) {
      const target = ledger.patients.find((p) => p.id === editingPatientId);
      if (!target) return setPatientError("未找到待修订患者");
      const changes: Array<[string, string, string]> = [];
      if (bc !== target.baseCurve) changes.push(["基弧", `${target.baseCurve.toFixed(2)}mm`, `${bc.toFixed(2)}mm`]);
      if (k !== target.keratometry) changes.push(["角膜曲率", `${target.keratometry.toFixed(2)}D`, `${k.toFixed(2)}D`]);
      if (ast !== target.astigmatism) changes.push(["散光", `${target.astigmatism.toFixed(2)}D`, `${ast.toFixed(2)}D`]);
      if (changes.length === 0) return setPatientError("参数未发生变化，无需修订");
      if (!patientForm.reason.trim()) return setPatientError("参数修订须填写修订原因");

      setLedger((s) => {
        let n = nextNum(s.revisions.map((r) => r.id));
        const at = new Date().toISOString();
        const newRevisions: Revision[] = changes.map(([field, oldValue, newValue]) => ({
          id: `V-${String(n++).padStart(3, "0")}`,
          patientId: target.id,
          at,
          field,
          oldValue,
          newValue,
          reason: patientForm.reason.trim(),
        }));
        return {
          ...s,
          patients: s.patients.map((p) =>
            p.id === target.id ? { ...p, name, baseCurve: bc, keratometry: k, astigmatism: ast } : p
          ),
          revisions: [...newRevisions, ...s.revisions],
        };
      });
    } else {
      setLedger((s) => ({
        ...s,
        patients: [
          ...s.patients,
          {
            id: makeId("P", s.patients.map((p) => p.id)),
            name,
            baseCurve: bc,
            keratometry: k,
            astigmatism: ast,
            currentBatch: null,
            registeredAt: new Date().toISOString(),
          },
        ],
      }));
    }
    setPatientForm(emptyPatientForm);
    setEditingPatientId(null);
  }

  function startEditPatient(id: string) {
    const p = patientById.get(id);
    if (!p) return;
    setEditingPatientId(id);
    setPatientForm({
      name: p.name,
      baseCurve: p.baseCurve.toFixed(2),
      keratometry: p.keratometry.toFixed(2),
      astigmatism: p.astigmatism.toFixed(2),
      reason: "",
    });
    setPatientError("");
  }

  /* ---------- 试戴占用 ---------- */
  function submitSession(e: FormEvent) {
    e.preventDefault();
    setSessionError("");
    const patient = patientById.get(sessionForm.patientId);
    const lens = lensById.get(sessionForm.lensId);
    if (!patient) return setSessionError("请选择患者");
    if (!lens) return setSessionError("请选择试戴片");
    if (lens.eye !== sessionForm.eye) return setSessionError("试戴片眼别与所选眼别不一致");
    const start = new Date(sessionForm.start);
    const end = new Date(sessionForm.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      setLedger((s) => ({
        ...s,
        conflicts: buildConflicts(s.conflicts, [
          {
            action: "登记试戴",
            patientName: patient.name,
            lensId: lens.id,
            params: `时段 ${sessionForm.start || "缺失"} → ${sessionForm.end || "缺失"}`,
            rule: "试戴时段无效（结束须晚于开始）",
          },
        ]),
      }));
      return;
    }

    const startMs = start.getTime();
    const endMs = end.getTime();
    const overlap = activeSessions.find(
      (s) => s.lensId === lens.id && startMs < Date.parse(s.end) && Date.parse(s.start) < endMs
    );
    if (overlap) {
      const other = patientById.get(overlap.patientId);
      setLedger((s) => ({
        ...s,
        conflicts: buildConflicts(s.conflicts, [
          {
            action: "登记试戴",
            patientName: patient.name,
            lensId: lens.id,
            params: `申请 ${fmtDT(start.toISOString())}–${fmtDT(end.toISOString())}，与 ${other?.name ?? overlap.patientId} 的 ${fmtDT(overlap.start)}–${fmtDT(overlap.end)} 重叠`,
            rule: "同一试戴片重叠时段不能重复分配",
          },
        ]),
      }));
      return;
    }

    setLedger((s) => ({
      ...s,
      sessions: [
        ...s.sessions,
        {
          id: makeId("T", s.sessions.map((x) => x.id)),
          patientId: patient.id,
          lensId: lens.id,
          eye: sessionForm.eye,
          start: start.toISOString(),
          end: end.toISOString(),
          status: "active",
        },
      ],
    }));
    setSessionForm((f) => ({ ...f, lensId: "" }));
  }

  function returnLens(sessionId: string) {
    setLedger((s) => ({
      ...s,
      sessions: s.sessions.map((x) => (x.id === sessionId && x.status === "active" ? { ...x, status: "returned" } : x)),
    }));
  }

  function confirmSession(sessionId: string) {
    setLedger((s) => {
      const sess = s.sessions.find((x) => x.id === sessionId);
      if (!sess || sess.status === "confirmed") return s;
      const patient = s.patients.find((p) => p.id === sess.patientId);
      const lens = s.lenses.find((l) => l.id === sess.lensId);
      if (!patient || !lens) return s;

      const blocked: Array<Omit<Conflict, "id" | "at">> = [];
      if (sess.status !== "returned") {
        blocked.push({
          action: "确认试戴",
          patientName: patient.name,
          lensId: lens.id,
          params: `试戴时段 ${fmtDT(sess.start)}–${fmtDT(sess.end)}，状态：占用中`,
          rule: "试戴片未归还，不能确认试戴",
        });
      }
      const violations = fitViolations(patient);
      if (violations.length > 0) {
        blocked.push({
          action: "确认试戴",
          patientName: patient.name,
          lensId: lens.id,
          params: violations.join("；"),
          rule: "参数超出适配范围，不能确认试戴",
        });
      }
      if (blocked.length > 0) return { ...s, conflicts: buildConflicts(s.conflicts, blocked) };

      return {
        ...s,
        sessions: s.sessions.map((x) => (x.id === sessionId ? { ...x, status: "confirmed" as const } : x)),
        patients: s.patients.map((p) => (p.id === patient.id ? { ...p, currentBatch: lens.batch } : p)),
      };
    });
  }

  /* ---------- 复查准入 ---------- */
  function submitReview(e: FormEvent) {
    e.preventDefault();
    setReviewError("");
    const patient = patientById.get(reviewForm.patientId);
    if (!patient) return setReviewError("请选择复查患者");

    const abnormal = reviewForm.lensFinding === "abnormal" || reviewForm.corneaFinding === "abnormal";
    const reason = reviewForm.reason.trim();

    const blocked: Array<Omit<Conflict, "id" | "at">> = [];
    if (!patient.currentBatch) {
      blocked.push({
        action: "登记复查",
        patientName: patient.name,
        lensId: "—",
        params: `承接批次：无（患者尚无已确认试戴批次）`,
        rule: "复查必须承接上次镜片批次",
      });
    }
    if (abnormal && !reason) {
      const parts = [
        reviewForm.lensFinding === "abnormal" ? "镜片异常" : "",
        reviewForm.corneaFinding === "abnormal" ? "角膜异常" : "",
      ].filter(Boolean);
      blocked.push({
        action: "登记复查",
        patientName: patient.name,
        lensId: "—",
        params: `承接批次 ${patient.currentBatch ?? "无"}；${parts.join("、")}，原因未填写`,
        rule: "镜片或角膜异常须写明原因并保留原批次",
      });
    }
    if (blocked.length > 0) {
      setLedger((s) => ({ ...s, conflicts: buildConflicts(s.conflicts, blocked) }));
      return;
    }

    const previousBatch = patient.currentBatch!;
    // 异常时保留原批次；正常时允许沿原批次继续或换发新批次
    const resultBatch = abnormal ? previousBatch : reviewForm.nextBatch || previousBatch;
    setLedger((s) => ({
      ...s,
      reviews: [
        {
          id: makeId("R", s.reviews.map((r) => r.id)),
          patientId: patient.id,
          date: new Date().toISOString(),
          previousBatch,
          resultBatch,
          lensFinding: reviewForm.lensFinding,
          corneaFinding: reviewForm.corneaFinding,
          reason: abnormal ? reason : "",
          keptOriginalBatch: resultBatch === previousBatch,
        },
        ...s.reviews,
      ],
      patients: s.patients.map((p) => (p.id === patient.id ? { ...p, currentBatch: resultBatch } : p)),
    }));
    setReviewForm({ patientId: "", lensFinding: "normal", corneaFinding: "normal", reason: "", nextBatch: "" });
  }

  function resetLedger() {
    setLedger(buildSeed());
    setPatientForm(emptyPatientForm);
    setEditingPatientId(null);
    setPatientError("");
    setSessionError("");
    setReviewError("");
  }

  /* ================= 渲染 ================= */

  const metrics = [
    { label: "在册患者", value: ledger.patients.length },
    { label: "试戴片占用中", value: activeSessions.length },
    { label: "已确认批次患者", value: confirmedPatients.length },
    { label: "拦截冲突", value: ledger.conflicts.length },
  ];

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-11 · port 5111 · 眼视光</p>
          <h1>角膜塑形镜试戴与复查准入台账</h1>
          <p className="subtitle">
            每名患者登记基弧、角膜曲率与散光；试戴片按左右眼型号占用，重叠时段不能重复分配；参数超出适配范围或试戴片未归还时不能确认试戴；复查承接上次镜片批次，镜片或角膜异常须写明原因并保留原批次。
          </p>
        </div>
        <div className="stack-card">
          <span>适配范围</span>
          <strong>基弧 7.50–8.60mm · 角膜曲率 40.00–46.00D · 散光 ≤1.50D</strong>
          <button onClick={resetLedger}>恢复示例数据</button>
        </div>
      </section>

      <section className="metrics-grid">
        {metrics.map((m, i) => (
          <MetricCard key={m.label} label={m.label} value={m.value} index={i} />
        ))}
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <h2>试戴片库存</h2>
          <div className="lens-list">
            {ledger.lenses.map((lens) => {
              const occupying = activeSessions.find((s) => s.lensId === lens.id);
              const occupant = occupying ? patientById.get(occupying.patientId) : undefined;
              return (
                <div className="lens-item" key={lens.id}>
                  <div>
                    <strong>{lens.id}</strong>
                    <p className="hint">
                      {eyeLabel(lens.eye)} · {lens.model} · BC {lens.baseCurve.toFixed(2)} · 批次 {lens.batch}
                      {occupant ? ` · 占用：${occupant.name}` : ""}
                    </p>
                  </div>
                  <span className={`badge ${occupying ? "badge-warn" : "badge-ok"}`}>{occupying ? "占用中" : "在库"}</span>
                </div>
              );
            })}
          </div>
          <h2>准入规则</h2>
          <ul className="rule-list">
            <li>试戴片按左右眼型号占用，同一镜片重叠时段不能重复分配</li>
            <li>参数超出适配范围或试戴片未归还，不能确认试戴</li>
            <li>复查必须承接上次镜片批次</li>
            <li>镜片或角膜异常须写明原因，并保留原批次</li>
            <li>参数修订全程留痕，刷新后记录不丢失</li>
          </ul>
        </aside>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p>患者台账</p>
              <h2>{editingPatientId ? "修订患者参数" : "患者登记"}</h2>
            </div>
            {editingPatientId && (
              <button
                onClick={() => {
                  setEditingPatientId(null);
                  setPatientForm(emptyPatientForm);
                  setPatientError("");
                }}
              >
                取消修订
              </button>
            )}
          </div>
          <form className="form-grid" onSubmit={submitPatient}>
            <label>
              <span>姓名</span>
              <input
                value={patientForm.name}
                onChange={(e) => setPatientForm({ ...patientForm, name: e.target.value })}
                placeholder="患者姓名"
              />
            </label>
            <label>
              <span>基弧（mm）</span>
              <input
                type="number"
                step="0.01"
                value={patientForm.baseCurve}
                onChange={(e) => setPatientForm({ ...patientForm, baseCurve: e.target.value })}
                placeholder="如 8.20"
              />
            </label>
            <label>
              <span>角膜曲率（D）</span>
              <input
                type="number"
                step="0.25"
                value={patientForm.keratometry}
                onChange={(e) => setPatientForm({ ...patientForm, keratometry: e.target.value })}
                placeholder="如 43.25"
              />
            </label>
            <label>
              <span>散光（D，负柱镜）</span>
              <input
                type="number"
                step="0.25"
                max="0"
                value={patientForm.astigmatism}
                onChange={(e) => setPatientForm({ ...patientForm, astigmatism: e.target.value })}
                placeholder="如 -0.75"
              />
            </label>
            {editingPatientId && (
              <label className="wide">
                <span>修订原因（必填，写入修订记录）</span>
                <input
                  value={patientForm.reason}
                  onChange={(e) => setPatientForm({ ...patientForm, reason: e.target.value })}
                  placeholder="如：复测角膜地形图后修正"
                />
              </label>
            )}
            {patientError && <p className="form-error wide">{patientError}</p>}
            <div className="wide">
              <button type="submit" className="primary-action">
                {editingPatientId ? "保存修订" : "登记患者"}
              </button>
            </div>
          </form>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>编号</th>
                  <th>姓名</th>
                  <th>基弧</th>
                  <th>角膜曲率</th>
                  <th>散光</th>
                  <th>适配评估</th>
                  <th>当前批次</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {ledger.patients.map((p) => {
                  const violations = fitViolations(p);
                  return (
                    <tr key={p.id}>
                      <td>{p.id}</td>
                      <td>{p.name}</td>
                      <td>{p.baseCurve.toFixed(2)}mm</td>
                      <td>{p.keratometry.toFixed(2)}D</td>
                      <td>{p.astigmatism.toFixed(2)}D</td>
                      <td>
                        {violations.length === 0 ? (
                          <span className="badge badge-ok">适配内</span>
                        ) : (
                          <span className="badge badge-danger" title={violations.join("；")}>
                            超范围 {violations.length} 项
                          </span>
                        )}
                      </td>
                      <td>{p.currentBatch ?? <span className="hint">未确认</span>}</td>
                      <td>
                        <button className="small-btn" onClick={() => startEditPatient(p.id)}>
                          修订参数
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      <section className="panel section-gap">
        <div className="section-heading">
          <div>
            <p>试戴管理</p>
            <h2>试戴片占用登记</h2>
          </div>
        </div>
        <form className="form-grid" onSubmit={submitSession}>
          <label>
            <span>患者</span>
            <select value={sessionForm.patientId} onChange={(e) => setSessionForm({ ...sessionForm, patientId: e.target.value })}>
              <option value="">请选择患者</option>
              {ledger.patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}（{p.id}）
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>眼别</span>
            <select
              value={sessionForm.eye}
              onChange={(e) => setSessionForm({ ...sessionForm, eye: e.target.value as EyeSide, lensId: "" })}
            >
              <option value="OD">右眼 OD</option>
              <option value="OS">左眼 OS</option>
            </select>
          </label>
          <label>
            <span>试戴片（按眼别型号）</span>
            <select value={sessionForm.lensId} onChange={(e) => setSessionForm({ ...sessionForm, lensId: e.target.value })}>
              <option value="">请选择试戴片</option>
              {ledger.lenses
                .filter((l) => l.eye === sessionForm.eye)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.id} · {l.model} · BC {l.baseCurve.toFixed(2)} · {l.batch}
                    {occupiedLensIds.has(l.id) ? "（占用中）" : ""}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>开始时间</span>
            <input type="datetime-local" value={sessionForm.start} onChange={(e) => setSessionForm({ ...sessionForm, start: e.target.value })} />
          </label>
          <label>
            <span>结束时间</span>
            <input type="datetime-local" value={sessionForm.end} onChange={(e) => setSessionForm({ ...sessionForm, end: e.target.value })} />
          </label>
          {sessionError && <p className="form-error wide">{sessionError}</p>}
          <div className="wide">
            <button type="submit" className="primary-action">
              登记占用
            </button>
          </div>
        </form>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>编号</th>
                <th>患者</th>
                <th>镜片编号</th>
                <th>眼别</th>
                <th>批次</th>
                <th>试戴时段</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {ledger.sessions.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty">
                    暂无试戴记录
                  </td>
                </tr>
              )}
              {[...ledger.sessions].reverse().map((s) => {
                const patient = patientById.get(s.patientId);
                const lens = lensById.get(s.lensId);
                const meta = sessionStatusMeta[s.status];
                return (
                  <tr key={s.id}>
                    <td>{s.id}</td>
                    <td>{patient?.name ?? s.patientId}</td>
                    <td>{s.lensId}</td>
                    <td>{eyeLabel(s.eye)}</td>
                    <td>{lens?.batch ?? "—"}</td>
                    <td>
                      {fmtDT(s.start)} – {fmtDT(s.end)}
                    </td>
                    <td>
                      <span className={`badge ${meta.badge}`}>{meta.text}</span>
                    </td>
                    <td>
                      <div className="row-actions">
                        {s.status === "active" && (
                          <button className="small-btn" onClick={() => returnLens(s.id)}>
                            登记归还
                          </button>
                        )}
                        {s.status !== "confirmed" && (
                          <button className="small-btn primary-action" onClick={() => confirmSession(s.id)}>
                            确认试戴
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel section-gap">
        <div className="section-heading">
          <div>
            <p>复查准入</p>
            <h2>复查登记（承接上次镜片批次）</h2>
          </div>
        </div>
        <form className="form-grid" onSubmit={submitReview}>
          <label>
            <span>复查患者</span>
            <select
              value={reviewForm.patientId}
              onChange={(e) => setReviewForm({ ...reviewForm, patientId: e.target.value, nextBatch: "" })}
            >
              <option value="">请选择患者</option>
              {ledger.patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}（{p.currentBatch ? `批次 ${p.currentBatch}` : "无已确认批次"}）
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>镜片状态</span>
            <select value={reviewForm.lensFinding} onChange={(e) => setReviewForm({ ...reviewForm, lensFinding: e.target.value as Finding })}>
              <option value="normal">正常</option>
              <option value="abnormal">异常</option>
            </select>
          </label>
          <label>
            <span>角膜状态</span>
            <select
              value={reviewForm.corneaFinding}
              onChange={(e) => setReviewForm({ ...reviewForm, corneaFinding: e.target.value as Finding })}
            >
              <option value="normal">正常</option>
              <option value="abnormal">异常</option>
            </select>
          </label>
          <label>
            <span>结果批次{reviewAbnormal ? "（异常保留原批次）" : ""}</span>
            <select
              value={reviewAbnormal ? reviewPatient?.currentBatch ?? "" : reviewForm.nextBatch || reviewPatient?.currentBatch || ""}
              disabled={reviewAbnormal || !reviewPatient?.currentBatch}
              onChange={(e) => setReviewForm({ ...reviewForm, nextBatch: e.target.value })}
            >
              {!reviewPatient?.currentBatch && <option value="">无承接批次</option>}
              {reviewPatient?.currentBatch &&
                batches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                    {b === reviewPatient.currentBatch ? "（原批次）" : ""}
                  </option>
                ))}
            </select>
          </label>
          <label className="wide">
            <span>异常原因{reviewAbnormal ? "（必填）" : "（正常时留空）"}</span>
            <input
              value={reviewForm.reason}
              onChange={(e) => setReviewForm({ ...reviewForm, reason: e.target.value })}
              placeholder="如：镜片划痕，角膜点染 1 级"
            />
          </label>
          <p className="hint wide">
            承接批次：{reviewPatient ? reviewPatient.currentBatch ?? "无 — 需先确认试戴" : "未选择患者"}
          </p>
          {reviewError && <p className="form-error wide">{reviewError}</p>}
          <div className="wide">
            <button type="submit" className="primary-action">
              登记复查
            </button>
          </div>
        </form>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>编号</th>
                <th>日期</th>
                <th>患者</th>
                <th>承接批次</th>
                <th>结果批次</th>
                <th>镜片</th>
                <th>角膜</th>
                <th>异常原因</th>
                <th>批次处理</th>
              </tr>
            </thead>
            <tbody>
              {ledger.reviews.length === 0 && (
                <tr>
                  <td colSpan={9} className="empty">
                    暂无复查记录
                  </td>
                </tr>
              )}
              {ledger.reviews.map((r) => {
                const patient = patientById.get(r.patientId);
                const abnormal = r.lensFinding === "abnormal" || r.corneaFinding === "abnormal";
                return (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{fmtDT(r.date)}</td>
                    <td>{patient?.name ?? r.patientId}</td>
                    <td>{r.previousBatch}</td>
                    <td>{r.resultBatch}</td>
                    <td>
                      <span className={`badge ${r.lensFinding === "normal" ? "badge-ok" : "badge-danger"}`}>
                        {r.lensFinding === "normal" ? "正常" : "异常"}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${r.corneaFinding === "normal" ? "badge-ok" : "badge-danger"}`}>
                        {r.corneaFinding === "normal" ? "正常" : "异常"}
                      </span>
                    </td>
                    <td>{abnormal ? r.reason : <span className="hint">—</span>}</td>
                    <td>{r.keptOriginalBatch ? "保留原批次" : "更新批次"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel section-gap">
        <div className="section-heading">
          <div>
            <p>留痕</p>
            <h2>修订记录</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>编号</th>
                <th>时间</th>
                <th>患者</th>
                <th>字段</th>
                <th>原值</th>
                <th>新值</th>
                <th>修订原因</th>
              </tr>
            </thead>
            <tbody>
              {ledger.revisions.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty">
                    暂无修订记录
                  </td>
                </tr>
              )}
              {ledger.revisions.map((r) => {
                const patient = patientById.get(r.patientId);
                return (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{fmtDT(r.at)}</td>
                    <td>{patient?.name ?? r.patientId}</td>
                    <td>{r.field}</td>
                    <td>{r.oldValue}</td>
                    <td>{r.newValue}</td>
                    <td>{r.reason}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>准入拦截</p>
            <h2>冲突记录（患者 · 镜片编号 · 参数 · 命中限制）</h2>
          </div>
          {ledger.conflicts.length > 0 && (
            <button onClick={() => setLedger((s) => ({ ...s, conflicts: [] }))}>清空冲突记录</button>
          )}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>编号</th>
                <th>时间</th>
                <th>操作</th>
                <th>患者</th>
                <th>镜片编号</th>
                <th>参数</th>
                <th>命中的限制</th>
              </tr>
            </thead>
            <tbody>
              {ledger.conflicts.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty">
                    暂无冲突，所有操作均通过准入校验
                  </td>
                </tr>
              )}
              {ledger.conflicts.map((c) => (
                <tr key={c.id}>
                  <td>{c.id}</td>
                  <td>{fmtDT(c.at)}</td>
                  <td>{c.action}</td>
                  <td>{c.patientName}</td>
                  <td>{c.lensId}</td>
                  <td>{c.params}</td>
                  <td className="conflict-rule">{c.rule}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

export default App;
