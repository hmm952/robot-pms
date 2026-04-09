import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useProject } from '../context/ProjectContext.jsx';

const statusLabel = {
  scheduled: '已排期',
  in_progress: '评审中',
  passed: '通过',
  conditional: '有条件通过',
  rejected: '不通过',
  cancelled: '取消',
};

const statusBadge = {
  scheduled: 'bg-slate-100 text-slate-700',
  in_progress: 'bg-blue-50 text-blue-700',
  passed: 'bg-emerald-50 text-emerald-700',
  conditional: 'bg-amber-50 text-amber-700',
  rejected: 'bg-red-50 text-red-700',
  cancelled: 'bg-slate-100 text-slate-600',
};

const workflowSteps = [
  { key: 'experts_reviewing', title: '专家打分' },
  { key: 'issue_tracking', title: '问题闭环' },
  { key: 'report_ready', title: '报告就绪' },
  { key: 'closed', title: '归档完成' },
];

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

export default function ReviewDetailPage() {
  const { user } = useAuth();
  const { projectId } = useProject();
  const { id } = useParams();
  const reviewId = Number(id);

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [review, setReview] = useState(null);
  const [experts, setExperts] = useState([]);
  const [issues, setIssues] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [report, setReport] = useState(null);

  const isLeadOrAdmin = useMemo(() => {
    if (!review) return false;
    if (user?.role === 'admin') return true;
    return user?.id === review.lead_reviewer_id;
  }, [review, user]);

  async function load() {
    if (!reviewId) return;
    setLoading(true);
    setMsg('');
    try {
      const { data } = await api.get(`/api/reviews/${reviewId}`);
      setReview(data.review);
      setExperts(data.experts || []);
      setIssues(data.issues || []);
      setAttachments(data.attachments || []);
      setReport(data.report || null);
    } catch (e) {
      setMsg(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewId]);

  async function submitExpert(e, expertUserId) {
    e.preventDefault();
    const score = Number(e.currentTarget.elements[`score-${expertUserId}`].value);
    const opinion = e.currentTarget.elements[`op-${expertUserId}`].value;
    try {
      setMsg('');
      await api.post(
        `/api/reviews/${reviewId}/experts/${expertUserId}/submit`,
        { score, opinion },
      );
      await load();
    } catch (err) {
      setMsg(err.message || '提交失败');
    }
  }

  const [issueForm, setIssueForm] = useState({ title: '', description: '', severity: 'medium' });

  async function addIssue(e) {
    e.preventDefault();
    if (!issueForm.title.trim()) return;
    try {
      setMsg('');
      await api.post(`/api/reviews/${reviewId}/issues`, {
        title: issueForm.title.trim(),
        description: issueForm.description || null,
        severity: issueForm.severity,
      });
      setIssueForm({ title: '', description: '', severity: 'medium' });
      await load();
    } catch (err) {
      setMsg(err.message || '新增问题失败');
    }
  }

  async function convertIssueToTask(issueId) {
    const due_date = window.prompt('请输入任务截止日期（YYYY-MM-DD，可留空）', '');
    const priority = window.prompt('请输入优先级 low/medium/high/critical（可留空）', 'high');
    const task_title = window.prompt('任务标题（可留空，默认使用问题标题）', '');
    try {
      setMsg('');
      await api.post(
        `/api/reviews/${reviewId}/issues/${issueId}/convert-to-task`,
        {
          due_date: due_date || null,
          priority: priority || null,
          task_title: task_title || null,
        },
      );
      await load();
    } catch (err) {
      setMsg(err.message || '转任务失败');
    }
  }

  async function uploadAttachment(file) {
    if (!file) return;
    try {
      setMsg('');
      const fd = new FormData();
      fd.append('file', file);
      await api.post(`/api/reviews/${reviewId}/attachments/upload`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await load();
    } catch (err) {
      setMsg(err.message || '上传失败');
    }
  }

  async function generateReport() {
    try {
      setMsg('');
      await api.post(`/api/reviews/${reviewId}/report/generate`);
      await load();
    } catch (err) {
      setMsg(err.message || '生成报告失败');
    }
  }

  async function exportPdf() {
    try {
      setMsg('');
      const res = await api.get(`/api/reviews/${reviewId}/report/pdf`, {
        responseType: 'blob',
      });
      downloadBlob(`review_${reviewId}_report.pdf`, res.data);
    } catch (err) {
      setMsg(err.message || '导出 PDF 失败');
    }
  }

  const [closeVerdict, setCloseVerdict] = useState('passed');
  const [closeConclusion, setCloseConclusion] = useState('');

  async function closeReview() {
    if (!closeVerdict) return;
    try {
      setMsg('');
      await api.put(`/api/reviews/${reviewId}/close`, {
        verdict: closeVerdict,
        conclusion: closeConclusion || null,
      });
      await load();
    } catch (err) {
      setMsg(err.message || '归档失败');
    }
  }

  const currentWorkflowKey = useMemo(() => {
    if (!review) return 'experts_reviewing';
    if (review.status && review.status !== 'in_progress' && review.status !== 'scheduled') return 'closed';
    return review.workflow_state || 'experts_reviewing';
  }, [review]);

  const currentStepIndex = useMemo(() => {
    const idx = workflowSteps.findIndex((s) => s.key === currentWorkflowKey);
    if (idx >= 0) return idx;
    return 0;
  }, [currentWorkflowKey]);

  if (!review) {
    return (
      <div className="mx-auto max-w-6xl space-y-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
          {loading ? '加载中…' : '未找到评审'}
        </div>
        {msg && <div className="text-sm text-red-600">{msg}</div>}
        <Link to="/reviews" className="text-sm font-semibold text-brand-700 hover:underline">
          ← 返回评审列表
        </Link>
      </div>
    );
  }

  const badgeCls = statusBadge[review.status] || 'bg-slate-100 text-slate-700';

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold text-slate-900">{review.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-700">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeCls}`}>
              {statusLabel[review.status] || review.status}
            </span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
              模板：{review.template_phase || 'custom'}
            </span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
              评审时间：{review.review_date || '—'}
            </span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
              评审类型：{review.review_type}
            </span>
          </div>
        </div>
        <Link
          to="/reviews"
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          ← 返回评审列表
        </Link>
      </div>

      {/* 流程进度条 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-slate-900">流程进度</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {workflowSteps.map((s, idx) => {
            const done = idx <= currentStepIndex;
            return (
              <div key={s.key} className="flex items-center gap-2">
                <div
                  className={[
                    'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold',
                    done ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500',
                  ].join(' ')}
                >
                  {idx + 1}
                </div>
                <div className={done ? 'text-sm font-semibold text-slate-800' : 'text-sm text-slate-500'}>
                  {s.title}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {msg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {msg}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-900">评审专家与打分</h2>
              <div className="text-xs text-slate-500">提交后自动流转到问题闭环</div>
            </div>

            <div className="mt-3 space-y-3">
              {experts.map((e) => {
                const canSubmit = user?.id === e.user_id && e.status !== 'submitted';
                return (
                  <div key={e.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900">
                          {e.full_name || e.username}
                          {e.required === 1 ? (
                            <span className="ml-2 rounded bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                              必选
                            </span>
                          ) : (
                            <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                              可选
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          状态：{e.status === 'submitted' ? '已提交' : '待提交'}
                        </div>
                      </div>
                      <div className="text-xs text-slate-600">
                        评分：{e.score != null ? `${e.score}` : '—'}
                      </div>
                    </div>

                    {e.status === 'submitted' && (
                      <div className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                        {e.opinion || '—'}
                      </div>
                    )}

                    {canSubmit && (
                      <form
                        onSubmit={(ev) => submitExpert(ev, e.user_id)}
                        className="mt-3 space-y-2"
                      >
                        <label className="block text-xs text-slate-500">
                          评分（0-100）
                          <input
                            type="number"
                            min={0}
                            max={100}
                            defaultValue={e.score ?? 80}
                            name={`score-${e.user_id}`}
                            className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                          />
                        </label>
                        <label className="block text-xs text-slate-500">
                          意见
                          <textarea
                            name={`op-${e.user_id}`}
                            defaultValue={e.opinion || ''}
                            rows={3}
                            className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                          />
                        </label>
                        <button
                          type="submit"
                          className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700"
                        >
                          提交打分与意见
                        </button>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-900">评审问题闭环</h2>
              <div className="text-xs text-slate-500">问题可转为待办任务并跟踪整改</div>
            </div>

            <form onSubmit={addIssue} className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="sm:col-span-2 block text-xs text-slate-500">
                问题标题
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                  value={issueForm.title}
                  onChange={(e) => setIssueForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="例如：关键零部件一致性验证不充分"
                  disabled={
                    !(experts.some((ex) => ex.user_id === user?.id) || user?.role === 'admin')
                  }
                />
              </label>
              <label className="block text-xs text-slate-500">
                严重度
                <select
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                  value={issueForm.severity}
                  onChange={(e) => setIssueForm((f) => ({ ...f, severity: e.target.value }))}
                  disabled={
                    !(experts.some((ex) => ex.user_id === user?.id) || user?.role === 'admin')
                  }
                >
                  <option value="low">低</option>
                  <option value="medium">中</option>
                  <option value="high">高</option>
                </select>
              </label>
              <label className="sm:col-span-2 block text-xs text-slate-500">
                描述（可选）
                <textarea
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                  value={issueForm.description}
                  onChange={(e) => setIssueForm((f) => ({ ...f, description: e.target.value }))}
                  disabled={
                    !(experts.some((ex) => ex.user_id === user?.id) || user?.role === 'admin')
                  }
                />
              </label>
              <div className="sm:col-span-2 flex items-center justify-between gap-3">
                <button
                  type="submit"
                  disabled={
                    !(experts.some((ex) => ex.user_id === user?.id) || user?.role === 'admin')
                  }
                  className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  新增评审问题
                </button>
                <div className="text-xs text-slate-500">管理员/评审专家可新增</div>
              </div>
            </form>

            <div className="mt-4 space-y-2">
              {issues.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
                  暂无问题
                </div>
              ) : (
                issues.map((i) => {
                  const isConverted = Boolean(i.converted_task_id);
                  const issueBg =
                    i.status === 'open'
                      ? 'bg-red-50'
                      : i.status === 'in_progress'
                        ? 'bg-amber-50'
                        : i.status === 'closed'
                          ? 'bg-emerald-50'
                          : 'bg-slate-50';
                  return (
                    <div key={i.id} className={`rounded-lg border border-slate-200 p-3 ${issueBg}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900">
                            {i.title}
                            <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                              {i.severity}
                            </span>
                          </div>
                          {i.description ? (
                            <div className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                              {i.description}
                            </div>
                          ) : null}
                          <div className="mt-1 text-xs text-slate-600">
                            状态：{i.status}
                          </div>
                          {i.converted_task_id ? (
                            <div className="mt-2 text-xs text-slate-600">
                              已转任务：{' '}
                              <Link to={`/tasks/${i.converted_task_id}`} className="font-semibold text-brand-700 hover:underline">
                                #{i.converted_task_id} {i.converted_task_title || ''}
                              </Link>
                            </div>
                          ) : null}
                        </div>

                        {!isConverted && (
                          <div className="flex flex-col items-end gap-2">
                            <button
                              type="button"
                              onClick={() => convertIssueToTask(i.id)}
                              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              转为待办任务
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-900">评审材料（上传预留）</h2>
              <div className="text-xs text-slate-500">用于版本/报告/样机等附件</div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <input
                type="file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadAttachment(f);
                  e.target.value = '';
                }}
                className="text-sm"
              />
              <span className="text-xs text-slate-500">单文件 ≤ 25MB</span>
            </div>
            <ul className="mt-3 space-y-2 text-sm">
              {attachments.length === 0 ? (
                <li className="text-slate-500">暂无附件</li>
              ) : (
                attachments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 truncate font-medium text-brand-700 hover:underline"
                    >
                      {a.file_name}
                    </a>
                  </li>
                ))
              )}
            </ul>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-900">评审报告</h2>
              <div className="text-xs text-slate-500">自动汇总专家打分与问题闭环</div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={generateReport}
                className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              >
                生成报告
              </button>
              <button
                type="button"
                onClick={exportPdf}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                导出 PDF
              </button>
            </div>

            {report ? (
              <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
                {report.report_text}
              </pre>
            ) : (
              <div className="mt-3 rounded-lg border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
                暂无报告内容（可点击“生成报告”）
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-900">归档并同步里程碑</h2>
              <div className="text-xs text-slate-500">评审结果将更新目标 `plan_milestones` 与 WBS 任务进度</div>
            </div>

            {review.status !== 'in_progress' && review.status !== 'scheduled' ? (
              <div className="mt-3 text-sm text-slate-700">
                当前已归档：{statusLabel[review.status] || review.status}
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <label className="block text-xs text-slate-500">
                  归档结论
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                    value={closeVerdict}
                    onChange={(e) => setCloseVerdict(e.target.value)}
                  >
                    <option value="passed">通过</option>
                    <option value="conditional">有条件通过</option>
                    <option value="rejected">不通过</option>
                    <option value="cancelled">取消</option>
                  </select>
                </label>
                <label className="block text-xs text-slate-500">
                  归档结论补充（可选）
                  <textarea
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                    value={closeConclusion}
                    onChange={(e) => setCloseConclusion(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  onClick={closeReview}
                  disabled={!isLeadOrAdmin}
                  className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  归档并同步里程碑
                </button>
                {!isLeadOrAdmin ? (
                  <div className="text-xs text-slate-500">
                    只有管理员或评审负责人可归档（后端也会校验）
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

