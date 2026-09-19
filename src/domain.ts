// 角膜塑形镜(OK镜)试戴与复查准入台账 —— 领域模型与准入规则

export type EyeSide = "OD" | "OS";

export const EYE_LABEL: Record<EyeSide, string> = { OD: "右眼", OS: "左眼" };

export interface EyeParams {
  baseCurve: number; // 基弧 mm
  flatK: number; // 角膜曲率(平K) D
  astigmatism: number; // 散光 D(绝对量)
}

export interface Patient {
  id: string;
  name: string;
  age: number;
  eyes: Record<EyeSide, EyeParams>;
  currentBatch: string | null; // 当前镜片批次(首次确认试戴时生成)
  createdAt: string;
}

export interface TrialLens {
  id: string; // 镜片编号
  eye: EyeSide; // 左右眼型号
  model: string;
  baseCurve: number;
  power: number;
}

export type SessionStatus = "scheduled" | "confirmed" | "returned" | "cancelled";

export interface TrialSession {
  id: string;
  patientId: string;
  lensIds: string[];
  start: string; // 本地时间 YYYY-MM-DDTHH:mm
  end: string;
  status: SessionStatus;
  createdAt: string;
}

export interface FollowUp {
  id: string;
  patientId: string;
  date: string; // YYYY-MM-DD
  batch: string; // 承接的镜片批次
  lensAbnormal: boolean; // 镜片异常
  corneaAbnormal: boolean; // 角膜异常
  reason: string; // 异常原因(异常时必填)
  keptBatch: boolean; // 异常时保留原批次
  createdAt: string;
}

export interface ConflictEntry {
  id: string;
  at: string;
  action: string; // 触发动作
  patientId: string;
  patientName: string;
  lensIds: string[]; // 涉及镜片编号
  params: string; // 命中时的参数
  rules: string[]; // 命中的限制
}

export interface Revision {
  id: string;
  at: string;
  actor: string;
  action: string;
  detail: string;
}

export interface LedgerState {
  patients: Patient[];
  sessions: TrialSession[];
  followUps: FollowUp[];
  conflicts: ConflictEntry[];
  revisions: Revision[];
}

/** 准入限制(适配范围 + 台账规则) */
export const RULES = {
  R1: "R1 基弧须在 7.40–8.60mm",
  R2: "R2 角膜曲率(平K)须在 40.00–46.00D",
  R3: "R3 散光须 ≤1.50D",
  R4: "R4 同一试戴片重叠时段不得重复分配",
  R5: "R5 试戴片未归还不得确认新的试戴",
  R6: "R6 复查须承接上次镜片批次",
  R7: "R7 镜片/角膜异常须写明原因并保留原批次",
} as const;

/** 试戴片库存:按左右眼型号管理 */
export const TRIAL_LENSES: TrialLens[] = [
  { id: "OK-OD-01", eye: "OD", model: "VST-10.6", baseCurve: 7.8, power: -2.0 },
  { id: "OK-OD-02", eye: "OD", model: "VST-10.6", baseCurve: 7.95, power: -3.0 },
  { id: "OK-OD-03", eye: "OD", model: "VST-10.2", baseCurve: 8.1, power: -4.0 },
  { id: "OK-OD-04", eye: "OD", model: "VST-10.2", baseCurve: 8.25, power: -5.0 },
  { id: "OK-OS-01", eye: "OS", model: "VST-10.6", baseCurve: 7.8, power: -2.0 },
  { id: "OK-OS-02", eye: "OS", model: "VST-10.6", baseCurve: 7.95, power: -3.0 },
  { id: "OK-OS-03", eye: "OS", model: "VST-10.2", baseCurve: 8.1, power: -4.0 },
  { id: "OK-OS-04", eye: "OS", model: "VST-10.2", baseCurve: 8.25, power: -5.0 },
];

/** 适配范围检查:返回命中的限制与超范围参数 */
export function fittingCheck(p: Patient): { rules: string[]; params: string[] } {
  const rules = new Set<string>();
  const params: string[] = [];
  (Object.keys(EYE_LABEL) as EyeSide[]).forEach((eye) => {
    const e = p.eyes[eye];
    const label = EYE_LABEL[eye];
    if (e.baseCurve < 7.4 || e.baseCurve > 8.6) {
      rules.add(RULES.R1);
      params.push(`${label}基弧 ${e.baseCurve.toFixed(2)}mm`);
    }
    if (e.flatK < 40 || e.flatK > 46) {
      rules.add(RULES.R2);
      params.push(`${label}平K ${e.flatK.toFixed(2)}D`);
    }
    if (e.astigmatism > 1.5) {
      rules.add(RULES.R3);
      params.push(`${label}散光 ${e.astigmatism.toFixed(2)}D`);
    }
  });
  return { rules: [...rules], params };
}

export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return Date.parse(aStart) < Date.parse(bEnd) && Date.parse(bStart) < Date.parse(aEnd);
}

/** 试戴片时段冲突:同一镜片在重叠时段已被占用(预约中/试戴中) */
export function lensOverlapConflicts(
  state: LedgerState,
  lensIds: string[],
  start: string,
  end: string,
  excludeSessionId?: string
): { lensId: string; session: TrialSession }[] {
  const hits: { lensId: string; session: TrialSession }[] = [];
  for (const s of state.sessions) {
    if (s.id === excludeSessionId) continue;
    if (s.status !== "scheduled" && s.status !== "confirmed") continue;
    if (!overlaps(start, end, s.start, s.end)) continue;
    for (const lensId of lensIds) {
      if (s.lensIds.includes(lensId)) hits.push({ lensId, session: s });
    }
  }
  return hits;
}

/** 患者名下未归还(已确认但未归还)的试戴单 */
export function unreturnedSession(
  state: LedgerState,
  patientId: string,
  excludeSessionId?: string
): TrialSession | undefined {
  return state.sessions.find(
    (s) => s.patientId === patientId && s.id !== excludeSessionId && s.status === "confirmed"
  );
}

// ---------- 持久化 ----------

const STORAGE_KEY = "orthok-ledger-v1";

export function seedState(): LedgerState {
  const patients: Patient[] = [
    {
      id: "P-001",
      name: "王晓萌",
      age: 12,
      currentBatch: null,
      createdAt: "2026-09-10T09:00:00",
      eyes: {
        OD: { baseCurve: 7.85, flatK: 43.0, astigmatism: 0.75 },
        OS: { baseCurve: 7.9, flatK: 43.25, astigmatism: 1.0 },
      },
    },
    {
      id: "P-002",
      name: "李睿",
      age: 15,
      currentBatch: null,
      createdAt: "2026-09-11T10:00:00",
      eyes: {
        OD: { baseCurve: 7.75, flatK: 42.5, astigmatism: 2.25 },
        OS: { baseCurve: 7.8, flatK: 42.75, astigmatism: 1.75 },
      },
    },
    {
      id: "P-003",
      name: "陈可欣",
      age: 10,
      currentBatch: null,
      createdAt: "2026-09-11T11:00:00",
      eyes: {
        OD: { baseCurve: 7.6, flatK: 46.5, astigmatism: 0.5 },
        OS: { baseCurve: 7.7, flatK: 44.0, astigmatism: 0.75 },
      },
    },
    {
      id: "P-004",
      name: "赵一鸣",
      age: 13,
      currentBatch: "P-004-B01",
      createdAt: "2026-09-08T09:00:00",
      eyes: {
        OD: { baseCurve: 7.95, flatK: 43.5, astigmatism: 1.0 },
        OS: { baseCurve: 7.95, flatK: 43.5, astigmatism: 1.25 },
      },
    },
  ];
  const sessions: TrialSession[] = [
    {
      id: "S-001",
      patientId: "P-004",
      lensIds: ["OK-OD-02", "OK-OS-02"],
      start: "2026-09-12T09:00",
      end: "2026-09-12T10:30",
      status: "confirmed",
      createdAt: "2026-09-11T15:00:00",
    },
    {
      id: "S-002",
      patientId: "P-001",
      lensIds: ["OK-OD-01", "OK-OS-01"],
      start: "2026-09-20T09:00",
      end: "2026-09-20T10:00",
      status: "scheduled",
      createdAt: "2026-09-18T10:00:00",
    },
  ];
  const followUps: FollowUp[] = [
    {
      id: "F-001",
      patientId: "P-004",
      date: "2026-09-15",
      batch: "P-004-B01",
      lensAbnormal: false,
      corneaAbnormal: true,
      reason: "右眼角膜点染Ⅰ级,停戴3天并用药后复查染色",
      keptBatch: true,
      createdAt: "2026-09-15T14:00:00",
    },
  ];
  const revisions: Revision[] = [
    {
      id: "V-3",
      at: "2026-09-18T10:00:00",
      actor: "验光师",
      action: "预约试戴",
      detail: "王晓萌(P-001) 预约 OK-OD-01/OK-OS-01,09-20 09:00–10:00",
    },
    {
      id: "V-2",
      at: "2026-09-15T14:00:00",
      actor: "复查医生",
      action: "复查登记",
      detail: "赵一鸣(P-004) 角膜异常:右眼角膜点染Ⅰ级,保留原批次 P-004-B01",
    },
    {
      id: "V-1",
      at: "2026-09-11T15:00:00",
      actor: "验光师",
      action: "确认试戴",
      detail: "赵一鸣(P-004) 确认试戴 OK-OD-02/OK-OS-02,生成批次 P-004-B01",
    },
  ];
  return { patients, sessions, followUps, conflicts: [], revisions };
}

export function loadState(): LedgerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedState();
    const parsed = JSON.parse(raw) as Partial<LedgerState>;
    const seed = seedState();
    return {
      patients: parsed.patients ?? seed.patients,
      sessions: parsed.sessions ?? seed.sessions,
      followUps: parsed.followUps ?? seed.followUps,
      conflicts: parsed.conflicts ?? seed.conflicts,
      revisions: parsed.revisions ?? seed.revisions,
    };
  } catch {
    return seedState();
  }
}

export function saveState(state: LedgerState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 隐私模式等写入失败时忽略,不影响当次使用
  }
}

export function resetStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 同上
  }
}

/**
 * 对应校验:刷新后校验患者、试戴占用、复查与修订记录是否一一对应,
 * 发现孤儿记录或批次不承接时登记冲突(按签名去重,不重复累加)。
 */
export function reconcile(state: LedgerState): LedgerState {
  const sig = (c: { action: string; patientId: string; lensIds: string[]; rules: string[] }) =>
    `${c.action}|${c.patientId}|${[...c.lensIds].sort().join("+")}|${c.rules.join("+")}`;
  const existing = new Set(state.conflicts.map(sig));
  const additions: Omit<ConflictEntry, "id" | "at">[] = [];
  const push = (c: Omit<ConflictEntry, "id" | "at">) => {
    const s = sig(c);
    if (existing.has(s)) return;
    existing.add(s);
    additions.push(c);
  };

  const patientById = new Map(state.patients.map((p) => [p.id, p]));
  const knownLenses = new Set(TRIAL_LENSES.map((l) => l.id));

  for (const s of state.sessions) {
    const p = patientById.get(s.patientId);
    if (!p) {
      push({
        action: "对应校验",
        patientId: s.patientId,
        patientName: "未知患者",
        lensIds: s.lensIds,
        params: `试戴单 ${s.id} 找不到对应患者`,
        rules: ["台账对应:患者缺失"],
      });
      continue;
    }
    const unknown = s.lensIds.filter((id) => !knownLenses.has(id));
    if (unknown.length) {
      push({
        action: "对应校验",
        patientId: p.id,
        patientName: p.name,
        lensIds: unknown,
        params: `试戴单 ${s.id} 引用未知镜片`,
        rules: ["台账对应:镜片缺失"],
      });
    }
  }

  for (const f of state.followUps) {
    const p = patientById.get(f.patientId);
    if (!p) {
      push({
        action: "对应校验",
        patientId: f.patientId,
        patientName: "未知患者",
        lensIds: [],
        params: `复查单 ${f.id} 找不到对应患者`,
        rules: ["台账对应:患者缺失"],
      });
      continue;
    }
    if (p.currentBatch && f.batch !== p.currentBatch) {
      push({
        action: "对应校验",
        patientId: p.id,
        patientName: p.name,
        lensIds: [],
        params: `复查单 ${f.id} 批次 ${f.batch} ≠ 当前批次 ${p.currentBatch}`,
        rules: [RULES.R6],
      });
    }
  }

  if (!additions.length) return state;
  const stamped = additions.map((c, i) => ({
    ...c,
    id: `C-${state.conflicts.length + i + 1}`,
    at: new Date().toISOString(),
  }));
  return { ...state, conflicts: [...stamped, ...state.conflicts] };
}
