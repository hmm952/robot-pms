import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../api/client.js';
import { useProject } from '../context/ProjectContext.jsx';

const paymentStatusLabel = {
  pending: '待支付',
  applied: '已申请',
  paid: '已支付',
  delayed: '已延期',
  cancelled: '已取消',
};

const paymentStatusBadge = {
  pending: 'bg-slate-100 text-slate-700',
  applied: 'bg-blue-50 text-blue-700',
  paid: 'bg-emerald-50 text-emerald-700',
  delayed: 'bg-amber-50 text-amber-800',
  cancelled: 'bg-slate-100 text-slate-500',
};

const deliverableStatusLabel = {
  pending: '待校验',
  matched: '已匹配',
  unmatched: '未匹配',
};

const deliverableStatusBadge = {
  pending: 'bg-slate-100 text-slate-700',
  matched: 'bg-emerald-50 text-emerald-700',
  unmatched: 'bg-red-50 text-red-700',
};

function formatAmount(currency, amount) {
  if (amount == null || amount === '') return '—';
  const c = currency || 'CNY';
  return `${Number(amount).toLocaleString('zh-CN')} ${c}`;
}

function getParsedInfo(versions) {
  const latest = Array.isArray(versions) ? versions[0] : null;
  if (!latest?.parsed_json) return null;
  try {
    const parsed = JSON.parse(latest.parsed_json);
    return typeof parsed === 'object' && parsed ? parsed : null;
  } catch {
    return null;
  }
}

export default function ContractDetailPage() {
  const { projectId } = useProject();
  const { id } = useParams();
  const contractId = Number(id);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [contract, setContract] = useState(null);

  const [uploadFile, setUploadFile] = useState(null);
  const [contractForm, setContractForm] = useState({
    title: '',
    counterparty: '',
    contract_type: '',
    amount: '',
    currency: 'CNY',
    status: 'draft',
    effective_date: '',
    expiry_date: '',
    document_ref: '',
  });
  const [newNode, setNewNode] = useState({ title: '', amount: '', due_date: '' });
  const [newDeliverable, setNewDeliverable] = useState({ title: '', requirement: '', due_date: '' });
  const [newChange, setNewChange] = useState({
    change_title: '',
    change_content: '',
    impact_scope: '',
    plan_adjustment: '',
  });
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');

  const parsedInfo = useMemo(() => getParsedInfo(contract?.versions), [contract?.versions]);

  async function load() {
    if (!contractId) return;
    setLoading(true);
    setMsg('');
    try {
      const { data } = await api.get(`/api/contracts/${contractId}`);
      setContract(data);
    } catch (e) {
      setMsg(e.message || '加载合同详情失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, contractId]);

  useEffect(() => {
    if (!contract) return;
    setContractForm({
      title: contract.title || '',
      counterparty: contract.counterparty || '',
      contract_type: contract.contract_type || '',
      amount: contract.amount == null ? '' : String(contract.amount),
      currency: contract.currency || 'CNY',
      status: contract.status || 'draft',
      effective_date: contract.effective_date || '',
      expiry_date: contract.expiry_date || '',
      document_ref: contract.document_ref || '',
    });
  }, [contract]);

  async function saveContractBaseInfo(e) {
    e.preventDefault();
    if (!contractForm.title.trim() || !contractForm.counterparty.trim()) return;
    setBusy(true);
    setMsg('');
    try {
      await api.put(`/api/contracts/${contractId}`, {
        title: contractForm.title.trim(),
        counterparty: contractForm.counterparty.trim(),
        contract_type: contractForm.contract_type || null,
        amount: contractForm.amount === '' ? null : Number(contractForm.amount),
        currency: contractForm.currency || 'CNY',
        status: contractForm.status,
        effective_date: contractForm.effective_date || null,
        expiry_date: contractForm.expiry_date || null,
        document_ref: contractForm.document_ref || null,
      });
      setMsg('合同基础信息已更新');
      await load();
    } catch (err) {
      setMsg(err.message || '更新合同基础信息失败');
    } finally {
      setBusy(false);
    }
  }

  async function submitUploadAndParse(e) {
    e.preventDefault();
    if (!uploadFile) return;
    setBusy(true);
    setMsg('');
    try {
      const fd = new FormData();
      fd.append('file', uploadFile);
      const { data } = await api.post(`/api/contracts/${contractId}/upload-and-parse`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setUploadFile(null);
      setMsg(data.message || '上传并解析成功');
      await load();
    } catch (err) {
      setMsg(err.message || '上传解析失败');
    } finally {
      setBusy(false);
    }
  }

  async function addPaymentNode(e) {
    e.preventDefault();
    if (!newNode.title.trim() || !newNode.due_date) return;
    setBusy(true);
    setMsg('');
    try {
      await api.post(`/api/contracts/${contractId}/payment-nodes`, {
        title: newNode.title.trim(),
        due_date: newNode.due_date,
        amount: newNode.amount === '' ? null : Number(newNode.amount),
      });
      setNewNode({ title: '', amount: '', due_date: '' });
      await load();
    } catch (err) {
      setMsg(err.message || '新增付款节点失败');
    } finally {
      setBusy(false);
    }
  }

  async function syncNodeToMilestone(nodeId) {
    setBusy(true);
    setMsg('');
    try {
      const { data } = await api.post(`/api/contracts/${contractId}/payment-nodes/${nodeId}/sync-milestone`);
      setMsg(data.message || '已同步到里程碑');
      await load();
    } catch (err) {
      setMsg(err.message || '同步里程碑失败');
    } finally {
      setBusy(false);
    }
  }

  async function runReminder() {
    setBusy(true);
    setMsg('');
    try {
      const { data } = await api.post(`/api/contracts/${contractId}/payment-nodes/run-reminder`);
      setMsg(data.message || '提醒执行完成');
      await load();
    } catch (err) {
      setMsg(err.message || '执行提醒失败');
    } finally {
      setBusy(false);
    }
  }

  async function updatePaymentNodeStatus(nodeId, status) {
    setBusy(true);
    setMsg('');
    try {
      await api.put(`/api/contracts/${contractId}/payment-nodes/${nodeId}`, { status });
      setMsg(`付款节点状态已更新为：${paymentStatusLabel[status] || status}`);
      await load();
    } catch (err) {
      setMsg(err.message || '更新付款节点状态失败');
    } finally {
      setBusy(false);
    }
  }

  async function addDeliverable(e) {
    e.preventDefault();
    if (!newDeliverable.title.trim()) return;
    setBusy(true);
    setMsg('');
    try {
      await api.post(`/api/contracts/${contractId}/deliverables`, {
        title: newDeliverable.title.trim(),
        requirement: newDeliverable.requirement || null,
        due_date: newDeliverable.due_date || null,
      });
      setNewDeliverable({ title: '', requirement: '', due_date: '' });
      await load();
    } catch (err) {
      setMsg(err.message || '新增交付要求失败');
    } finally {
      setBusy(false);
    }
  }

  async function validateDeliverables() {
    setBusy(true);
    setMsg('');
    try {
      const { data } = await api.post(`/api/contracts/${contractId}/validate-deliverables`);
      setMsg(data.message || '交付物校验完成');
      await load();
    } catch (err) {
      setMsg(err.message || '交付物校验失败');
    } finally {
      setBusy(false);
    }
  }

  async function addChangeLog(e) {
    e.preventDefault();
    if (!newChange.change_title.trim() || !newChange.change_content.trim()) return;
    setBusy(true);
    setMsg('');
    try {
      await api.post(`/api/contracts/${contractId}/changes`, {
        change_title: newChange.change_title.trim(),
        change_content: newChange.change_content.trim(),
        impact_scope: newChange.impact_scope || null,
        plan_adjustment: newChange.plan_adjustment || null,
      });
      setNewChange({
        change_title: '',
        change_content: '',
        impact_scope: '',
        plan_adjustment: '',
      });
      await load();
    } catch (err) {
      setMsg(err.message || '新增变更记录失败');
    } finally {
      setBusy(false);
    }
  }

  async function askContractQa(e) {
    e.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    setMsg('');
    try {
      const { data } = await api.post(`/api/contracts/${contractId}/qa`, { question: question.trim() });
      setAnswer(data.answer || '未获得答案');
    } catch (err) {
      setMsg(err.message || '问答失败');
    } finally {
      setBusy(false);
    }
  }

  if (!contract) {
    return (
      <div className="mx-auto max-w-6xl space-y-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
          {loading ? '加载中…' : '未找到合同'}
        </div>
        {msg && <div className="text-sm text-red-600">{msg}</div>}
        <Link to="/contracts" className="text-sm font-semibold text-brand-700 hover:underline">
          ← 返回合同列表
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold text-slate-900">{contract.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">合作方：{contract.counterparty}</span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">
              金额：{formatAmount(contract.currency, contract.amount)}
            </span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">状态：{contract.status}</span>
          </div>
        </div>
        <Link
          to="/contracts"
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          ← 返回合同列表
        </Link>
      </div>

      {msg && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {msg}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">编辑合同基础信息</h2>
            <form onSubmit={saveContractBaseInfo} className="mt-3 grid gap-2 sm:grid-cols-2">
              <input
                className="sm:col-span-2 rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                placeholder="合同名称"
                value={contractForm.title}
                onChange={(e) => setContractForm((f) => ({ ...f, title: e.target.value }))}
                disabled={busy}
              />
              <input
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                placeholder="合作方"
                value={contractForm.counterparty}
                onChange={(e) => setContractForm((f) => ({ ...f, counterparty: e.target.value }))}
                disabled={busy}
              />
              <input
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                placeholder="合同类型（可选）"
                value={contractForm.contract_type}
                onChange={(e) => setContractForm((f) => ({ ...f, contract_type: e.target.value }))}
                disabled={busy}
              />
              <input
                type="number"
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                placeholder="合同金额"
                value={contractForm.amount}
                onChange={(e) => setContractForm((f) => ({ ...f, amount: e.target.value }))}
                disabled={busy}
              />
              <input
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                placeholder="币种（默认 CNY）"
                value={contractForm.currency}
                onChange={(e) => setContractForm((f) => ({ ...f, currency: e.target.value }))}
                disabled={busy}
              />
              <select
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                value={contractForm.status}
                onChange={(e) => setContractForm((f) => ({ ...f, status: e.target.value }))}
                disabled={busy}
              >
                <option value="draft">草稿</option>
                <option value="negotiating">谈判中</option>
                <option value="signed">已签署</option>
                <option value="executing">执行中</option>
                <option value="closed">关闭</option>
                <option value="terminated">终止</option>
              </select>
              <input
                type="date"
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                value={contractForm.effective_date}
                onChange={(e) => setContractForm((f) => ({ ...f, effective_date: e.target.value }))}
                disabled={busy}
              />
              <input
                type="date"
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                value={contractForm.expiry_date}
                onChange={(e) => setContractForm((f) => ({ ...f, expiry_date: e.target.value }))}
                disabled={busy}
              />
              <input
                className="sm:col-span-2 rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                placeholder="文档引用（可选）"
                value={contractForm.document_ref}
                onChange={(e) => setContractForm((f) => ({ ...f, document_ref: e.target.value }))}
                disabled={busy}
              />
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  保存基础信息
                </button>
              </div>
            </form>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-900">合同版本与RAG解析</h2>
              <div className="text-xs text-slate-500">支持 PDF / DOCX 上传</div>
            </div>
            <form onSubmit={submitUploadAndParse} className="mt-3 flex flex-wrap items-center gap-2">
              <input
                type="file"
                accept=".pdf,.docx"
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                disabled={busy}
                className="text-sm"
              />
              <button
                type="submit"
                disabled={busy || !uploadFile}
                className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                上传并解析
              </button>
            </form>
            <ul className="mt-3 space-y-2 text-sm">
              {(contract.versions || []).length === 0 ? (
                <li className="text-slate-500">暂无版本记录</li>
              ) : (
                contract.versions.map((v) => (
                  <li key={v.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium text-slate-900">
                        v{v.version_no} · {v.file_name || '未命名文件'}
                      </div>
                      <div className="text-xs text-slate-500">{v.created_at}</div>
                    </div>
                    {v.file_url ? (
                      <a
                        href={v.file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-xs font-semibold text-brand-700 hover:underline"
                      >
                        查看原文件
                      </a>
                    ) : null}
                  </li>
                ))
              )}
            </ul>
            {parsedInfo ? (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <div className="font-semibold text-slate-900">最近一次解析结果</div>
                <div className="mt-1 text-xs">违约责任：{parsedInfo.breach_liability || '—'}</div>
                <div className="mt-1 text-xs">保密条款：{parsedInfo.confidentiality_clause || '—'}</div>
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-900">付款节点时间线</h2>
              <button
                type="button"
                onClick={runReminder}
                disabled={busy}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                运行7天提醒
              </button>
            </div>
            <form onSubmit={addPaymentNode} className="mt-3 grid gap-2 sm:grid-cols-3">
              <input
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                placeholder="节点名称"
                value={newNode.title}
                onChange={(e) => setNewNode((f) => ({ ...f, title: e.target.value }))}
                disabled={busy}
              />
              <input
                type="number"
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                placeholder="金额(可选)"
                value={newNode.amount}
                onChange={(e) => setNewNode((f) => ({ ...f, amount: e.target.value }))}
                disabled={busy}
              />
              <input
                type="date"
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                value={newNode.due_date}
                onChange={(e) => setNewNode((f) => ({ ...f, due_date: e.target.value }))}
                disabled={busy}
              />
              <div className="sm:col-span-3">
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  新增付款节点
                </button>
              </div>
            </form>
            <div className="mt-3 space-y-2">
              {(contract.payment_nodes || []).length === 0 ? (
                <div className="text-sm text-slate-500">暂无付款节点</div>
              ) : (
                contract.payment_nodes.map((n) => {
                  const badgeCls = paymentStatusBadge[n.status] || 'bg-slate-100 text-slate-700';
                  return (
                    <div key={n.id} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-medium text-slate-900">{n.title}</div>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeCls}`}>
                          {paymentStatusLabel[n.status] || n.status}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                        <span>到期：{n.due_date}</span>
                        <span>金额：{formatAmount(contract.currency, n.amount)}</span>
                        {n.warn_soon ? <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-800">7天内到期</span> : null}
                        {n.overdue ? <span className="rounded bg-red-100 px-2 py-0.5 text-red-700">已逾期</span> : null}
                        {n.milestone_name ? (
                          <span className="rounded bg-blue-100 px-2 py-0.5 text-blue-700">{n.milestone_name}</span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => syncNodeToMilestone(n.id)}
                        disabled={busy}
                        className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        同步项目里程碑
                      </button>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {['pending', 'applied', 'paid', 'delayed', 'cancelled'].map((status) => (
                          <button
                            key={status}
                            type="button"
                            disabled={busy || n.status === status}
                            onClick={() => updatePaymentNodeStatus(n.id, status)}
                            className={[
                              'rounded-lg border px-2.5 py-1 text-xs font-semibold',
                              n.status === status
                                ? 'border-slate-400 bg-slate-100 text-slate-700'
                                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                              busy ? 'opacity-60' : '',
                            ].join(' ')}
                          >
                            {paymentStatusLabel[status]}
                          </button>
                        ))}
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
              <h2 className="text-sm font-semibold text-slate-900">交付要求对齐与校验</h2>
              <button
                type="button"
                onClick={validateDeliverables}
                disabled={busy}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                自动校验
              </button>
            </div>
            <form onSubmit={addDeliverable} className="mt-3 grid gap-2">
              <input
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                placeholder="交付物标题"
                value={newDeliverable.title}
                onChange={(e) => setNewDeliverable((f) => ({ ...f, title: e.target.value }))}
                disabled={busy}
              />
              <textarea
                rows={2}
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                placeholder="交付要求（可选）"
                value={newDeliverable.requirement}
                onChange={(e) => setNewDeliverable((f) => ({ ...f, requirement: e.target.value }))}
                disabled={busy}
              />
              <input
                type="date"
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                value={newDeliverable.due_date}
                onChange={(e) => setNewDeliverable((f) => ({ ...f, due_date: e.target.value }))}
                disabled={busy}
              />
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                新增交付要求
              </button>
            </form>
            <div className="mt-3 space-y-2">
              {(contract.deliverables || []).length === 0 ? (
                <div className="text-sm text-slate-500">暂无交付要求</div>
              ) : (
                contract.deliverables.map((d) => {
                  const badgeCls = deliverableStatusBadge[d.check_status] || 'bg-slate-100 text-slate-700';
                  return (
                    <div key={d.id} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-medium text-slate-900">{d.title}</div>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeCls}`}>
                          {deliverableStatusLabel[d.check_status] || d.check_status}
                        </span>
                      </div>
                      {d.requirement ? <div className="mt-1 text-xs text-slate-600">{d.requirement}</div> : null}
                      <div className="mt-1 text-xs text-slate-500">交付时间：{d.due_date || '—'}</div>
                      {d.linked_task_id ? (
                        <Link
                          to={`/tasks/${d.linked_task_id}`}
                          className="mt-1 inline-block text-xs font-semibold text-brand-700 hover:underline"
                        >
                          已关联任务：#{d.linked_task_id} {d.linked_task_title || ''}
                        </Link>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">合同变更与项目联动</h2>
            <form onSubmit={addChangeLog} className="mt-3 grid gap-2">
              <input
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                placeholder="变更标题"
                value={newChange.change_title}
                onChange={(e) => setNewChange((f) => ({ ...f, change_title: e.target.value }))}
                disabled={busy}
              />
              <textarea
                rows={2}
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                placeholder="变更内容"
                value={newChange.change_content}
                onChange={(e) => setNewChange((f) => ({ ...f, change_content: e.target.value }))}
                disabled={busy}
              />
              <input
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                placeholder="影响范围（可选）"
                value={newChange.impact_scope}
                onChange={(e) => setNewChange((f) => ({ ...f, impact_scope: e.target.value }))}
                disabled={busy}
              />
              <input
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                placeholder="计划调整建议（可选）"
                value={newChange.plan_adjustment}
                onChange={(e) => setNewChange((f) => ({ ...f, plan_adjustment: e.target.value }))}
                disabled={busy}
              />
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                记录变更并生成联动任务
              </button>
            </form>
            <div className="mt-3 space-y-2">
              {(contract.changes || []).length === 0 ? (
                <div className="text-sm text-slate-500">暂无变更记录</div>
              ) : (
                contract.changes.map((c) => (
                  <div key={c.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="font-medium text-slate-900">{c.change_title}</div>
                    <div className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{c.change_content}</div>
                    <div className="mt-1 text-xs text-slate-500">影响范围：{c.impact_scope || '—'}</div>
                    <div className="mt-1 text-xs text-slate-500">计划调整：{c.plan_adjustment || '—'}</div>
                    {c.linked_task_id ? (
                      <Link
                        to={`/tasks/${c.linked_task_id}`}
                        className="mt-1 inline-block text-xs font-semibold text-brand-700 hover:underline"
                      >
                        联动任务：#{c.linked_task_id} {c.linked_task_title || ''}
                      </Link>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">RAG合同问答</h2>
            <form onSubmit={askContractQa} className="mt-3 flex gap-2">
              <input
                className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="例如：这个合同里延迟交付的违约金是多少？"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                disabled={busy}
              />
              <button
                type="submit"
                disabled={busy || !question.trim()}
                className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                提问
              </button>
            </form>
            <div className="mt-3 rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
              {answer || '暂无问答结果'}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">通知记录</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {(contract.notifications || []).length === 0 ? (
                <li className="text-slate-500">暂无通知</li>
              ) : (
                contract.notifications.map((n) => (
                  <li key={n.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="font-medium text-slate-900">{n.title}</div>
                    <div className="mt-1 text-xs text-slate-600">{n.body || '—'}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      类型：{n.notify_type} · 状态：{n.status} · {n.created_at}
                    </div>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
