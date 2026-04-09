import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client.js';
import { useProject } from '../context/ProjectContext.jsx';

const statusLabel = {
  todo: '待办',
  in_progress: '进行中',
  blocked: '阻塞',
  done: '完成',
};

const statusBadge = {
  todo: 'bg-slate-100 text-slate-700',
  in_progress: 'bg-blue-50 text-blue-700',
  blocked: 'bg-amber-50 text-amber-800',
  done: 'bg-emerald-50 text-emerald-700',
};

const warnBadge = {
  due_soon: 'bg-amber-50 text-amber-800',
  overdue: 'bg-red-50 text-red-700',
  escalated: 'bg-red-100 text-red-800',
};

function KanbanColumn({ title, items, onQuickDone }) {
  return (
    <div className="min-w-[260px] flex-1 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        <div className="text-xs text-slate-500">{items.length}</div>
      </div>
      <div className="mt-3 space-y-2">
        {items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
            暂无
          </div>
        ) : (
          items.map((t) => (
            <div key={t.id} className="rounded-xl border border-slate-200 bg-white p-3 hover:bg-slate-50">
              <div className="flex items-start justify-between gap-2">
                <Link to={`/tasks/${t.id}`} className="min-w-0 flex-1 font-semibold text-slate-900 hover:underline">
                  {t.title}
                </Link>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadge[t.status] || statusBadge.todo}`}>
                  {statusLabel[t.status] || t.status}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <span className="rounded bg-slate-100 px-2 py-0.5">优先级 {t.priority}</span>
                <span className="rounded bg-slate-100 px-2 py-0.5">责任人 {t.assignee_name || '—'}</span>
                <span className="rounded bg-slate-100 px-2 py-0.5">截止 {t.end_date || t.due_date || '—'}</span>
                {t.warning_level !== 'none' ? (
                  <span className={`rounded px-2 py-0.5 font-semibold ${warnBadge[t.warning_level] || warnBadge.overdue}`}>
                    {t.warning_level === 'due_soon' ? '即将到期' : t.warning_level === 'escalated' ? '已升级预警' : '已逾期'}
                  </span>
                ) : null}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded bg-slate-100">
                  <div className="h-2 bg-brand-600" style={{ width: `${Math.min(100, Math.max(0, Number(t.progress ?? 0)))}%` }} />
                </div>
                <div className="text-xs font-semibold text-slate-700">{Number(t.progress ?? 0)}%</div>
              </div>
              <div className="mt-3 flex justify-end">
                {t.status !== 'done' ? (
                  <button
                    type="button"
                    onClick={() => onQuickDone(t)}
                    className="text-xs font-semibold text-brand-700 hover:underline"
                  >
                    快速完成
                  </button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function TasksPage() {
  const { projectId } = useProject();
  const [items, setItems] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [view, setView] = useState('list'); // list | kanban
  const [filters, setFilters] = useState({
    status: '',
    assigneeId: '',
    priority: '',
    q: '',
  });
  const [newTitle, setNewTitle] = useState('');

  async function load() {
    if (!projectId) return;
    setLoading(true);
    setMsg('');
    try {
      const [ts, us] = await Promise.all([
        api.get('/api/tasks', {
          params: {
            projectId,
            plan: '0',
            status: filters.status || undefined,
            assigneeId: filters.assigneeId || undefined,
            priority: filters.priority || undefined,
            q: filters.q || undefined,
          },
        }),
        api.get('/api/users/for-assignment'),
      ]);
      setItems(ts.data);
      setUsers(us.data);
    } catch (e) {
      setMsg(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.status, filters.assigneeId, filters.priority, filters.q]);

  const byStatus = useMemo(() => {
    const map = { todo: [], in_progress: [], blocked: [], done: [] };
    for (const t of items) {
      (map[t.status] || map.todo).push(t);
    }
    return map;
  }, [items]);

  async function addTask() {
    if (!projectId) return;
    if (!newTitle.trim()) return;
    setMsg('');
    try {
      await api.post('/api/tasks', { project_id: projectId, title: newTitle.trim(), status: 'todo', priority: 'medium' });
      setNewTitle('');
      await load();
    } catch (e) {
      setMsg(e.message || '新建失败');
    }
  }

  async function quickDone(t) {
    setMsg('');
    try {
      await api.put(`/api/tasks/${t.id}`, { status: 'done', progress: 100 });
      await load();
    } catch (e) {
      setMsg(e.message || '更新失败');
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-slate-900">任务与待办</h1>
          <p className="mt-1 text-sm text-slate-600">列表 + 看板双模式；支持筛选、到期提醒与逾期升级预警；点击进入任务详情。</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setView('list')}
            className={['rounded-lg px-3 py-2 text-xs font-semibold', view === 'list' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'].join(' ')}
          >
            列表视图
          </button>
          <button
            type="button"
            onClick={() => setView('kanban')}
            className={['rounded-lg px-3 py-2 text-xs font-semibold', view === 'kanban' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'].join(' ')}
          >
            看板视图
          </button>
        </div>
      </div>

      {!projectId ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">请先选择项目。</div>
      ) : (
        <>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[220px] flex-1">
                <label className="text-xs text-slate-500">搜索标题</label>
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={filters.q}
                  onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
                  placeholder="例如：BOM / 试产 / 认证…"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">状态</label>
                <select className="mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
                  <option value="">全部</option>
                  <option value="todo">待办</option>
                  <option value="in_progress">进行中</option>
                  <option value="blocked">阻塞</option>
                  <option value="done">完成</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500">责任人</label>
                <select className="mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" value={filters.assigneeId} onChange={(e) => setFilters((f) => ({ ...f, assigneeId: e.target.value }))}>
                  <option value="">全部</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name || u.username}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500">优先级</label>
                <select className="mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" value={filters.priority} onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))}>
                  <option value="">全部</option>
                  <option value="low">低</option>
                  <option value="medium">中</option>
                  <option value="high">高</option>
                  <option value="critical">紧急</option>
                </select>
              </div>
              <button type="button" onClick={load} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                刷新
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-[260px] flex-1">
                <label className="text-xs text-slate-500">快速新建待办</label>
                <input className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="输入任务标题后回车或点添加" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTask(); } }} />
              </div>
              <button type="button" onClick={addTask} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
                添加
              </button>
            </div>
            <div className="mt-3 text-xs text-slate-500">
              提醒规则：距离截止 ≤ reminder_days_before 视为“即将到期”；已逾期自动预警；若 `escalation_level ≥ 1` 视为“已升级预警”（预留后续邮件/会议纪要联动）。
            </div>
          </div>

          {msg && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{msg}</div>}

          {view === 'kanban' ? (
            <div className="flex gap-3 overflow-x-auto pb-2">
              <KanbanColumn title="待办" items={byStatus.todo} onQuickDone={quickDone} />
              <KanbanColumn title="进行中" items={byStatus.in_progress} onQuickDone={quickDone} />
              <KanbanColumn title="阻塞" items={byStatus.blocked} onQuickDone={quickDone} />
              <KanbanColumn title="完成" items={byStatus.done} onQuickDone={quickDone} />
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">任务</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">状态</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">责任人</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">优先级</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">截止</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">提醒</th>
                    <th className="px-4 py-3 text-right font-semibold text-slate-700">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500">加载中…</td>
                    </tr>
                  ) : items.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500">暂无任务</td>
                    </tr>
                  ) : (
                    items.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-50/80">
                        <td className="px-4 py-3">
                          <Link to={`/tasks/${t.id}`} className="font-semibold text-slate-900 hover:underline">{t.title}</Link>
                          {t.milestone_name ? <div className="mt-1 text-xs text-slate-500">里程碑：{t.milestone_name}</div> : null}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusBadge[t.status] || statusBadge.todo}`}>{statusLabel[t.status] || t.status}</span>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{t.assignee_name || '—'}</td>
                        <td className="px-4 py-3 text-slate-700">{t.priority}</td>
                        <td className="px-4 py-3 text-slate-700">{t.end_date || t.due_date || '—'}</td>
                        <td className="px-4 py-3">
                          {t.warning_level && t.warning_level !== 'none' ? (
                            <span className={`rounded px-2 py-0.5 text-xs font-semibold ${warnBadge[t.warning_level] || warnBadge.overdue}`}>
                              {t.warning_level === 'due_soon' ? `即将到期（${t.due_in_days}天）` : t.warning_level === 'escalated' ? '已升级预警' : '已逾期'}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-500">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {t.status !== 'done' ? (
                            <button type="button" onClick={() => quickDone(t)} className="text-xs font-semibold text-brand-700 hover:underline">
                              快速完成
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
