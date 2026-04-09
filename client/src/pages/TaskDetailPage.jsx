import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
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

export default function TaskDetailPage() {
  const { projectId } = useProject();
  const { id } = useParams();
  const taskId = Number(id);
  const [task, setTask] = useState(null);
  const [comments, setComments] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [commentBody, setCommentBody] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const title = useMemo(() => (task ? `任务详情：${task.title}` : '任务详情'), [task]);

  async function load() {
    if (!projectId || !taskId) return;
    setMsg('');
    const [t, cs, as] = await Promise.all([
      api.get(`/api/tasks/${taskId}`),
      api.get('/api/task-comments', { params: { taskId: taskId } }),
      api.get('/api/task-attachments', { params: { taskId: taskId } }),
    ]);
    setTask(t.data);
    setComments(cs.data);
    setAttachments(as.data);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, taskId]);

  async function savePatch(patch) {
    setBusy(true);
    setMsg('');
    try {
      await api.put(`/api/tasks/${taskId}`, patch);
      await load();
    } catch (e) {
      setMsg(e.message || '保存失败');
    } finally {
      setBusy(false);
    }
  }

  async function addComment(e) {
    e.preventDefault();
    if (!commentBody.trim()) return;
    setBusy(true);
    setMsg('');
    try {
      await api.post('/api/task-comments', { task_id: taskId, body: commentBody.trim() });
      setCommentBody('');
      await load();
    } catch (e) {
      setMsg(e.message || '添加备注失败');
    } finally {
      setBusy(false);
    }
  }

  async function uploadFile(file) {
    setBusy(true);
    setMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post('/api/task-attachments/upload', fd, {
        params: { taskId: taskId },
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setAttachments((cur) => [data, ...cur]);
    } catch (e) {
      setMsg(e.message || '上传失败');
    } finally {
      setBusy(false);
    }
  }

  async function removeAttachment(attId) {
    if (!window.confirm('删除该附件？')) return;
    setBusy(true);
    setMsg('');
    try {
      await api.delete(`/api/task-attachments/${attId}`);
      setAttachments((cur) => cur.filter((a) => a.id !== attId));
    } catch (e) {
      setMsg(e.message || '删除失败');
    } finally {
      setBusy(false);
    }
  }

  if (!task) {
    return (
      <div className="mx-auto max-w-5xl space-y-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
          加载中…
        </div>
      </div>
    );
  }

  const badgeCls = statusBadge[task.status] || 'bg-slate-100 text-slate-700';

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold text-slate-900">{title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeCls}`}>
              {statusLabel[task.status] || task.status}
            </span>
            <span className="text-xs text-slate-500">优先级：{task.priority}</span>
            <span className="text-xs text-slate-500">截止：{task.due_date || task.end_date || '—'}</span>
            {task.milestone_name ? (
              <span className="text-xs text-slate-500">里程碑：{task.milestone_name}</span>
            ) : null}
          </div>
        </div>
        <Link
          to="/tasks"
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          ← 返回任务列表
        </Link>
      </div>

      {msg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {msg}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">任务信息</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm text-slate-700">
            <div>
              <dt className="text-xs text-slate-500">责任人</dt>
              <dd className="font-medium">{task.assignee_name || '未指定'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">起止时间</dt>
              <dd className="font-medium">
                {task.start_date || '—'} ~ {task.end_date || '—'}
              </dd>
            </div>
          </dl>

          <div className="mt-4 space-y-3">
            <label className="block text-xs font-medium text-slate-600">
              进度（%）
              <input
                type="range"
                min={0}
                max={100}
                value={Number(task.progress ?? 0)}
                onChange={(e) => setTask((t) => ({ ...t, progress: Number(e.target.value) }))}
                className="mt-2 w-full"
                disabled={busy}
              />
            </label>
            <div className="flex items-center gap-3">
              <div className="text-sm font-semibold text-slate-900">{Number(task.progress ?? 0)}%</div>
              <button
                type="button"
                onClick={() => savePatch({ progress: Number(task.progress ?? 0) })}
                disabled={busy}
                className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                保存进度
              </button>
              <button
                type="button"
                onClick={() => savePatch({ status: 'done', progress: 100 })}
                disabled={busy}
                className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
              >
                标记完成
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">附件</h2>
          <div className="mt-3 flex items-center justify-between gap-3">
            <input
              type="file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadFile(f);
                e.target.value = '';
              }}
              disabled={busy}
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
                    className="min-w-0 truncate font-medium text-brand-700 hover:underline"
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {a.file_name}
                  </a>
                  <button
                    type="button"
                    onClick={() => removeAttachment(a.id)}
                    className="text-xs font-semibold text-red-600 hover:underline"
                    disabled={busy}
                  >
                    删除
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">备注</h2>
        <form onSubmit={addComment} className="mt-3 flex flex-col gap-2">
          <textarea
            rows={3}
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="记录进展、风险、决策点…"
            disabled={busy}
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={busy || !commentBody.trim()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              添加备注
            </button>
            <span className="text-xs text-slate-500">备注会实时保存到数据库</span>
          </div>
        </form>
        <ul className="mt-4 space-y-2 text-sm">
          {comments.length === 0 ? (
            <li className="text-slate-500">暂无备注</li>
          ) : (
            comments.map((c) => (
              <li key={c.id} className="rounded-lg border border-slate-200 px-3 py-2">
                <div className="text-xs text-slate-500">
                  {c.author_full_name || c.author_username || '未知'} · {c.created_at}
                </div>
                <div className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{c.body}</div>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

