import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import {
  EYE_LABEL,
  EyeSide,
  FollowUp,
  LedgerState,
  Patient,
  RULES,
  TRIAL_LENSES,
  TrialSession,
  fittingCheck,
  lensOverlapConflicts,
  loadState,
  reconcile,
  resetStorage,
  saveState,
  seedState,
  unreturnedSession,
} from "./domain";

const STATUS_LABEL: Record<TrialSession["status"], string> = {
  scheduled: "已预约",
  confirmed: "试戴中·未归还",
  returned: "已归还",
  cancelled: "已取消",
};

const STATUS_CLASS: Record<TrialSession["status"], string> = {
  scheduled: "pill pill-info",
  confirmed: "pill pill-warn",
  returned: "pill pill-ok",
  cancelled: "pill pill-muted",
};

const pad = (n: number) => String(n).padStart(2, "0");

function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtDT(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDateTimeFull(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ruleCode(rule: string): string {
  return rule.split(" ")[0];
}

function addRevision(s: LedgerState, action: string, detail: string, actor = "验光师"): LedgerState {
  return {
    ...s,
    revisions: [
      { id: `V-${s.revisions.length + 1}`, at: new Date().toISOString(), actor, action, detail },
      ...s.revisions,
    ],
  };
}

function addConflict(
  s: LedgerState,
  c: Omit<LedgerState["conflicts"][number], "id" | "at">
): LedgerState {
  return {
    ...s,
    conflicts: [{ ...c, id: `C-${s.conflicts.length + 1}`, at: new Date().toISOString() }, ...s.conflicts],
  };
}

// ---------- 表单值类型 ----------

interface EyeFormValues {
  baseCurve: string;
  flatK: string;
  astigmatism: string;
}

interface PatientFormValues {
  name: string;
  age: string;
  eyes: Record<EyeSide, EyeFormValues>;
}

interface SessionFormValues {
  patientId: string;
  lensIds: string[];
  start: string;
  end: string;
}

interface FollowUpFormValues {
  patientId: string;
  date: string;
  batch: string;
  lensAbnormal: boolean;
  corneaAbnormal: boolean;
  reason: string;
}

// ---------- 小组件 ----------

function MetricCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <i className={tone} />
    </article>
  );
}

function EyeParamsCell({ eye, p }: { eye: EyeSide; p: Patient["eyes"][EyeSide] }) {
  return (
    <td>
      <div className="param-cell">
        <em>{EYE_LABEL[eye]}</em>
        <span>基弧 {p.baseCurve.toFixed(2)}mm</span>
        <span>平K {p.flatK.toFixed(2)}D</span>
        <span>散光 {p.astigmatism.toFixed(2)}D</span>
      </div>
    </td>
  );
}

// ---------- 患者登记 ----------

function PatientPanel({
  patients,
  onAdd,
}: {
  patients: Patient[];
  onAdd: (v: PatientFormValues) => string | null;
}) {
  const emptyEye: EyeFormValues = { baseCurve: "", flatK: "", astigmatism: "" };
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [eyes, setEyes] = useState<Record<EyeSide, EyeFormValues>>({
    OD: { ...emptyEye },
    OS: { ...emptyEye },
  });
  const [error, setError] = useState<string | null>(null);

  const setEye = (eye: EyeSide, key: keyof EyeFormValues, value: string) =>
    setEyes((prev) => ({ ...prev, [eye]: { ...prev[eye], [key]: value } }));

  const submit = () => {
    const err = onAdd({ name, age, eyes });
    setError(err);
    if (!err) {
      setName("");
      setAge("");
      setEyes({ OD: { ...emptyEye }, OS: { ...emptyEye } });
    }
  };

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>患者登记</p>
          <h2>基弧 · 角膜曲率 · 散光</h2>
        </div>
        <button className="primary-action" onClick={submit}>
          登记患者
        </button>
      </div>
      <div className="form-grid">
        <label>
          <span>姓名</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="患者姓名" />
        </label>
        <label>
          <span>年龄</span>
          <input
            value={age}
            onChange={(e) => setAge(e.target.value)}
            placeholder="岁"
            type="number"
            min="1"
          />
        </label>
        {(["OD", "OS"] as EyeSide[]).map((eye) => (
          <fieldset className="eye-fieldset" key={eye}>
            <legend>{EYE_LABEL[eye]}参数</legend>
            <div className="eye-grid">
              <label>
                <span>基弧(mm)</span>
                <input
                  value={eyes[eye].baseCurve}
                  onChange={(e) => setEye(eye, "baseCurve", e.target.value)}
                  placeholder="如 7.85"
                  type="number"
                  step="0.05"
                />
              </label>
              <label>
                <span>角膜曲率·平K(D)</span>
                <input
                  value={eyes[eye].flatK}
                  onChange={(e) => setEye(eye, "flatK", e.target.value)}
                  placeholder="如 43.00"
                  type="number"
                  step="0.25"
                />
              </label>
              <label>
                <span>散光(D)</span>
                <input
                  value={eyes[eye].astigmatism}
                  onChange={(e) => setEye(eye, "astigmatism", e.target.value)}
                  placeholder="如 0.75"
                  type="number"
                  step="0.25"
                  min="0"
                />
              </label>
            </div>
          </fieldset>
        ))}
      </div>
      {error && <p className="form-error">{error}</p>}

      <table className="ledger-table">
        <thead>
          <tr>
            <th>编号</th>
            <th>患者</th>
            <th>右眼</th>
            <th>左眼</th>
            <th>适配判定</th>
            <th>当前批次</th>
          </tr>
        </thead>
        <tbody>
          {patients.map((p) => {
            const fit = fittingCheck(p);
            return (
              <tr key={p.id}>
                <td>{p.id}</td>
                <td>
                  {p.name} · {p.age}岁
                </td>
                <EyeParamsCell eye="OD" p={p.eyes.OD} />
                <EyeParamsCell eye="OS" p={p.eyes.OS} />
                <td>
                  {fit.rules.length ? (
                    <span className="pill pill-danger" title={fit.params.join("；")}>
                      超出 {fit.rules.map(ruleCode).join("/")}
                    </span>
                  ) : (
                    <span className="pill pill-ok">符合</span>
                  )}
                </td>
                <td>
                  <code>{p.currentBatch ?? "—"}</code>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

// ---------- 试戴安排 ----------

function SessionPanel({
  state,
  patientById,
  occupancy,
  onSchedule,
  onConfirm,
  onReturn,
  onCancel,
}: {
  state: LedgerState;
  patientById: Map<string, Patient>;
  occupancy: Map<string, TrialSession>;
  onSchedule: (v: SessionFormValues) => string | null;
  onConfirm: (id: string) => void;
  onReturn: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
  const [patientId, setPatientId] = useState("");
  const [lensIds, setLensIds] = useState<string[]>([]);
  const [start, setStart] = useState(toLocalInput(new Date(tomorrow.setHours(9, 0, 0, 0))));
  const [end, setEnd] = useState(toLocalInput(new Date(tomorrow.setHours(10, 0, 0, 0))));
  const [error, setError] = useState<string | null>(null);

  const toggleLens = (id: string) =>
    setLensIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const submit = () => {
    const err = onSchedule({ patientId, lensIds, start, end });
    setError(err);
    if (!err) setLensIds([]);
  };

  const sessions = [...state.sessions].sort((a, b) => Date.parse(b.start) - Date.parse(a.start));

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>试戴安排</p>
          <h2>试戴片按左右眼型号占用 · 重叠时段互斥</h2>
        </div>
        <button className="primary-action" onClick={submit}>
          预约试戴
        </button>
      </div>
      <div className="form-grid">
        <label>
          <span>患者</span>
          <select value={patientId} onChange={(e) => setPatientId(e.target.value)}>
            <option value="">请选择</option>
            {state.patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}({p.id})
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>开始时间</span>
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          <span>结束时间</span>
          <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      <div className="lens-picker">
        {(["OD", "OS"] as EyeSide[]).map((eye) => (
          <div key={eye} className="lens-picker-group">
            <strong>{EYE_LABEL[eye]}试戴片</strong>
            <div className="chips">
              {TRIAL_LENSES.filter((l) => l.eye === eye).map((lens) => {
                const occ = occupancy.get(lens.id);
                const occPatient = occ ? patientById.get(occ.patientId) : undefined;
                const checked = lensIds.includes(lens.id);
                return (
                  <button
                    key={lens.id}
                    type="button"
                    className={"lens-chip" + (checked ? " selected" : "") + (occ ? " busy" : "")}
                    onClick={() => toggleLens(lens.id)}
                    title={
                      occ
                        ? `占用中:${occPatient?.name ?? occ.patientId} ${fmtDT(occ.start)}–${fmtDT(occ.end)}`
                        : "在架"
                    }
                  >
                    {lens.id}
                    <small>
                      {lens.model} · 基弧{lens.baseCurve.toFixed(2)}
                      {occ ? ` · 占用中(${occPatient?.name ?? "?"})` : ""}
                    </small>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {error && <p className="form-error">{error}</p>}

      <table className="ledger-table">
        <thead>
          <tr>
            <th>试戴单</th>
            <th>患者</th>
            <th>试戴片</th>
            <th>时段</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => {
            const p = patientById.get(s.patientId);
            return (
              <tr key={s.id}>
                <td>{s.id}</td>
                <td>{p ? `${p.name}(${p.id})` : s.patientId}</td>
                <td>
                  {s.lensIds.map((id) => (
                    <code key={id} className="lens-code">
                      {id}
                    </code>
                  ))}
                </td>
                <td>
                  {fmtDT(s.start)} – {fmtDT(s.end)}
                </td>
                <td>
                  <span className={STATUS_CLASS[s.status]}>{STATUS_LABEL[s.status]}</span>
                </td>
                <td className="row-actions">
                  {s.status === "scheduled" && (
                    <>
                      <button onClick={() => onConfirm(s.id)}>确认试戴</button>
                      <button onClick={() => onCancel(s.id)}>取消</button>
                    </>
                  )}
                  {s.status === "confirmed" && <button onClick={() => onReturn(s.id)}>登记归还</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

// ---------- 复查登记 ----------

function FollowUpPanel({
  state,
  patientById,
  onAdd,
}: {
  state: LedgerState;
  patientById: Map<string, Patient>;
  onAdd: (v: FollowUpFormValues) => string | null;
}) {
  const [patientId, setPatientId] = useState("");
  const [date, setDate] = useState(toDateInput(new Date()));
  const [batch, setBatch] = useState("");
  const [lensAbnormal, setLensAbnormal] = useState(false);
  const [corneaAbnormal, setCorneaAbnormal] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const patient = patientId ? patientById.get(patientId) : undefined;

  const pickPatient = (id: string) => {
    setPatientId(id);
    const p = patientById.get(id);
    setBatch(p?.currentBatch ?? "");
  };

  const submit = () => {
    const err = onAdd({ patientId, date, batch, lensAbnormal, corneaAbnormal, reason });
    setError(err);
    if (!err) {
      setLensAbnormal(false);
      setCorneaAbnormal(false);
      setReason("");
    }
  };

  const followUps = [...state.followUps].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>复查登记</p>
          <h2>承接上次镜片批次 · 异常保留原批次</h2>
        </div>
        <button className="primary-action" onClick={submit}>
          登记复查
        </button>
      </div>
      <div className="form-grid">
        <label>
          <span>患者</span>
          <select value={patientId} onChange={(e) => pickPatient(e.target.value)}>
            <option value="">请选择</option>
            {state.patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}({p.id})
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>复查日期</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          <span>镜片批次(须承接上次批次{patient?.currentBatch ? `:${patient.currentBatch}` : ",该患者暂无批次"})</span>
          <input value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="如 P-004-B01" />
        </label>
        <div className="check-row">
          <label className="check-label">
            <input
              type="checkbox"
              checked={lensAbnormal}
              onChange={(e) => setLensAbnormal(e.target.checked)}
            />
            <span>镜片异常</span>
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={corneaAbnormal}
              onChange={(e) => setCorneaAbnormal(e.target.checked)}
            />
            <span>角膜异常</span>
          </label>
        </div>
      </div>
      {(lensAbnormal || corneaAbnormal) && (
        <label className="reason-field">
          <span>异常原因(必填,登记后保留原批次)</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="如:右眼角膜点染Ⅰ级,停戴3天并用药"
            rows={2}
          />
        </label>
      )}
      {error && <p className="form-error">{error}</p>}

      <table className="ledger-table">
        <thead>
          <tr>
            <th>复查单</th>
            <th>患者</th>
            <th>日期</th>
            <th>批次</th>
            <th>异常</th>
            <th>原因 / 批次处理</th>
          </tr>
        </thead>
        <tbody>
          {followUps.map((f: FollowUp) => {
            const p = patientById.get(f.patientId);
            const abnormal = f.lensAbnormal || f.corneaAbnormal;
            return (
              <tr key={f.id}>
                <td>{f.id}</td>
                <td>{p ? `${p.name}(${p.id})` : f.patientId}</td>
                <td>{f.date}</td>
                <td>
                  <code>{f.batch}</code>
                </td>
                <td>
                  {abnormal ? (
                    <span className="pill pill-danger">
                      {[f.lensAbnormal && "镜片", f.corneaAbnormal && "角膜"].filter(Boolean).join("+")}异常
                    </span>
                  ) : (
                    <span className="pill pill-ok">正常</span>
                  )}
                </td>
                <td>
                  {abnormal ? (
                    <>
                      {f.reason}
                      <span className="pill pill-warn kept">保留原批次</span>
                    </>
                  ) : (
                    "承接上次批次"
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

// ---------- 主应用 ----------

function App() {
  const [state, setState] = useState<LedgerState>(() => reconcile(loadState()));
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    saveState(state);
  }, [state]);

  const patientById = useMemo(() => new Map(state.patients.map((p) => [p.id, p])), [state.patients]);

  const occupancy = useMemo(() => {
    const map = new Map<string, TrialSession>();
    state.sessions.forEach((s) => {
      if (s.status === "scheduled" || s.status === "confirmed") {
        s.lensIds.forEach((id) => map.set(id, s));
      }
    });
    return map;
  }, [state.sessions]);

  // 患者登记
  const handleAddPatient = (form: PatientFormValues): string | null => {
    if (!form.name.trim()) return "请填写患者姓名";
    const age = Number(form.age);
    if (!age || age <= 0) return "请填写有效年龄";
    for (const eye of ["OD", "OS"] as EyeSide[]) {
      const e = form.eyes[eye];
      if (!e.baseCurve || !e.flatK || e.astigmatism === "") return `请完整填写${EYE_LABEL[eye]}参数`;
    }
    setState((prev) => {
      const id = `P-${String(prev.patients.length + 1).padStart(3, "0")}`;
      const patient: Patient = {
        id,
        name: form.name.trim(),
        age,
        eyes: {
          OD: {
            baseCurve: Number(form.eyes.OD.baseCurve),
            flatK: Number(form.eyes.OD.flatK),
            astigmatism: Number(form.eyes.OD.astigmatism),
          },
          OS: {
            baseCurve: Number(form.eyes.OS.baseCurve),
            flatK: Number(form.eyes.OS.flatK),
            astigmatism: Number(form.eyes.OS.astigmatism),
          },
        },
        currentBatch: null,
        createdAt: new Date().toISOString(),
      };
      return addRevision(
        { ...prev, patients: [...prev.patients, patient] },
        "患者登记",
        `${patient.name}(${id}) 登记基弧/角膜曲率/散光`
      );
    });
    setNotice("患者已登记");
    return null;
  };

  // 预约试戴:R4 时段互斥
  const handleSchedule = (v: SessionFormValues): string | null => {
    const patient = patientById.get(v.patientId);
    if (!patient) return "请选择患者";
    if (!v.lensIds.length) return "请至少选择一片试戴片";
    if (!v.start || !v.end) return "请填写试戴时段";
    if (Date.parse(v.start) >= Date.parse(v.end)) return "结束时间须晚于开始时间";

    const hits = lensOverlapConflicts(state, v.lensIds, v.start, v.end);
    if (hits.length) {
      const hitLens = [...new Set(hits.map((h) => h.lensId))];
      setState((prev) =>
        addRevision(
          addConflict(prev, {
            action: "试戴预约拦截",
            patientId: patient.id,
            patientName: patient.name,
            lensIds: hitLens,
            params: `申请时段 ${fmtDT(v.start)}–${fmtDT(v.end)},与 ${[...new Set(hits.map((h) => h.session.id))].join("、")} 重叠`,
            rules: [RULES.R4],
          }),
          "试戴预约拦截",
          `${patient.name}(${patient.id}) 试戴片 ${hitLens.join("/")} 时段冲突`
        )
      );
      setNotice(`已拦截:${hitLens.join("、")} 在申请时段已被占用`);
      return `时段冲突:${hitLens.join("、")} 已被占用,请调整时段或更换试戴片`;
    }

    setState((prev) => {
      const id = `S-${String(prev.sessions.length + 1).padStart(3, "0")}`;
      const session: TrialSession = {
        id,
        patientId: patient.id,
        lensIds: v.lensIds,
        start: v.start,
        end: v.end,
        status: "scheduled",
        createdAt: new Date().toISOString(),
      };
      return addRevision(
        { ...prev, sessions: [...prev.sessions, session] },
        "预约试戴",
        `${patient.name}(${patient.id}) 预约 ${v.lensIds.join("/")},${fmtDT(v.start)}–${fmtDT(v.end)}`
      );
    });
    setNotice(`已预约试戴:${patient.name}`);
    return null;
  };

  // 确认试戴:R1–R3 适配范围、R5 未归还、R4 时段复核
  const handleConfirm = (sessionId: string) => {
    const session = state.sessions.find((s) => s.id === sessionId);
    if (!session || session.status !== "scheduled") return;
    const patient = patientById.get(session.patientId);
    if (!patient) return;

    const fit = fittingCheck(patient);
    if (fit.rules.length) {
      setState((prev) =>
        addRevision(
          addConflict(prev, {
            action: "试戴确认拦截",
            patientId: patient.id,
            patientName: patient.name,
            lensIds: session.lensIds,
            params: fit.params.join("；"),
            rules: fit.rules,
          }),
          "试戴确认拦截",
          `${patient.name}(${patient.id}) 参数超出适配范围:${fit.params.join("；")}`
        )
      );
      setNotice(`已拦截:${patient.name} 参数超出适配范围(${fit.rules.map(ruleCode).join("/")})`);
      return;
    }

    const outstanding = unreturnedSession(state, patient.id, session.id);
    if (outstanding) {
      setState((prev) =>
        addRevision(
          addConflict(prev, {
            action: "试戴确认拦截",
            patientId: patient.id,
            patientName: patient.name,
            lensIds: outstanding.lensIds,
            params: `试戴单 ${outstanding.id} 的 ${outstanding.lensIds.join("/")} 尚未归还`,
            rules: [RULES.R5],
          }),
          "试戴确认拦截",
          `${patient.name}(${patient.id}) 存在未归还试戴片`
        )
      );
      setNotice(`已拦截:${patient.name} 有试戴片未归还`);
      return;
    }

    const hits = lensOverlapConflicts(state, session.lensIds, session.start, session.end, session.id);
    if (hits.length) {
      const hitLens = [...new Set(hits.map((h) => h.lensId))];
      setState((prev) =>
        addRevision(
          addConflict(prev, {
            action: "试戴确认拦截",
            patientId: patient.id,
            patientName: patient.name,
            lensIds: hitLens,
            params: `与 ${[...new Set(hits.map((h) => h.session.id))].join("、")} 时段重叠`,
            rules: [RULES.R4],
          }),
          "试戴确认拦截",
          `${patient.name}(${patient.id}) 试戴片时段冲突`
        )
      );
      setNotice("已拦截:试戴片时段冲突");
      return;
    }

    setState((prev) => {
      const batch = patient.currentBatch ?? `${patient.id}-B01`;
      const sessions = prev.sessions.map((s) =>
        s.id === sessionId ? { ...s, status: "confirmed" as const } : s
      );
      const patients = prev.patients.map((p) =>
        p.id === patient.id ? { ...p, currentBatch: batch } : p
      );
      return addRevision(
        { ...prev, sessions, patients },
        "确认试戴",
        `${patient.name}(${patient.id}) 确认试戴 ${session.lensIds.join("/")},批次 ${batch}`
      );
    });
    setNotice(`已确认试戴:${patient.name}`);
  };

  const handleReturn = (sessionId: string) => {
    const session = state.sessions.find((s) => s.id === sessionId);
    if (!session || session.status !== "confirmed") return;
    const patient = patientById.get(session.patientId);
    setState((prev) =>
      addRevision(
        {
          ...prev,
          sessions: prev.sessions.map((s) =>
            s.id === sessionId ? { ...s, status: "returned" as const } : s
          ),
        },
        "试戴片归还",
        `${patient?.name ?? session.patientId}(${session.patientId}) 归还 ${session.lensIds.join("/")}`
      )
    );
    setNotice("试戴片已登记归还");
  };

  const handleCancel = (sessionId: string) => {
    const session = state.sessions.find((s) => s.id === sessionId);
    if (!session || session.status !== "scheduled") return;
    const patient = patientById.get(session.patientId);
    setState((prev) =>
      addRevision(
        {
          ...prev,
          sessions: prev.sessions.map((s) =>
            s.id === sessionId ? { ...s, status: "cancelled" as const } : s
          ),
        },
        "取消试戴",
        `${patient?.name ?? session.patientId}(${session.patientId}) 取消试戴单 ${session.id}`
      )
    );
    setNotice("试戴已取消");
  };

  // 复查登记:R6 批次承接、R7 异常原因+保留原批次
  const handleFollowUp = (v: FollowUpFormValues): string | null => {
    const patient = patientById.get(v.patientId);
    if (!patient) return "请选择患者";
    if (!v.date) return "请选择复查日期";
    const abnormal = v.lensAbnormal || v.corneaAbnormal;
    const abnormalLabel = [v.lensAbnormal && "镜片异常", v.corneaAbnormal && "角膜异常"]
      .filter(Boolean)
      .join("+");

    if (!patient.currentBatch) {
      setState((prev) =>
        addRevision(
          addConflict(prev, {
            action: "复查登记拦截",
            patientId: patient.id,
            patientName: patient.name,
            lensIds: [],
            params: "尚无已确认试戴,无在册镜片批次",
            rules: [RULES.R6],
          }),
          "复查登记拦截",
          `${patient.name}(${patient.id}) 无在册批次`,
          "复查医生"
        )
      );
      setNotice(`已拦截:${patient.name} 无在册镜片批次`);
      return "该患者尚无在册镜片批次,请先完成试戴确认";
    }
    if (v.batch.trim() !== patient.currentBatch) {
      setState((prev) =>
        addRevision(
          addConflict(prev, {
            action: "复查登记拦截",
            patientId: patient.id,
            patientName: patient.name,
            lensIds: [],
            params: `填写批次 ${v.batch.trim() || "(空)"},上次批次 ${patient.currentBatch}`,
            rules: [RULES.R6],
          }),
          "复查登记拦截",
          `${patient.name}(${patient.id}) 复查批次不承接`,
          "复查医生"
        )
      );
      setNotice(`已拦截:复查批次须承接 ${patient.currentBatch}`);
      return `复查批次须承接上次批次 ${patient.currentBatch}`;
    }
    if (abnormal && !v.reason.trim()) {
      setState((prev) =>
        addRevision(
          addConflict(prev, {
            action: "复查登记拦截",
            patientId: patient.id,
            patientName: patient.name,
            lensIds: [],
            params: `${abnormalLabel} 未填写原因`,
            rules: [RULES.R7],
          }),
          "复查登记拦截",
          `${patient.name}(${patient.id}) ${abnormalLabel}未写明原因`,
          "复查医生"
        )
      );
      setNotice("已拦截:异常须写明原因");
      return "存在镜片/角膜异常时须写明原因";
    }

    setState((prev) => {
      const id = `F-${String(prev.followUps.length + 1).padStart(3, "0")}`;
      const followUp: FollowUp = {
        id,
        patientId: patient.id,
        date: v.date,
        batch: patient.currentBatch as string,
        lensAbnormal: v.lensAbnormal,
        corneaAbnormal: v.corneaAbnormal,
        reason: v.reason.trim(),
        keptBatch: abnormal,
        createdAt: new Date().toISOString(),
      };
      const detail = abnormal
        ? `${patient.name}(${patient.id}) 复查:${abnormalLabel},原因:${v.reason.trim()},保留原批次 ${patient.currentBatch}`
        : `${patient.name}(${patient.id}) 复查正常,承接批次 ${patient.currentBatch}`;
      return addRevision({ ...prev, followUps: [...prev.followUps, followUp] }, "复查登记", detail, "复查医生");
    });
    setNotice(`已登记复查:${patient.name}${abnormal ? "(保留原批次)" : ""}`);
    return null;
  };

  const handleReset = () => {
    resetStorage();
    setState(reconcile(seedState()));
    setNotice("已恢复演示数据");
  };

  const conflicts = [...state.conflicts].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-11 · port 5111 · 眼视光</p>
          <h1>角膜塑形镜试戴与复查准入台账</h1>
          <p className="subtitle">
            患者登记基弧、角膜曲率与散光;试戴片按左右眼型号占用,重叠时段不得重复分配;
            参数超出适配范围或试戴片未归还不得确认试戴;复查承接上次镜片批次,
            镜片或角膜异常须写明原因并保留原批次。
          </p>
        </div>
        <div className="stack-card">
          <span>技术栈</span>
          <strong>React + Vite + TypeScript + CSS</strong>
          <span>localStorage 本地持久化 · 刷新后自动校验患者/试戴占用/复查/修订记录对应关系</span>
          <button onClick={handleReset}>恢复演示数据</button>
        </div>
      </section>

      {notice && (
        <div className="notice">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)}>知道了</button>
        </div>
      )}

      <section className="metrics-grid">
        <MetricCard label="在册患者" value={state.patients.length} tone="status-ok" />
        <MetricCard label="试戴片占用中" value={occupancy.size} tone="status-watch" />
        <MetricCard label="复查记录" value={state.followUps.length} tone="status-ok" />
        <MetricCard label="拦截冲突" value={state.conflicts.length} tone="status-danger" />
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <h2>准入限制</h2>
          <ul className="rule-list">
            {Object.values(RULES).map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <h2>试戴片库存</h2>
          <div className="lens-list">
            {TRIAL_LENSES.map((lens) => {
              const occ = occupancy.get(lens.id);
              const p = occ ? patientById.get(occ.patientId) : undefined;
              return (
                <div key={lens.id} className={"lens-item" + (occ ? " busy" : "")}>
                  <div>
                    <strong>{lens.id}</strong>
                    <span>
                      {EYE_LABEL[lens.eye]} · {lens.model} · 基弧{lens.baseCurve.toFixed(2)} ·{" "}
                      {lens.power.toFixed(2)}D
                    </span>
                  </div>
                  {occ ? (
                    <em>
                      {occ.status === "confirmed" ? "试戴中" : "已预约"} · {p?.name ?? occ.patientId}
                    </em>
                  ) : (
                    <em className="free">在架</em>
                  )}
                </div>
              );
            })}
          </div>
          <h2>角色</h2>
          <div className="chips">
            <span>验光师</span>
            <span>配镜顾问</span>
            <span>复查医生</span>
          </div>
        </aside>

        <div className="stack">
          <PatientPanel patients={state.patients} onAdd={handleAddPatient} />
          <SessionPanel
            state={state}
            patientById={patientById}
            occupancy={occupancy}
            onSchedule={handleSchedule}
            onConfirm={handleConfirm}
            onReturn={handleReturn}
            onCancel={handleCancel}
          />
          <FollowUpPanel state={state} patientById={patientById} onAdd={handleFollowUp} />
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>冲突与拦截</p>
            <h2>患者 · 镜片编号 · 参数 · 命中的限制</h2>
          </div>
        </div>
        {conflicts.length === 0 ? (
          <p className="empty-hint">暂无冲突记录。被拦截的预约、确认与复查会在此列出。</p>
        ) : (
          <div className="conflict-list">
            {conflicts.map((c) => (
              <article key={c.id} className="conflict-card">
                <header>
                  <span className="pill pill-danger">{c.action}</span>
                  <time>{fmtDateTimeFull(c.at)}</time>
                </header>
                <dl>
                  <div>
                    <dt>患者</dt>
                    <dd>
                      {c.patientName}({c.patientId})
                    </dd>
                  </div>
                  <div>
                    <dt>镜片编号</dt>
                    <dd>{c.lensIds.length ? c.lensIds.join("、") : "—"}</dd>
                  </div>
                  <div>
                    <dt>参数</dt>
                    <dd>{c.params}</dd>
                  </div>
                  <div>
                    <dt>命中的限制</dt>
                    <dd>
                      {c.rules.map((r) => (
                        <span key={r} className="rule-hit">
                          {r}
                        </span>
                      ))}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p>修订记录</p>
            <h2>台账操作留痕</h2>
          </div>
        </div>
        <div className="revision-list">
          {state.revisions.map((r) => (
            <div key={r.id} className="revision-item">
              <time>{fmtDateTimeFull(r.at)}</time>
              <span className="pill pill-info">{r.actor}</span>
              <strong>{r.action}</strong>
              <p>{r.detail}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;
