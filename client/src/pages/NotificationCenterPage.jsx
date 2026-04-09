import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api/client.js';
import { useProject } from '../context/ProjectContext.jsx';

const EVENT_OPTIONS = [
  { value: 'task_overdue', label: '任务逾期预警' },
  { value: 'review_reminder', label: '评审提醒' },
  { value: 'payment_reminder', label: '付款提醒' },
  { value: 'milestone_warning', label: '里程碑预警' },
];

// URL 短码字典（通知运营台筛选/分页状态记忆）：
// re/ren: rules eventType/enabled
// rp/rps: rules page/pageSize
// he/hs: history eventType/status
// hp/hps: history page/pageSize
const QK = {
  re: 're',
  ren: 'ren',
  rp: 'rp',
  rps: 'rps',
  he: 'he',
  hs: 'hs',
  hp: 'hp',
  hps: 'hps',
};

export default function NotificationCenterPage() {
  const { projectId } = useProject();
  const [searchParams, setSearchParams] = useSearchParams();
  const [msg, setMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [smtp, setSmtp] = useState({
    host: '',
    port: 587,
    secure: false,
    user: '',
    pass: '',
    from: '',
    wecomWebhook: '',
    dingtalkWebhook: '',
  });
  const [templates, setTemplates] = useState([]);
  const [rules, setRules] = useState([]);
  const [history, setHistory] = useState([]);
  const [ruleFilters, setRuleFilters] = useState(() => ({
    eventType: searchParams.get(QK.re) || '',
    enabled: searchParams.get(QK.ren) || '',
  }));
  const [historyFilters, setHistoryFilters] = useState(() => ({
    eventType: searchParams.get(QK.he) || '',
    status: searchParams.get(QK.hs) || '',
  }));
  const [rulePage, setRulePage] = useState(() => ({
    page: Math.max(1, Number(searchParams.get(QK.rp) || 1)),
    pageSize: Math.max(1, Number(searchParams.get(QK.rps) || 10)),
    total: 0,
    totalPages: 1,
  }));
  const [historyPage, setHistoryPage] = useState(() => ({
    page: Math.max(1, Number(searchParams.get(QK.hp) || 1)),
    pageSize: Math.max(1, Number(searchParams.get(QK.hps) || 10)),
    total: 0,
    totalPages: 1,
  }));
  const [customTpl, setCustomTpl] = useState({
    code: '',
    name: '',
    category: 'custom',
    subject_template: '',
    body_template: '',
  });
  const [ruleForm, setRuleForm] = useState({
    event_type: 'task_overdue',
    template_code: 'overdue_warning',
    offset_days: 1,
    recipient_mode: 'auto',
    manual_recipients: '',
    channel: 'email',
  });
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [manualForm, setManualForm] = useState({
    template_code: 'overdue_warning',
    recipients: '',
    variables_json:
      '{"project_name":"示例项目","task_title":"任务A","assignee_name":"张三","due_date":"2026-04-30","progress":50,"delay_days":2,"system_link":"http://localhost:5173/tasks/1"}',
  });

  async function load() {
    if (!projectId) return;
    const [s, t] = await Promise.all([
      api.get('/api/notifications/smtp/config'),
      api.get('/api/notifications/templates'),
    ]);
    setSmtp((x) => ({
      ...x,
      host: s.data?.source?.db?.host || '',
      port: s.data?.source?.db?.port || 587,
      secure: Boolean(s.data?.source?.db?.secure),
      user: s.data?.source?.db?.user || '',
      pass: '',
      from: s.data?.source?.db?.from || '',
      wecomWebhook: s.data?.source?.db?.wecomWebhook || '',
      dingtalkWebhook: s.data?.source?.db?.dingtalkWebhook || '',
    }));
    setTemplates(t.data || []);
    await loadRules(1);
    await loadHistory(1);
  }

  async function loadRules(page = rulePage.page) {
    if (!projectId) return;
    const { data } = await api.get('/api/notifications/rules', {
      params: {
        projectId,
        eventType: ruleFilters.eventType || undefined,
        enabled: ruleFilters.enabled || undefined,
        page,
        pageSize: rulePage.pageSize,
      },
    });
    setRules(data.items || []);
    setRulePage((prev) => ({ ...prev, ...(data.pagination || {}), pageSize: prev.pageSize }));
  }

  async function loadHistory(page = historyPage.page) {
    if (!projectId) return;
    const { data } = await api.get('/api/notifications/history', {
      params: {
        projectId,
        eventType: historyFilters.eventType || undefined,
        status: historyFilters.status || undefined,
        page,
        pageSize: historyPage.pageSize,
      },
    });
    setHistory(data.items || []);
    setHistoryPage((prev) => ({ ...prev, ...(data.pagination || {}), pageSize: prev.pageSize }));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    loadRules(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, ruleFilters.eventType, ruleFilters.enabled]);

  useEffect(() => {
    loadHistory(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, historyFilters.eventType, historyFilters.status]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    const setOrDelete = (k, v, omit = '') => {
      if (v == null || String(v) === String(omit)) next.delete(k);
      else next.set(k, String(v));
    };
    setOrDelete(QK.re, ruleFilters.eventType, '');
    setOrDelete(QK.ren, ruleFilters.enabled, '');
    setOrDelete(QK.he, historyFilters.eventType, '');
    setOrDelete(QK.hs, historyFilters.status, '');
    setOrDelete(QK.rp, rulePage.page, 1);
    setOrDelete(QK.rps, rulePage.pageSize, 10);
    setOrDelete(QK.hp, historyPage.page, 1);
    setOrDelete(QK.hps, historyPage.pageSize, 10);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ruleFilters.eventType,
    ruleFilters.enabled,
    historyFilters.eventType,
    historyFilters.status,
    rulePage.page,
    rulePage.pageSize,
    historyPage.page,
    historyPage.pageSize,
  ]);

  async function saveSmtp(e) {
    e.preventDefault();
    try {
      await api.put('/api/notifications/smtp/config', {
        host: smtp.host,
        port: Number(smtp.port || 587),
        secure: Boolean(smtp.secure),
        user: smtp.user,
        pass: smtp.pass || undefined,
        from: smtp.from,
        wecomWebhook: smtp.wecomWebhook || '',
        dingtalkWebhook: smtp.dingtalkWebhook || '',
      });
      setMsg('SMTP 配置已保存');
      setSmtp((x) => ({ ...x, pass: '' }));
    } catch (e2) {
      setMsg(e2.message || '保存 SMTP 失败');
    }
  }

  async function createTemplate(e) {
    e.preventDefault();
    try {
      await api.post('/api/notifications/templates', customTpl);
      setCustomTpl({
        code: '',
        name: '',
        category: 'custom',
        subject_template: '',
        body_template: '',
      });
      await loadRules();
      setMsg('已新增自定义模板');
    } catch (e2) {
      setMsg(e2.message || '新增模板失败');
    }
  }

  async function createOrUpdateRule(e) {
    e.preventDefault();
    if (!projectId) return;
    try {
      const payload = {
        project_id: projectId,
        ...ruleForm,
        offset_days: Number(ruleForm.offset_days || 1),
      };
      if (editingRuleId) {
        await api.put(`/api/notifications/rules/${editingRuleId}`, payload);
      } else {
        await api.post('/api/notifications/rules', payload);
      }
      await loadRules();
      setMsg(editingRuleId ? '规则已更新' : '触发规则已新增');
      setEditingRuleId(null);
      setRuleForm({
        event_type: 'task_overdue',
        template_code: 'overdue_warning',
        offset_days: 1,
        recipient_mode: 'auto',
        manual_recipients: '',
        channel: 'email',
      });
    } catch (e2) {
      setMsg(e2.message || '保存规则失败');
    }
  }

  function startEditRule(rule) {
    setEditingRuleId(rule.id);
    setRuleForm({
      event_type: rule.event_type,
      template_code: rule.template_code,
      offset_days: rule.offset_days ?? 1,
      recipient_mode: rule.recipient_mode || 'auto',
      manual_recipients: rule.manual_recipients || '',
      channel: rule.channel || 'email',
    });
  }

  async function toggleRuleEnabled(rule) {
    try {
      await api.put(`/api/notifications/rules/${rule.id}`, {
        enabled: !Boolean(rule.enabled),
      });
      await loadRules();
      setMsg(Boolean(rule.enabled) ? '规则已停用' : '规则已启用');
    } catch (e2) {
      setMsg(e2.message || '切换启停失败');
    }
  }

  async function deleteRule(ruleId) {
    if (!window.confirm('确认删除该通知规则？删除后不可恢复。')) return;
    try {
      await api.delete(`/api/notifications/rules/${ruleId}`);
      if (editingRuleId === ruleId) {
        setEditingRuleId(null);
      }
      await loadRules();
      setMsg('规则已删除');
    } catch (e2) {
      setMsg(e2.message || '删除规则失败');
    }
  }

  async function runAutoNow() {
    try {
      await api.post('/api/notifications/run');
      await loadRules();
      setMsg('自动触发已执行');
    } catch (e2) {
      setMsg(e2.message || '执行失败');
    }
  }

  async function sendManual(e) {
    e.preventDefault();
    if (!projectId) return;
    try {
      const vars = JSON.parse(manualForm.variables_json || '{}');
      await api.post('/api/notifications/send', {
        project_id: projectId,
        template_code: manualForm.template_code,
        recipients: manualForm.recipients,
        variables: vars,
      });
      await loadHistory();
      setMsg('手动通知发送成功');
    } catch (e2) {
      setMsg(e2.message || '手动发送失败');
    }
  }

  async function copyCurrentUrl() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      setMsg('已复制当前页面 URL，可直接粘贴给测试或研发定位问题。');
    } catch {
      setMsg('复制失败，请手动复制浏览器地址栏 URL。');
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-slate-900">制造业场景化自动通知</h1>
        <p className="mt-1 text-sm text-slate-600">
          支持模板变量填充、自动触发规则、发送历史追踪；预留企业微信/钉钉接口。
        </p>
      </div>
      <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">
          参数说明（URL 状态短码字典）
        </summary>
        <p className="mt-2 text-xs text-slate-500">
          用于规则/历史的筛选与分页状态记忆，方便测试提单时带上完整复现链接。
        </p>
        <div className="mt-2">
          <button
            type="button"
            onClick={copyCurrentUrl}
            className={[
              'rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
              copied
                ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100',
            ].join(' ')}
          >
            {copied ? '已复制' : '一键复制当前 URL'}
          </button>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-2 pr-3">短码</th>
                <th className="py-2 pr-3">含义</th>
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {[
                ['re', 'rules.eventType（规则事件类型筛选）'],
                ['ren', 'rules.enabled（规则启停状态筛选）'],
                ['rp/rps', 'rules 页码 / 每页条数'],
                ['he', 'history.eventType（历史事件类型筛选）'],
                ['hs', 'history.status（历史发送状态筛选）'],
                ['hp/hps', 'history 页码 / 每页条数'],
              ].map(([k, v]) => (
                <tr key={k} className="border-t border-slate-100">
                  <td className="py-2 pr-3 font-mono text-xs">{k}</td>
                  <td className="py-2 pr-3">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          示例 URL：
          <code className="ml-1 break-all font-mono">
            /settings/notify?re=task_overdue&amp;ren=1&amp;rp=2&amp;rps=10
          </code>
        </div>
      </details>
      {msg ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {msg}
        </div>
      ) : null}

      <form onSubmit={saveSmtp} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">邮箱配置（SMTP）</h2>
        <p className="mt-1 text-xs text-slate-500">
          示例：QQ 企业邮箱常用 `smtp.exmail.qq.com`，465 用 SSL(`secure=true`)；587 用 TLS(`secure=false`)。
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="SMTP 服务器" value={smtp.host} onChange={(e) => setSmtp((f) => ({ ...f, host: e.target.value }))} />
          <input type="number" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="端口" value={smtp.port} onChange={(e) => setSmtp((f) => ({ ...f, port: e.target.value }))} />
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={smtp.secure} onChange={(e) => setSmtp((f) => ({ ...f, secure: e.target.checked }))} />使用 SSL（secure）</label>
          <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="邮箱账号（SMTP_USER）" value={smtp.user} onChange={(e) => setSmtp((f) => ({ ...f, user: e.target.value }))} />
          <input type="password" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="授权码（留空表示不改）" value={smtp.pass} onChange={(e) => setSmtp((f) => ({ ...f, pass: e.target.value }))} />
          <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="发件人（SMTP_FROM）" value={smtp.from} onChange={(e) => setSmtp((f) => ({ ...f, from: e.target.value }))} />
          <input className="sm:col-span-2 rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="企业微信 Webhook（预留）" value={smtp.wecomWebhook} onChange={(e) => setSmtp((f) => ({ ...f, wecomWebhook: e.target.value }))} />
          <input className="sm:col-span-2 rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="钉钉 Webhook（预留）" value={smtp.dingtalkWebhook} onChange={(e) => setSmtp((f) => ({ ...f, dingtalkWebhook: e.target.value }))} />
          <div className="sm:col-span-2"><button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">保存邮箱配置</button></div>
        </div>
      </form>

      <div className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={createTemplate} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">模板库（内置 + 自定义）</h2>
          <div className="mt-2 max-h-44 overflow-auto rounded border border-slate-200 p-2 text-xs text-slate-700">
            {templates.map((t) => (
              <div key={t.id} className="border-b border-slate-100 py-1 last:border-0">
                <span className="font-semibold">{t.name}</span> · <span>{t.code}</span> ·{' '}
                <span>{t.is_builtin ? '内置' : '自定义'}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 grid gap-2">
            <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="模板编码（唯一）" value={customTpl.code} onChange={(e) => setCustomTpl((f) => ({ ...f, code: e.target.value }))} />
            <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="模板名称" value={customTpl.name} onChange={(e) => setCustomTpl((f) => ({ ...f, name: e.target.value }))} />
            <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="邮件标题模板（如 {{project_name}}）" value={customTpl.subject_template} onChange={(e) => setCustomTpl((f) => ({ ...f, subject_template: e.target.value }))} />
            <textarea className="rounded-lg border border-slate-200 px-3 py-2 text-sm" rows={4} placeholder="正文模板（支持变量）" value={customTpl.body_template} onChange={(e) => setCustomTpl((f) => ({ ...f, body_template: e.target.value }))} />
            <button className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">新增自定义模板</button>
          </div>
        </form>

        <form onSubmit={createOrUpdateRule} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">自动触发规则</h2>
            <button type="button" onClick={runAutoNow} className="rounded border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700">立即执行联动</button>
          </div>
          <div className="mt-3 grid gap-2">
            <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={ruleForm.event_type} onChange={(e) => setRuleForm((f) => ({ ...f, event_type: e.target.value }))}>
              {EVENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={ruleForm.template_code} onChange={(e) => setRuleForm((f) => ({ ...f, template_code: e.target.value }))}>
              {templates.map((t) => <option key={t.id} value={t.code}>{t.name}({t.code})</option>)}
            </select>
            <input type="number" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="触发天数（如 1/3/7）" value={ruleForm.offset_days} onChange={(e) => setRuleForm((f) => ({ ...f, offset_days: e.target.value }))} />
            <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={ruleForm.recipient_mode} onChange={(e) => setRuleForm((f) => ({ ...f, recipient_mode: e.target.value }))}>
              <option value="auto">自动收件人（任务责任人/评审负责人/项目成员）</option>
              <option value="manual">手动指定收件人</option>
            </select>
            <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="手动收件人（多个用逗号）" value={ruleForm.manual_recipients} onChange={(e) => setRuleForm((f) => ({ ...f, manual_recipients: e.target.value }))} />
            <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={ruleForm.channel} onChange={(e) => setRuleForm((f) => ({ ...f, channel: e.target.value }))}>
              <option value="email">email</option>
              <option value="wecom">wecom</option>
              <option value="dingtalk">dingtalk</option>
            </select>
            <div className="flex gap-2">
              <button className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
                {editingRuleId ? '保存规则' : '新增规则'}
              </button>
              {editingRuleId ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditingRuleId(null);
                    setRuleForm({
                      event_type: 'task_overdue',
                      template_code: 'overdue_warning',
                      offset_days: 1,
                      recipient_mode: 'auto',
                      manual_recipients: '',
                      channel: 'email',
                    });
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                >
                  取消编辑
                </button>
              ) : null}
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <select
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
              value={ruleFilters.eventType}
              onChange={(e) => setRuleFilters((f) => ({ ...f, eventType: e.target.value }))}
            >
              <option value="">全部事件</option>
              {EVENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
              value={ruleFilters.enabled}
              onChange={(e) => setRuleFilters((f) => ({ ...f, enabled: e.target.value }))}
            >
              <option value="">全部状态</option>
              <option value="1">启用</option>
              <option value="0">停用</option>
            </select>
          </div>
          <div className="mt-3 max-h-44 overflow-auto rounded border border-slate-200 p-2 text-xs text-slate-700">
            {rules.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 border-b border-slate-100 py-1 last:border-0">
                <div>
                  {r.event_type} · {r.template_name || r.template_code} · {r.offset_days}天 ·{' '}
                  {r.enabled ? '启用' : '停用'} · {r.channel}
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => startEditRule(r)}
                    className="rounded border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleRuleEnabled(r)}
                    className="rounded border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700"
                  >
                    {r.enabled ? '停用' : '启用'}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteRule(r.id)}
                    className="rounded border border-red-200 px-2 py-0.5 text-[11px] font-semibold text-red-700"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
            <button
              type="button"
              disabled={rulePage.page <= 1}
            onClick={() => {
              const p = rulePage.page - 1;
              setRulePage((x) => ({ ...x, page: p }));
              loadRules(p);
            }}
              className="rounded border border-slate-200 px-2 py-1 disabled:opacity-50"
            >
              上一页
            </button>
            <span>
              第 {rulePage.page}/{rulePage.totalPages} 页（共 {rulePage.total} 条）
            </span>
            <button
              type="button"
              disabled={rulePage.page >= rulePage.totalPages}
            onClick={() => {
              const p = rulePage.page + 1;
              setRulePage((x) => ({ ...x, page: p }));
              loadRules(p);
            }}
              className="rounded border border-slate-200 px-2 py-1 disabled:opacity-50"
            >
              下一页
            </button>
          </div>
        </form>
      </div>

      <form onSubmit={sendManual} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">手动发送测试</h2>
        <div className="mt-3 grid gap-2">
          <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={manualForm.template_code} onChange={(e) => setManualForm((f) => ({ ...f, template_code: e.target.value }))}>
            {templates.map((t) => <option key={t.id} value={t.code}>{t.name}({t.code})</option>)}
          </select>
          <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="收件人邮箱（多个逗号分隔）" value={manualForm.recipients} onChange={(e) => setManualForm((f) => ({ ...f, recipients: e.target.value }))} />
          <textarea className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono" rows={4} placeholder='变量 JSON，例如 {"project_name":"X"}' value={manualForm.variables_json} onChange={(e) => setManualForm((f) => ({ ...f, variables_json: e.target.value }))} />
          <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">发送测试邮件</button>
        </div>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">发送历史记录</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <select
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
            value={historyFilters.eventType}
            onChange={(e) => setHistoryFilters((f) => ({ ...f, eventType: e.target.value }))}
          >
            <option value="">全部事件</option>
            {EVENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
            value={historyFilters.status}
            onChange={(e) => setHistoryFilters((f) => ({ ...f, status: e.target.value }))}
          >
            <option value="">全部状态</option>
            <option value="pending">pending</option>
            <option value="sent">sent</option>
            <option value="failed">failed</option>
          </select>
        </div>
        <div className="mt-3 max-h-80 overflow-auto rounded border border-slate-200 text-xs">
          <table className="min-w-full">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2 py-2 text-left">时间</th>
                <th className="px-2 py-2 text-left">状态</th>
                <th className="px-2 py-2 text-left">模板</th>
                <th className="px-2 py-2 text-left">事件</th>
                <th className="px-2 py-2 text-left">收件人</th>
                <th className="px-2 py-2 text-left">回复跟踪</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-t border-slate-100">
                  <td className="px-2 py-2">{h.created_at}</td>
                  <td className="px-2 py-2">{h.status}</td>
                  <td className="px-2 py-2">{h.template_code}</td>
                  <td className="px-2 py-2">{h.event_type || 'manual'}</td>
                  <td className="px-2 py-2">{h.to_recipients}</td>
                  <td className="px-2 py-2">{h.reply_status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
          <button
            type="button"
            disabled={historyPage.page <= 1}
          onClick={() => {
            const p = historyPage.page - 1;
            setHistoryPage((x) => ({ ...x, page: p }));
            loadHistory(p);
          }}
            className="rounded border border-slate-200 px-2 py-1 disabled:opacity-50"
          >
            上一页
          </button>
          <span>
            第 {historyPage.page}/{historyPage.totalPages} 页（共 {historyPage.total} 条）
          </span>
          <button
            type="button"
            disabled={historyPage.page >= historyPage.totalPages}
          onClick={() => {
            const p = historyPage.page + 1;
            setHistoryPage((x) => ({ ...x, page: p }));
            loadHistory(p);
          }}
            className="rounded border border-slate-200 px-2 py-1 disabled:opacity-50"
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  );
}
