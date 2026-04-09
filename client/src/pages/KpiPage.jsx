import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useProject } from '../context/ProjectContext.jsx';

function downloadBlob(filename, blob) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function ymd(y, m, d) {
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

export default function KpiPage() {
  const { user } = useAuth();
  const { projectId } = useProject();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const [tab, setTab] = useState('workload'); // workload | worklog | kpi | manual
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  // 工时填报
  const [myWorklogs, setMyWorklogs] = useState([]);

  // 负载
  const [workload, setWorkload] = useState(null);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [selectedUserTasks, setSelectedUserTasks] = useState(null);
  const [users, setUsers] = useState([]);

  // KPI
  const [kpiDefs, setKpiDefs] = useState([]);
  const [kpiSummary, setKpiSummary] = useState(null);
  const [kpiRecords, setKpiRecords] = useState([]);

  // 手工 KPI
  const [manualItems, setManualItems] = useState([]);
  const [manualForm, setManualForm] = useState({
    metric_name: '',
    metric_unit: '',
    period_year: now.getFullYear(),
    period_month: now.getMonth() + 1,
    target_value: '',
    actual_value: '',
    score: '',
  });

  const monthDays = useMemo(() => daysInMonth(year, month), [year, month]);
  const from = useMemo(() => ymd(year, month, 1), [year, month]);
  const to = useMemo(() => ymd(year, month, monthDays), [year, month, monthDays]);
  const worklogMap = useMemo(() => {
    const map = new Map();
    for (const w of myWorklogs) {
      map.set(w.work_date, w);
    }
    return map;
  }, [myWorklogs]);

  async function loadBase() {
    if (!projectId) return;
    setLoading(true);
    setMsg('');
    try {
      const [us, defs] = await Promise.all([
        api.get('/api/users/for-assignment'),
        api.get('/api/kpi/metric-defs'),
      ]);
      setUsers(us.data || []);
      setKpiDefs(defs.data || []);
    } catch (e) {
      setMsg(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function loadWorkload() {
    if (!projectId) return;
    setMsg('');
    const { data } = await api.get('/api/workloads/summary', { params: { projectId, year, month } });
    setWorkload(data);
    if (!selectedUserId && data.people?.[0]?.user_id) setSelectedUserId(data.people[0].user_id);
  }

  async function loadMyWorklogs() {
    if (!projectId || !user?.id) return;
    setMsg('');
    const { data } = await api.get('/api/worklogs', { params: { projectId, userId: user.id, from, to } });
    setMyWorklogs(data || []);
  }

  async function loadSelectedUserTasks(uid) {
    if (!projectId || !uid) return;
    setMsg('');
    const { data } = await api.get('/api/workloads/tasks', { params: { projectId, userId: uid } });
    setSelectedUserTasks(data);
  }

  async function loadManualKpi() {
    if (!projectId) return;
    const { data } = await api.get('/api/kpi', { params: { projectId } });
    setManualItems(data);
  }

  async function loadKpiRecords() {
    if (!projectId) return;
    const { data } = await api.get('/api/kpi', { params: { projectId } });
    setKpiRecords(data);
  }

  useEffect(() => {
    loadBase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    loadWorkload();
    loadMyWorklogs();
    loadKpiRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, year, month]);

  useEffect(() => {
    if (selectedUserId) loadSelectedUserTasks(selectedUserId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUserId, projectId]);

  async function upsertWorklog(dateYmd, hours) {
    if (!projectId) return;
    setMsg('');
    try {
      await api.post('/api/worklogs/upsert', {
        project_id: projectId,
        work_date: dateYmd,
        hours: Number(hours),
      });
      await loadMyWorklogs();
      await loadWorkload();
    } catch (e) {
      setMsg(e.message || '保存工时失败');
    }
  }

  async function autoCalcKpi() {
    if (!projectId) return;
    setLoading(true);
    setMsg('');
    try {
      const { data } = await api.post('/api/kpi/auto-calc', {
        project_id: projectId,
        period_year: Number(year),
        period_month: Number(month),
      });
      setKpiSummary(data);
      await loadKpiRecords();
    } catch (e) {
      setMsg(e.message || '一键核算失败');
    } finally {
      setLoading(false);
    }
  }

  async function exportKpiPdf() {
    if (!projectId) return;
    setMsg('');
    try {
      const res = await api.get('/api/kpi/report/pdf', {
        params: { projectId, year, month },
        responseType: 'blob',
      });
      downloadBlob(`kpi_${projectId}_${year}-${String(month).padStart(2, '0')}.pdf`, res.data);
    } catch (e) {
      setMsg(e.message || '导出失败（请先一键核算生成报告）');
    }
  }

  async function reassignTask(taskId, assigneeId) {
    setMsg('');
    try {
      await api.post('/api/workloads/reassign', { task_id: taskId, assignee_id: assigneeId ? Number(assigneeId) : null });
      await loadSelectedUserTasks(selectedUserId);
    } catch (e) {
      setMsg(e.message || '调度失败');
    }
  }

  async function addManualKpi(e) {
    e.preventDefault();
    if (!projectId) return;
    setMsg('');
    try {
      await api.post('/api/kpi', {
        project_id: projectId,
        user_id: user?.id,
        metric_name: manualForm.metric_name,
        metric_unit: manualForm.metric_unit || null,
        period_year: Number(manualForm.period_year),
        period_month: Number(manualForm.period_month),
        target_value: manualForm.target_value === '' ? null : Number(manualForm.target_value),
        actual_value: manualForm.actual_value === '' ? null : Number(manualForm.actual_value),
        score: manualForm.score === '' ? null : Number(manualForm.score),
      });
      setManualForm((f) => ({ ...f, metric_name: '', metric_unit: '', target_value: '', actual_value: '', score: '' }));
      await loadManualKpi();
    } catch (e) {
      setMsg(e.message || '保存失败');
    }
  }

  useEffect(() => {
    if (projectId) loadManualKpi();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-slate-900">人力负载与 KPI 自动核算</h1>
          <p className="mt-1 text-sm text-slate-600">工时填报 → 负载预警（≥80% 标红）→ 一键核算 KPI → 报告导出（PDF）。</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <div className="text-xs text-slate-500">年</div>
            <input className="mt-1 w-24 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
          </div>
          <div>
            <div className="text-xs text-slate-500">月</div>
            <input className="mt-1 w-20 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" type="number" min={1} max={12} value={month} onChange={(e) => setMonth(Number(e.target.value))} />
          </div>
          <button type="button" onClick={() => { loadWorkload(); loadMyWorklogs(); loadKpiRecords(); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            刷新
          </button>
        </div>
      </div>

      {!projectId ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">请先选择项目。</div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {[
              { k: 'workload', t: '负载看板' },
              { k: 'worklog', t: '工时填报' },
              { k: 'kpi', t: 'KPI 一键核算' },
              { k: 'manual', t: '手工 KPI 记录' },
            ].map((x) => (
              <button
                key={x.k}
                type="button"
                onClick={() => setTab(x.k)}
                className={[
                  'rounded-lg px-3 py-2 text-xs font-semibold',
                  tab === x.k ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                ].join(' ')}
              >
                {x.t}
              </button>
            ))}
          </div>

          {msg && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{msg}</div>}

          {tab === 'workload' && (
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2 space-y-4">
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-slate-900">人员负载（{from} ~ {to}）</h2>
                    <div className="text-xs text-slate-500">阈值：≥80% 标红</div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {(workload?.people || []).length === 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
                        暂无项目成员或工时数据
                      </div>
                    ) : (
                      (workload.people || []).map((p) => {
                        const pct = Math.min(200, Math.max(0, Number(p.load_pct || 0)));
                        const barCls = p.warning ? 'bg-red-500' : 'bg-brand-600';
                        return (
                          <button
                            key={p.user_id}
                            type="button"
                            onClick={() => setSelectedUserId(p.user_id)}
                            className={[
                              'w-full rounded-lg border px-3 py-2 text-left',
                              selectedUserId === p.user_id ? 'border-brand-300 bg-brand-50' : 'border-slate-200 bg-white hover:bg-slate-50',
                            ].join(' ')}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="font-semibold text-slate-900">
                                  {p.full_name || p.username}
                                  <span className="ml-2 text-xs font-normal text-slate-500">{p.department_name}</span>
                                </div>
                                <div className="mt-1 text-xs text-slate-500">
                                  工时 {p.total_hours}/{p.capacity_hours}h · 产能 {p.capacity_hours_per_day}h/日 · 工作日 {p.workdays}
                                </div>
                              </div>
                              <div className={p.warning ? 'text-sm font-bold text-red-700' : 'text-sm font-bold text-slate-700'}>
                                {p.load_pct}%
                              </div>
                            </div>
                            <div className="mt-2 h-2 overflow-hidden rounded bg-slate-100">
                              <div className={`h-2 ${barCls}`} style={{ width: `${Math.min(100, pct)}%` }} />
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h2 className="text-sm font-semibold text-slate-900">部门汇总</h2>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {(workload?.departments || []).map((d) => (
                      <div key={d.department_name} className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="flex items-center justify-between">
                          <div className="font-semibold text-slate-900">{d.department_name}</div>
                          <div className={d.warning ? 'text-sm font-bold text-red-700' : 'text-sm font-bold text-slate-700'}>{d.load_pct}%</div>
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          工时 {d.total_hours}/{d.capacity_hours}h
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded bg-slate-100">
                          <div className={`h-2 ${d.warning ? 'bg-red-500' : 'bg-brand-600'}`} style={{ width: `${Math.min(100, Math.max(0, Number(d.load_pct || 0)))}%` }} />
                        </div>
                      </div>
                    ))}
                    {(workload?.departments || []).length === 0 ? (
                      <div className="text-sm text-slate-500">暂无数据</div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h2 className="text-sm font-semibold text-slate-900">成员任务分配（资源调度）</h2>
                  <div className="mt-2 text-xs text-slate-500">选择左侧成员后查看其任务；可将任务改派给其他成员。</div>
                  {!selectedUserId ? (
                    <div className="mt-3 text-sm text-slate-500">请先选择一个成员</div>
                  ) : (
                    <>
                      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                        任务统计：{selectedUserTasks?.summary ? `${selectedUserTasks.summary.todo} 待办 · ${selectedUserTasks.summary.in_progress} 进行中 · ${selectedUserTasks.summary.blocked} 阻塞 · ${selectedUserTasks.summary.done} 完成 · 共 ${selectedUserTasks.summary.total}` : '—'}
                      </div>
                      <div className="mt-3 max-h-[520px] space-y-2 overflow-auto">
                        {(selectedUserTasks?.tasks || []).length === 0 ? (
                          <div className="rounded-lg border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
                            暂无任务
                          </div>
                        ) : (
                          (selectedUserTasks.tasks || []).map((t) => (
                            <div key={t.id} className="rounded-lg border border-slate-200 bg-white p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="font-semibold text-slate-900">
                                    <Link to={`/tasks/${t.id}`} className="hover:underline">
                                      {t.title}
                                    </Link>
                                  </div>
                                  <div className="mt-1 text-xs text-slate-500">
                                    状态 {t.status} · 优先级 {t.priority} · 截止 {t.end_date || t.due_date || '—'}
                                  </div>
                                </div>
                                <div className="w-36">
                                  <select
                                    className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs"
                                    defaultValue={t.assignee_id || ''}
                                    onChange={(e) => reassignTask(t.id, e.target.value || null)}
                                  >
                                    <option value="">未指派</option>
                                    {users.map((u) => (
                                      <option key={u.id} value={u.id}>
                                        {u.full_name || u.username}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === 'worklog' && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-900">工时填报（按天）</h2>
                <div className="text-xs text-slate-500">保存后会自动影响负载看板</div>
              </div>
              <div className="mt-3 overflow-auto rounded-lg border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">日期</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">工时（0~24）</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {Array.from({ length: monthDays }).map((_, idx) => {
                      const day = idx + 1;
                      const date = ymd(year, month, day);
                      const existing = worklogMap.get(date);
                      const defaultHours = existing?.hours ?? '';
                      return (
                        <tr key={date} className="hover:bg-slate-50/80">
                          <td className="px-4 py-3 font-medium text-slate-900">{date}</td>
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              min={0}
                              max={24}
                              step={0.5}
                              defaultValue={defaultHours}
                              id={`h-${date}`}
                              className="w-28 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => {
                                const v = document.getElementById(`h-${date}`)?.value;
                                const num = v === '' ? 0 : Number(v);
                                upsertWorklog(date, num);
                              }}
                              className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                            >
                              保存
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'kpi' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">KPI 指标库（内置硬件 PM 核心指标）</h2>
                    <div className="mt-1 text-xs text-slate-500">数据来源：任务/评审/里程碑/评审问题（自动同步）</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={autoCalcKpi}
                      disabled={loading}
                      className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                    >
                      一键核算
                    </button>
                    <button
                      type="button"
                      onClick={exportKpiPdf}
                      className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      导出报告 PDF
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {kpiDefs.map((d) => (
                    <div key={d.metric_key} className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="font-semibold text-slate-900">{d.name}</div>
                      <div className="mt-1 text-xs text-slate-500">{d.description || '—'}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-sm font-semibold text-slate-900">核算结果（{year}-{String(month).padStart(2, '0')}）</h2>
                <div className="mt-2 text-sm text-slate-700">
                  总分：<span className="font-semibold">{kpiSummary?.total_score ?? '—'}</span>
                </div>
                <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold text-slate-700">指标</th>
                        <th className="px-4 py-3 text-left font-semibold text-slate-700">目标</th>
                        <th className="px-4 py-3 text-left font-semibold text-slate-700">实际</th>
                        <th className="px-4 py-3 text-left font-semibold text-slate-700">得分</th>
                        <th className="px-4 py-3 text-left font-semibold text-slate-700">说明</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(kpiSummary?.metrics || []).length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                            暂无核算结果，点击「一键核算」
                          </td>
                        </tr>
                      ) : (
                        (kpiSummary.metrics || []).map((m) => (
                          <tr key={m.metric_key} className="hover:bg-slate-50/80">
                            <td className="px-4 py-3 font-medium text-slate-900">{m.metric_name}</td>
                            <td className="px-4 py-3 text-slate-700">{m.target_value ?? '—'}{m.unit || ''}</td>
                            <td className="px-4 py-3 text-slate-700">{m.actual_value ?? '—'}{m.unit || ''}</td>
                            <td className="px-4 py-3 text-slate-700">{m.score ?? '—'}</td>
                            <td className="px-4 py-3 text-xs text-slate-500">{m.comment || '—'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {tab === 'manual' && (
            <div className="space-y-4">
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">指标</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">人员</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">周期</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">目标/实际</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-700">得分</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(manualItems || []).length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                          暂无 KPI 记录
                        </td>
                      </tr>
                    ) : (
                      (manualItems || []).map((k) => (
                        <tr key={k.id} className="hover:bg-slate-50/80">
                          <td className="px-4 py-3 font-medium text-slate-900">
                            {k.metric_name}
                            {k.metric_unit ? <span className="text-xs font-normal text-slate-500"> ({k.metric_unit})</span> : null}
                          </td>
                          <td className="px-4 py-3 text-slate-600">{k.full_name || k.username || '—'}</td>
                          <td className="px-4 py-3 text-slate-600">{k.period_year}-{String(k.period_month).padStart(2, '0')}</td>
                          <td className="px-4 py-3 text-slate-600">{k.target_value ?? '—'} / {k.actual_value ?? '—'}</td>
                          <td className="px-4 py-3 text-slate-600">{k.score ?? '—'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <form onSubmit={addManualKpi} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="text-sm font-semibold text-slate-900">添加手工 KPI 记录（关联当前登录用户）</h2>
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <div className="min-w-[180px] flex-1">
                    <label className="text-xs text-slate-500">指标名称</label>
                    <input required className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={manualForm.metric_name} onChange={(e) => setManualForm((f) => ({ ...f, metric_name: e.target.value }))} />
                  </div>
                  <div className="w-28">
                    <label className="text-xs text-slate-500">单位</label>
                    <input className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="%" value={manualForm.metric_unit} onChange={(e) => setManualForm((f) => ({ ...f, metric_unit: e.target.value }))} />
                  </div>
                  <div className="w-24">
                    <label className="text-xs text-slate-500">年</label>
                    <input type="number" required className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={manualForm.period_year} onChange={(e) => setManualForm((f) => ({ ...f, period_year: e.target.value }))} />
                  </div>
                  <div className="w-20">
                    <label className="text-xs text-slate-500">月</label>
                    <input type="number" min={1} max={12} required className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={manualForm.period_month} onChange={(e) => setManualForm((f) => ({ ...f, period_month: e.target.value }))} />
                  </div>
                  <div className="w-24">
                    <label className="text-xs text-slate-500">目标</label>
                    <input type="number" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={manualForm.target_value} onChange={(e) => setManualForm((f) => ({ ...f, target_value: e.target.value }))} />
                  </div>
                  <div className="w-24">
                    <label className="text-xs text-slate-500">实际</label>
                    <input type="number" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={manualForm.actual_value} onChange={(e) => setManualForm((f) => ({ ...f, actual_value: e.target.value }))} />
                  </div>
                  <div className="w-24">
                    <label className="text-xs text-slate-500">得分</label>
                    <input type="number" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={manualForm.score} onChange={(e) => setManualForm((f) => ({ ...f, score: e.target.value }))} />
                  </div>
                  <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">保存</button>
                </div>
              </form>
            </div>
          )}
        </>
      )}
    </div>
  );
}
