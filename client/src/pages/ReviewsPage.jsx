import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/client.js';
import { useProject } from '../context/ProjectContext.jsx';

const reviewTypes = [
  { value: 'design', label: '设计' },
  { value: 'process', label: '工艺' },
  { value: 'safety', label: '安全' },
  { value: 'quality', label: '质量' },
  { value: 'milestone', label: '里程碑' },
  { value: 'other', label: '其他' },
];

const verdictBadge = {
  scheduled: 'bg-slate-100 text-slate-700',
  in_progress: 'bg-blue-50 text-blue-700',
  passed: 'bg-emerald-50 text-emerald-700',
  conditional: 'bg-amber-50 text-amber-700',
  rejected: 'bg-red-50 text-red-700',
  cancelled: 'bg-slate-100 text-slate-600',
};

const verdictText = {
  scheduled: '已排期',
  in_progress: '评审中',
  passed: '通过',
  conditional: '有条件通过',
  rejected: '不通过',
  cancelled: '取消',
};

function stepTitleFromReview(r) {
  if (!r) return '—';
  if (r.status && r.status !== 'in_progress' && r.status !== 'scheduled') return '归档完成';
  if (r.workflow_state === 'experts_reviewing') return '专家打分中';
  if (r.workflow_state === 'issue_tracking') return '问题闭环中';
  if (r.workflow_state === 'report_ready') return '报告就绪';
  return '评审中';
}

export default function ReviewsPage() {
  const { projectId, currentProject } = useProject();
  const nav = useNavigate();

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const [templates, setTemplates] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [users, setUsers] = useState([]);
  const [items, setItems] = useState([]);

  const [form, setForm] = useState({
    title: '',
    review_type: 'design',
    template_phase: 'evt',
    target_milestone_id: '',
    review_date: '',
    experts: [],
    description: '',
  });

  async function loadAll() {
    if (!projectId) return;
    setLoading(true);
    setMsg('');
    try {
      const [ms, us, tpl, revs] = await Promise.all([
        api.get('/api/milestones', { params: { projectId } }),
        api.get('/api/users/for-assignment'),
        api.get('/api/reviews/templates'),
        api.get('/api/reviews', { params: { projectId } }),
      ]);
      setMilestones(ms.data || []);
      setUsers(us.data || []);
      setTemplates(tpl.data || []);
      setItems(revs.data || []);
    } catch (e) {
      setMsg(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const activeTemplateMilestones = useMemo(() => {
    if (!form.template_phase) return milestones;
    return milestones;
  }, [form.template_phase, milestones]);

  async function createReview(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    if (!projectId) return;
    if (form.experts.length === 0) {
      setMsg('请至少选择 1 位评审专家');
      return;
    }
    setMsg('');
    try {
      const selectedTemplate = templates.find((t) => t.phase_template === form.template_phase);
      const payload = {
        project_id: projectId,
        title: form.title.trim(),
        review_type: form.review_type,
        template_phase: form.template_phase,
        target_milestone_id: form.target_milestone_id ? Number(form.target_milestone_id) : null,
        review_date: form.review_date || null,
        description: form.description || null,
        experts: form.experts.map((x) => Number(x)),
        steps_json: selectedTemplate?.steps_json || undefined,
      };
      const { data } = await api.post('/api/reviews', payload);
      nav(`/reviews/${data.id}`, { replace: true });
    } catch (err) {
      setMsg(err.message || '创建评审失败');
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="font-display text-2xl font-semibold text-slate-900">硬件全阶段评审管理</h1>
        <p className="mt-1 text-sm text-slate-600">
          自定义评审流程模板（EVT/DVT/PVT/MP 内置）、专家在线打分、问题闭环转任务、自动生成评审报告与 PDF 导出。
        </p>
        {currentProject ? (
          <div className="mt-1 text-xs text-slate-500">当前项目：{currentProject.name}</div>
        ) : null}
      </div>

      {!projectId ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">请先选择项目。</div>
      ) : (
        <>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-900">新建评审申请</h2>
              <button type="button" onClick={loadAll} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                {loading ? '刷新中…' : '刷新数据'}
              </button>
            </div>

            <form onSubmit={createReview} className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="sm:col-span-2 block text-xs text-slate-500">
                评审标题
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  required
                  placeholder="例如：EVT 结构验证评审 — 关节模组"
                />
              </label>

              <label className="block text-xs text-slate-500">
                评审类型
                <select
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={form.review_type}
                  onChange={(e) => setForm((f) => ({ ...f, review_type: e.target.value }))}
                >
                  {reviewTypes.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs text-slate-500">
                阶段模板（EVT/DVT/PVT/MP）
                <select
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={form.template_phase}
                  onChange={(e) => setForm((f) => ({ ...f, template_phase: e.target.value, target_milestone_id: '' }))}
                >
                  {templates.map((t) => (
                    <option key={t.phase_template} value={t.phase_template}>
                      {t.phase_template} · {t.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs text-slate-500">
                目标里程碑（可选，用于同步进度）
                <select
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={form.target_milestone_id}
                  onChange={(e) => setForm((f) => ({ ...f, target_milestone_id: e.target.value }))}
                >
                  <option value="">不关联里程碑（不影响里程碑联动）</option>
                  {activeTemplateMilestones.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.phase_template} · {m.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs text-slate-500">
                评审时间
                <input
                  type="date"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={form.review_date}
                  onChange={(e) => setForm((f) => ({ ...f, review_date: e.target.value }))}
                />
              </label>

              <div className="sm:col-span-2">
                <div className="text-xs font-medium text-slate-600">评审专家（必填）</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {users.map((u) => (
                    <label key={u.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.experts.includes(String(u.id))}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setForm((f) => ({
                            ...f,
                            experts: checked
                              ? [...f.experts, String(u.id)]
                              : f.experts.filter((x) => x !== String(u.id)),
                          }));
                        }}
                      />
                      <span className="font-medium text-slate-800">{u.full_name || u.username}</span>
                    </label>
                  ))}
                </div>
              </div>

              <label className="sm:col-span-2 block text-xs text-slate-500">
                备注（可选）
                <textarea
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="例如：本次评审重点关注关键一致性与验证覆盖情况"
                />
              </label>

              <div className="sm:col-span-2 flex items-center justify-between gap-3">
                {msg ? <div className="text-sm text-red-600">{msg}</div> : <div className="text-xs text-slate-500">创建后进入详情页完成打分/问题闭环/报告。</div>}
                <button
                  type="submit"
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  创建评审
                </button>
              </div>
            </form>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">评审列表</h2>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                  暂无评审记录
                </div>
              ) : (
                items.map((r) => {
                  const progress = Number(r.progress_percent ?? 0);
                  return (
                    <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900">{r.title}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            阶段：{r.target_milestone_phase || r.template_phase || 'custom'} · {stepTitleFromReview(r)}
                          </div>
                        </div>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${verdictBadge[r.status] || 'bg-slate-100 text-slate-700'}`}>
                          {verdictText[r.status] || r.status}
                        </span>
                      </div>

                      <div className="mt-3">
                        <div className="flex items-center justify-between text-xs text-slate-600">
                          <span>流程进度</span>
                          <span className="font-semibold text-slate-800">{progress}%</span>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-2 bg-brand-600" style={{ width: `${progress}%` }} />
                        </div>
                        <div className="mt-2 text-xs text-slate-500">
                          专家：{r.required_experts_submitted ?? 0}/{r.required_experts_total ?? 0} · 待关闭问题：{r.issues_open_count ?? 0}
                        </div>
                      </div>

                      <div className="mt-4 flex justify-end">
                        <Link to={`/reviews/${r.id}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                          查看详情
                        </Link>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

