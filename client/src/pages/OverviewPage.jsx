import { useEffect, useState } from 'react';
import api from '../api/client.js';
import { useProject } from '../context/ProjectContext.jsx';

function StatCard({ title, value, sub }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</div>
      <div className="mt-2 font-display text-2xl font-semibold text-slate-900">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export default function OverviewPage() {
  const { projectId, currentProject } = useProject();
  const [stats, setStats] = useState(null);
  const [integrations, setIntegrations] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!projectId) {
        setStats(null);
        return;
      }
      try {
        const [tasks, reviews, contracts, kpi, comp, integ] = await Promise.all([
          api.get('/api/tasks', { params: { projectId } }),
          api.get('/api/reviews', { params: { projectId } }),
          api.get('/api/contracts', { params: { projectId } }),
          api.get('/api/kpi', { params: { projectId } }),
          api.get('/api/competitors', { params: { projectId } }),
          api.get('/api/integrations/status'),
        ]);
        if (cancelled) return;
        const ts = tasks.data;
        setStats({
          tasksTotal: ts.length,
          tasksDone: ts.filter((t) => t.status === 'done').length,
          reviews: reviews.data.length,
          contracts: contracts.data.length,
          kpi: kpi.data.length,
          competitors: comp.data.length,
        });
        setIntegrations(integ.data);
      } catch {
        if (!cancelled) setStats(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-slate-900">项目总览</h1>
        <p className="mt-1 text-sm text-slate-600">
          {currentProject
            ? `${currentProject.name} · ${currentProject.product_line || '产品线'}`
            : '请选择或创建项目'}
        </p>
      </div>

      {!projectId ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          当前没有可选项目。请使用管理员在后端种子数据或调用 <code className="rounded bg-white px-1">POST /api/projects</code>{' '}
          创建项目。
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            title="任务进度"
            value={stats ? `${stats.tasksDone}/${stats.tasksTotal}` : '—'}
            sub="已完成 / 总数"
          />
          <StatCard title="评审事项" value={stats?.reviews ?? '—'} sub="本产品线相关" />
          <StatCard title="合同条目" value={stats?.contracts ?? '—'} sub="采购与外包等" />
          <StatCard title="KPI 记录" value={stats?.kpi ?? '—'} sub="按人员/指标/月度" />
          <StatCard title="竞品档案" value={stats?.competitors ?? '—'} sub="市场与对标" />
          <StatCard
            title="项目状态"
            value={currentProject?.status || '—'}
            sub={currentProject?.budget_note ? '预算备注已记录' : '可扩展成本子表'}
          />
        </div>
      )}

      {currentProject && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">项目说明</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              {currentProject.description || '暂无描述'}
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-xs text-slate-600">
              <div>
                <dt className="text-slate-400">开始</dt>
                <dd className="font-medium text-slate-800">{currentProject.start_date || '—'}</dd>
              </div>
              <div>
                <dt className="text-slate-400">计划结束</dt>
                <dd className="font-medium text-slate-800">{currentProject.end_date || '—'}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">集成状态（预留）</h2>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>
                <span className="font-medium text-slate-800">科大讯飞 RAG：</span>
                {integrations?.iflytekRag?.configured ? '已配置' : '未配置'}
                <span className="block text-xs text-slate-500">
                  {integrations?.iflytekRag?.hint}
                </span>
              </li>
              <li>
                <span className="font-medium text-slate-800">SMTP 邮件：</span>
                {integrations?.smtp?.configured ? '已配置' : '未配置'}
                <span className="block text-xs text-slate-500">{integrations?.smtp?.hint}</span>
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
