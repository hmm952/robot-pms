import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useProject } from '../context/ProjectContext.jsx';

const nav = [
  { to: '/', label: '项目总览', end: true },
  { to: '/tasks', label: '任务管理' },
  { to: '/plan', label: '计划与里程碑' },
  { to: '/reviews', label: '评审管理' },
  { to: '/meetings', label: '会议纪要解析' },
  { to: '/contracts', label: '合同管理' },
  { to: '/kpi', label: '人力与 KPI' },
  { to: '/competitors', label: '竞品分析' },
  { to: '/settings/notify', label: '自动通知' },
];

export default function Layout() {
  const { user, logout, isAdmin } = useAuth();
  const { projects, projectId, setProjectId, refreshProjects, loading } = useProject();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-64 flex-shrink-0 flex-col bg-slate-900 text-slate-100">
        <div className="border-b border-slate-800 px-4 py-5">
          <div className="font-display text-sm font-semibold tracking-tight text-white">
            Robot PMS
          </div>
          <p className="mt-1 text-xs text-slate-400">单产品线 · 制造研发协同</p>
        </div>
        <nav className="flex-1 space-y-0.5 p-3">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                [
                  'block rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-300 hover:bg-slate-800/60 hover:text-white',
                ].join(' ')
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-800 p-3 text-xs text-slate-500">
          v1.0 · 内网演示
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <span className="whitespace-nowrap">当前项目</span>
              <select
                className="max-w-xs rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-900 shadow-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                value={projectId ?? ''}
                disabled={loading || !projects.length}
                onChange={(e) => setProjectId(Number(e.target.value) || null)}
              >
                {!projects.length ? (
                  <option value="">暂无项目</option>
                ) : (
                  projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))
                )}
              </select>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => refreshProjects()}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  刷新
                </button>
              )}
            </label>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-slate-600 sm:inline">
              {user?.full_name || user?.username}
              {isAdmin && (
                <span className="ml-2 rounded bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                  管理员
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={logout}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
            >
              退出
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-auto bg-slate-50 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
