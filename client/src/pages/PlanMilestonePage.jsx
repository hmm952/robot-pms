import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './plan-gantt.css';
import api from '../api/client.js';
import { loadFrappeGantt } from '../lib/loadFrappeGantt.js';
import { useProject } from '../context/ProjectContext.jsx';

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** @param {Date} d */
function toYMD(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** @param {string} iso */
function addDaysIso(iso, days) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toYMD(d);
}

function filterTasksByMilestone(tasks, milestoneId) {
  if (milestoneId == null) return tasks;
  const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const keep = new Set();
  for (const t of tasks) {
    if (t.milestone_id === milestoneId) {
      let cur = t;
      while (cur) {
        keep.add(cur.id);
        cur = cur.parent_id ? byId[cur.parent_id] : null;
      }
    }
  }
  return tasks.filter((t) => keep.has(t.id));
}

const PHASE_LABEL = { evt: 'EVT', dvt: 'DVT', pvt: 'PVT', mp: 'MP', custom: '自定义' };

function TreeRows({ nodes, depth, selectedId, onSelect, overdueSet }) {
  return (
    <>
      {nodes.map((n) => (
        <div key={n.id}>
          <button
            type="button"
            onClick={() => onSelect(n.id)}
            className={[
              'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm',
              selectedId === n.id ? 'bg-brand-50 text-brand-900' : 'hover:bg-slate-100',
              overdueSet.has(n.id) ? 'border-l-4 border-red-500 pl-1' : '',
            ].join(' ')}
            style={{ paddingLeft: 8 + depth * 14 }}
          >
            <span className="truncate font-medium text-slate-800">{n.title}</span>
            {n.computed_progress != null && (
              <span className="ml-auto flex-shrink-0 text-xs text-slate-500">{n.computed_progress}%</span>
            )}
          </button>
          {n.children?.length ? (
            <TreeRows
              nodes={n.children}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              overdueSet={overdueSet}
            />
          ) : null}
        </div>
      ))}
    </>
  );
}

function buildTree(tasks) {
  const map = Object.fromEntries(
    tasks.map((t) => [t.id, { ...t, children: [] }]),
  );
  const roots = [];
  for (const t of tasks) {
    const node = map[t.id];
    if (t.parent_id && map[t.parent_id]) {
      map[t.parent_id].children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortCh = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id;
  const walk = (n) => {
    n.children.sort(sortCh);
    n.children.forEach(walk);
  };
  roots.sort(sortCh);
  roots.forEach(walk);
  return roots;
}

export default function PlanMilestonePage() {
  const { projectId, currentProject } = useProject();
  const [milestones, setMilestones] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedMilestoneId, setSelectedMilestoneId] = useState(null);
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [msg, setMsg] = useState('');
  const [links, setLinks] = useState([]);
  const ganttHostRef = useRef(null);
  const ganttInstRef = useRef(null);

  const loadAll = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setMsg('');
    try {
      const [ms, ts, us] = await Promise.all([
        api.get('/api/milestones', { params: { projectId } }),
        api.get('/api/tasks', { params: { projectId, plan: '1' } }),
        api.get('/api/users/for-assignment'),
      ]);
      setMilestones(ms.data);
      setTasks(ts.data);
      setUsers(us.data);
    } catch (e) {
      setMsg(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const filteredTasks = useMemo(
    () => filterTasksByMilestone(tasks, selectedMilestoneId),
    [tasks, selectedMilestoneId],
  );

  const tree = useMemo(() => buildTree(filteredTasks), [filteredTasks]);

  const overdueSet = useMemo(() => {
    const s = new Set();
    for (const t of tasks) {
      if (t.is_overdue) s.add(t.id);
    }
    return s;
  }, [tasks]);

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) || null,
    [tasks, selectedTaskId],
  );

  useEffect(() => {
    if (!selectedTaskId) {
      setLinks([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/api/task-links', { params: { taskId: selectedTaskId } });
        if (!cancelled) setLinks(data);
      } catch {
        if (!cancelled) setLinks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedTaskId]);

  const buildGanttPayload = useCallback(() => {
    const today = toYMD(new Date());
    const rows = [];
    for (const t of filteredTasks) {
      let start = t.display_start || t.start_date || today;
      let end = t.display_end || t.end_date || t.due_date || addDaysIso(start, 7);
      if (end < start) end = addDaysIso(start, 1);
      rows.push({
        id: `WBS-${t.id}`,
        name: `${t.is_overdue ? '⚠ ' : ''}${t.title}`,
        start,
        end,
        progress: Math.min(100, Math.max(0, Number(t.computed_progress) || 0)),
        custom_class: t.is_overdue ? 'gantt-overdue' : '',
      });
    }
    for (const m of milestones) {
      if (!m.target_date) continue;
      if (selectedMilestoneId != null && m.id !== selectedMilestoneId) continue;
      const s = m.target_date;
      const e = addDaysIso(s, 1);
      rows.push({
        id: `MS-${m.id}`,
        name: `◆ ${m.name}`,
        start: s,
        end: e,
        progress: m.status === 'achieved' ? 100 : 0,
        custom_class: 'gantt-milestone',
      });
    }
    return rows;
  }, [filteredTasks, milestones, selectedMilestoneId]);

  useEffect(() => {
    const el = ganttHostRef.current;
    if (!el) return undefined;
    let cancelled = false;
    el.innerHTML = '';
    ganttInstRef.current = null;
    const data = buildGanttPayload();
    if (data.length === 0) return undefined;

    (async () => {
      try {
        const Gantt = await loadFrappeGantt();
        if (cancelled || !ganttHostRef.current) return;
        const host = ganttHostRef.current;
        host.innerHTML = '';
        const g = new Gantt(host, data, {
          view_mode: 'Week',
          date_format: 'YYYY-MM-DD',
          language: 'en',
          on_date_change: async (task, start, end) => {
            const m = /^WBS-(\d+)$/.exec(String(task.id));
            if (!m) return;
            const id = Number(m[1]);
            const s = start instanceof Date ? toYMD(start) : String(start).slice(0, 10);
            const e = end instanceof Date ? toYMD(end) : String(end).slice(0, 10);
            try {
              await api.put(`/api/tasks/${id}`, { start_date: s, end_date: e, due_date: e });
              await loadAll();
            } catch (err) {
              setMsg(err.message || '保存失败');
            }
          },
          on_progress_change: async (task, progress) => {
            const m = /^WBS-(\d+)$/.exec(String(task.id));
            if (!m) return;
            const id = Number(m[1]);
            try {
              await api.put(`/api/tasks/${id}`, { progress });
              await loadAll();
            } catch (err) {
              setMsg(err.message || '保存失败');
            }
          },
        });
        ganttInstRef.current = g;
      } catch (e) {
        if (!cancelled) setMsg(e.message || '甘特图加载失败');
      }
    })();

    return () => {
      cancelled = true;
      el.innerHTML = '';
      ganttInstRef.current = null;
    };
  }, [buildGanttPayload, loadAll]);

  async function applyHardwareTemplate() {
    if (!projectId) return;
    setMsg('');
    try {
      await api.post('/api/milestones/apply-hardware-template', { project_id: projectId });
      await loadAll();
    } catch (e) {
      setMsg(e.message || '应用模板失败');
    }
  }

  async function saveTaskEdit(payload) {
    if (!selectedTask) return;
    setMsg('');
    try {
      await api.put(`/api/tasks/${selectedTask.id}`, payload);
      await loadAll();
    } catch (e) {
      setMsg(e.message || '保存失败');
    }
  }

  async function addChildTask() {
    if (!projectId) return;
    const parentId = selectedTaskId || null;
    const title = window.prompt('子任务名称', '新子任务');
    if (!title) return;
    setMsg('');
    try {
      await api.post('/api/tasks', {
        project_id: projectId,
        title,
        parent_id: parentId,
        milestone_id: selectedMilestoneId || null,
        status: 'todo',
        priority: 'medium',
      });
      await loadAll();
    } catch (e) {
      setMsg(e.message || '新建失败');
    }
  }

  async function addRootTask() {
    if (!projectId) return;
    const title = window.prompt('根任务名称', '新建 WBS 根任务');
    if (!title) return;
    setMsg('');
    try {
      await api.post('/api/tasks', {
        project_id: projectId,
        title,
        parent_id: null,
        milestone_id: selectedMilestoneId || null,
        status: 'todo',
        priority: 'medium',
      });
      await loadAll();
    } catch (e) {
      setMsg(e.message || '新建失败');
    }
  }

  async function deleteSelectedTask() {
    if (!selectedTask) return;
    if (!window.confirm(`删除任务「${selectedTask.title}」及其所有子任务？`)) return;
    setMsg('');
    try {
      await api.delete(`/api/tasks/${selectedTask.id}`);
      setSelectedTaskId(null);
      await loadAll();
    } catch (e) {
      setMsg(e.message || '删除失败');
    }
  }

  async function addExternalLink() {
    if (!selectedTask) return;
    const type = window.prompt('关联类型: meeting / review / email / other', 'meeting');
    if (!type) return;
    const refTitle = window.prompt('标题或说明（预留与后续模块对接）', '');
    setMsg('');
    try {
      await api.post('/api/task-links', {
        task_id: selectedTask.id,
        link_type: type,
        ref_title: refTitle || null,
        ref_id: null,
      });
      const { data } = await api.get('/api/task-links', { params: { taskId: selectedTask.id } });
      setLinks(data);
    } catch (e) {
      setMsg(e.message || '添加关联失败');
    }
  }

  if (!projectId) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        请先在顶部选择项目。
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-3">
      <div>
        <h1 className="font-display text-2xl font-semibold text-slate-900">计划与里程碑</h1>
        <p className="mt-1 text-sm text-slate-600">
          {currentProject?.name} — WBS 分解、硬件阶段里程碑与甘特图（拖拽条调整时间，进度条拖拽可更新完成度）
        </p>
      </div>

      {/* 里程碑切换栏 */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <span className="text-xs font-semibold uppercase text-slate-500">里程碑</span>
        <button
          type="button"
          onClick={() => setSelectedMilestoneId(null)}
          className={[
            'rounded-full px-3 py-1 text-xs font-semibold',
            selectedMilestoneId == null ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
          ].join(' ')}
        >
          全部阶段
        </button>
        {milestones.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setSelectedMilestoneId(m.id === selectedMilestoneId ? null : m.id)}
            className={[
              'rounded-full px-3 py-1 text-xs font-semibold',
              selectedMilestoneId === m.id
                ? 'bg-brand-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
            ].join(' ')}
          >
            {PHASE_LABEL[m.phase_template] || 'M'} · {m.name}
          </button>
        ))}
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            onClick={applyHardwareTemplate}
            className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800 hover:bg-brand-100"
          >
            应用 EVT/DVT/PVT/MP 模板
          </button>
          <button
            type="button"
            onClick={loadAll}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            刷新数据
          </button>
        </div>
      </div>

      {msg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{msg}</div>
      )}

      <details className="rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-sm">
        <summary className="cursor-pointer select-none font-semibold text-slate-800">
          里程碑维护：目标日期与状态（同步到数据库，甘特图紫色条为阶段节点）
        </summary>
        <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
          {milestones.length === 0 ? (
            <p className="text-slate-500">暂无里程碑，可先点击「应用 EVT/DVT/PVT/MP 模板」。</p>
          ) : (
            milestones.map((m) => (
              <div
                key={m.id}
                className="flex flex-wrap items-center gap-2 border-b border-slate-50 py-2 last:border-0"
              >
                <span className="min-w-[10rem] truncate text-xs font-medium text-slate-800">{m.name}</span>
                <input
                  type="date"
                  className="rounded border border-slate-200 px-1 py-0.5 text-xs"
                  defaultValue={m.target_date || ''}
                  id={`ms-date-${m.id}`}
                />
                <select
                  className="rounded border border-slate-200 px-1 py-0.5 text-xs"
                  defaultValue={m.status}
                  id={`ms-st-${m.id}`}
                >
                  <option value="planned">计划中</option>
                  <option value="active">进行中</option>
                  <option value="achieved">已达成</option>
                  <option value="delayed">已延误</option>
                  <option value="cancelled">取消</option>
                </select>
                <button
                  type="button"
                  onClick={async () => {
                    setMsg('');
                    try {
                      const target_date = document.getElementById(`ms-date-${m.id}`)?.value || null;
                      const status = document.getElementById(`ms-st-${m.id}`)?.value;
                      await api.put(`/api/milestones/${m.id}`, { target_date, status });
                      await loadAll();
                    } catch (e) {
                      setMsg(e.message || '保存里程碑失败');
                    }
                  }}
                  className="rounded bg-slate-800 px-2 py-0.5 text-xs font-semibold text-white hover:bg-slate-900"
                >
                  保存
                </button>
              </div>
            ))
          )}
        </div>
      </details>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[320px_1fr]">
        {/* 左侧任务树 + 操作 */}
        <div className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="text-sm font-semibold text-slate-800">任务树（WBS）</span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={addRootTask}
                className="rounded-md bg-slate-900 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-800"
              >
                + 根任务
              </button>
              <button
                type="button"
                onClick={addChildTask}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                + 子任务
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {loading ? (
              <div className="p-4 text-sm text-slate-500">加载中…</div>
            ) : tree.length === 0 ? (
              <div className="p-4 text-sm text-slate-500">暂无任务，点击「+ 根任务」开始。</div>
            ) : (
              <TreeRows nodes={tree} depth={0} selectedId={selectedTaskId} onSelect={setSelectedTaskId} overdueSet={overdueSet} />
            )}
          </div>
          <div className="border-t border-slate-100 p-3 text-xs text-slate-500">
            <span className="font-semibold text-red-600">红左边框</span> 表示已逾期（未完成且已过截止日期）。
          </div>
        </div>

        {/* 右侧：甘特 + 选中任务编辑 */}
        <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
          <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
            <div className="text-xs font-semibold text-slate-500">甘特图（拖拽条形调整起止时间）</div>
            <div ref={ganttHostRef} className="gantt-container mt-2 min-h-[280px]" />
          </div>

          <div className="max-h-64 shrink-0 overflow-auto rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold text-slate-900">选中任务</div>
            {!selectedTask ? (
              <p className="mt-2 text-sm text-slate-500">在左侧点击一条任务以编辑。</p>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="block text-xs text-slate-500">
                    标题
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                      defaultValue={selectedTask.title}
                      key={selectedTask.id}
                      id={`t-title-${selectedTask.id}`}
                    />
                  </label>
                  <label className="block text-xs text-slate-500">
                    责任人
                    <select
                      className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                      defaultValue={selectedTask.assignee_id || ''}
                      key={`asg-${selectedTask.id}`}
                      id={`t-asg-${selectedTask.id}`}
                    >
                      <option value="">未指定</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.full_name || u.username}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs text-slate-500">
                    开始日
                    <input
                      type="date"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                      defaultValue={selectedTask.start_date || ''}
                      id={`t-s-${selectedTask.id}`}
                    />
                  </label>
                  <label className="block text-xs text-slate-500">
                    结束日
                    <input
                      type="date"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                      defaultValue={selectedTask.end_date || selectedTask.due_date || ''}
                      id={`t-e-${selectedTask.id}`}
                    />
                  </label>
                  <label className="block text-xs text-slate-500">
                    优先级
                    <select
                      className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                      defaultValue={selectedTask.priority}
                      id={`t-p-${selectedTask.id}`}
                    >
                      <option value="low">低</option>
                      <option value="medium">中</option>
                      <option value="high">高</option>
                      <option value="critical">紧急</option>
                    </select>
                  </label>
                  <label className="block text-xs text-slate-500">
                    状态
                    <select
                      className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                      defaultValue={selectedTask.status}
                      id={`t-st-${selectedTask.id}`}
                    >
                      <option value="todo">待办</option>
                      <option value="in_progress">进行中</option>
                      <option value="blocked">阻塞</option>
                      <option value="done">完成</option>
                    </select>
                  </label>
                  <label className="block text-xs text-slate-500 sm:col-span-2">
                    关联里程碑
                    <select
                      className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                      defaultValue={selectedTask.milestone_id || ''}
                      id={`t-m-${selectedTask.id}`}
                    >
                      <option value="">无</option>
                      {milestones.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs text-slate-500 sm:col-span-2">
                    父任务（留空为根）
                    <select
                      className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                      defaultValue={selectedTask.parent_id || ''}
                      id={`t-par-${selectedTask.id}`}
                    >
                      <option value="">（根节点）</option>
                      {tasks
                        .filter((t) => t.id !== selectedTask.id)
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.title}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const title = document.getElementById(`t-title-${selectedTask.id}`)?.value;
                      const assignee_id = document.getElementById(`t-asg-${selectedTask.id}`)?.value;
                      const start_date = document.getElementById(`t-s-${selectedTask.id}`)?.value || null;
                      const end_date = document.getElementById(`t-e-${selectedTask.id}`)?.value || null;
                      const priority = document.getElementById(`t-p-${selectedTask.id}`)?.value;
                      const status = document.getElementById(`t-st-${selectedTask.id}`)?.value;
                      const milestone_id = document.getElementById(`t-m-${selectedTask.id}`)?.value;
                      const parentRaw = document.getElementById(`t-par-${selectedTask.id}`)?.value;
                      saveTaskEdit({
                        title,
                        assignee_id: assignee_id ? Number(assignee_id) : null,
                        start_date,
                        end_date,
                        due_date: end_date,
                        priority,
                        status,
                        milestone_id: milestone_id ? Number(milestone_id) : null,
                        parent_id: parentRaw ? Number(parentRaw) : null,
                      });
                    }}
                    className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                  >
                    保存到服务器
                  </button>
                  <button
                    type="button"
                    onClick={deleteSelectedTask}
                    className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100"
                  >
                    删除（含子任务）
                  </button>
                </div>
                <div className="border-t border-slate-100 pt-3">
                  <div className="text-xs font-semibold text-slate-600">外部关联（会议纪要 / 评审 / 邮件预留）</div>
                  <ul className="mt-2 space-y-1 text-xs text-slate-600">
                    {links.length === 0 ? <li>暂无关联</li> : null}
                    {links.map((l) => (
                      <li key={l.id}>
                        <span className="font-medium text-slate-800">{l.link_type}</span>
                        {l.ref_title ? ` — ${l.ref_title}` : ''}
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={addExternalLink}
                    className="mt-2 rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    + 添加关联占位
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
