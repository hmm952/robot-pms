import { useEffect, useState } from 'react';
import api from '../api/client.js';

export default function RagConfigPage() {
  const [form, setForm] = useState({
    baseUrl: '',
    apiKey: '',
    appId: '',
    timeoutMs: 30000,
  });
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      setMsg('');
      const { data } = await api.get('/api/integrations/rag/config');
      setForm((f) => ({
        ...f,
        baseUrl: data?.source?.db?.baseUrl || '',
        apiKey: '',
        appId: data?.source?.db?.appId || '',
        timeoutMs: data?.source?.db?.timeoutMs || 30000,
      }));
    } catch (e) {
      setMsg(e.message || '加载配置失败');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onSave(e) {
    e.preventDefault();
    try {
      setSaving(true);
      setMsg('');
      await api.put('/api/integrations/rag/config', {
        baseUrl: form.baseUrl,
        apiKey: form.apiKey || undefined,
        appId: form.appId,
        timeoutMs: Number(form.timeoutMs),
      });
      setMsg('保存成功：已更新讯飞 RAG 配置');
      setForm((f) => ({ ...f, apiKey: '' }));
    } catch (e) {
      setMsg(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-slate-900">讯飞 RAG API 配置</h1>
        <p className="mt-1 text-sm text-slate-600">
          小白可直接填写：接口地址、API Key、AppId。保存后立即用于会议纪要解析与知识库问答。
        </p>
      </div>

      <form onSubmit={onSave} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4">
          <label className="text-sm">
            <div className="text-xs font-medium text-slate-500">RAG 接口地址（Base URL）</div>
            <input
              required
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder="https://xxxx/api/rag/query"
              value={form.baseUrl}
              onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
            />
          </label>

          <label className="text-sm">
            <div className="text-xs font-medium text-slate-500">API Key（不回显旧值）</div>
            <input
              type="password"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder="如不修改可留空"
              value={form.apiKey}
              onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
            />
          </label>

          <label className="text-sm">
            <div className="text-xs font-medium text-slate-500">AppId（可选）</div>
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={form.appId}
              onChange={(e) => setForm((f) => ({ ...f, appId: e.target.value }))}
            />
          </label>

          <label className="text-sm">
            <div className="text-xs font-medium text-slate-500">超时毫秒（1000~120000）</div>
            <input
              type="number"
              min={1000}
              max={120000}
              className="mt-1 w-56 rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={form.timeoutMs}
              onChange={(e) => setForm((f) => ({ ...f, timeoutMs: e.target.value }))}
            />
          </label>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {saving ? '保存中…' : '保存配置'}
          </button>
          <button
            type="button"
            onClick={load}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            重新加载
          </button>
          {msg && <span className="text-sm text-slate-600">{msg}</span>}
        </div>
      </form>
    </div>
  );
}

