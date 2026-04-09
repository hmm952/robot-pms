import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client.js';
import { useProject } from '../context/ProjectContext.jsx';

function formatAmount(c, amount) {
  if (amount == null) return '—';
  const cur = c || 'CNY';
  return `${amount.toLocaleString('zh-CN')} ${cur}`;
}

export default function ContractsPage() {
  const { projectId } = useProject();
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({
    title: '',
    counterparty: '',
    amount: '',
    currency: 'CNY',
    status: 'draft',
  });
  const [msg, setMsg] = useState('');

  async function load() {
    if (!projectId) return;
    const { data } = await api.get('/api/contracts', { params: { projectId } });
    setItems(data);
  }

  useEffect(() => {
    load();
  }, [projectId]);

  async function onSubmit(e) {
    e.preventDefault();
    setMsg('');
    if (!projectId) return;
    try {
      await api.post('/api/contracts', {
        project_id: projectId,
        title: form.title,
        counterparty: form.counterparty,
        amount: form.amount === '' ? null : Number(form.amount),
        currency: form.currency,
        status: form.status,
      });
      setForm({ title: '', counterparty: '', amount: '', currency: 'CNY', status: 'draft' });
      await load();
    } catch (err) {
      setMsg(err.message);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-slate-900">合同管理</h1>
        <p className="mt-1 text-sm text-slate-600">外协、采购与框架协议台账（金额字段可对接 ERP）。</p>
      </div>

      {!projectId ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
          请先选择项目。
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">合同名称</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">对方主体</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">金额</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                      暂无合同
                    </td>
                  </tr>
                ) : (
                  items.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3 font-medium text-slate-900">
                        <Link className="hover:underline" to={`/contracts/${c.id}`}>
                          {c.title}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{c.counterparty}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {formatAmount(c.currency, c.amount)}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{c.status}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <form
            onSubmit={onSubmit}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <h2 className="text-sm font-semibold text-slate-900">新增合同记录</h2>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div className="min-w-[200px] flex-1">
                <label className="text-xs text-slate-500">标题</label>
                <input
                  required
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                />
              </div>
              <div className="min-w-[200px] flex-1">
                <label className="text-xs text-slate-500">对方主体</label>
                <input
                  required
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={form.counterparty}
                  onChange={(e) => setForm((f) => ({ ...f, counterparty: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">金额</label>
                <input
                  type="number"
                  className="mt-1 w-36 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">币种</label>
                <input
                  className="mt-1 w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={form.currency}
                  onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">状态</label>
                <select
                  className="mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                >
                  <option value="draft">草稿</option>
                  <option value="negotiating">谈判中</option>
                  <option value="signed">已签署</option>
                  <option value="executing">执行中</option>
                  <option value="closed">关闭</option>
                  <option value="terminated">终止</option>
                </select>
              </div>
              <button
                type="submit"
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                保存
              </button>
            </div>
            {msg && <p className="mt-2 text-sm text-red-600">{msg}</p>}
          </form>
        </>
      )}
    </div>
  );
}
