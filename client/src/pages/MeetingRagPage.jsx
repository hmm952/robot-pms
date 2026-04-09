import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../api/client.js';
import { useProject } from '../context/ProjectContext.jsx';

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildHitKeywords(question, hits) {
  const set = new Set();
  const fromQ = String(question || '')
    .split(/[\s,，。！？;；:：()（）"'`]+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2);
  for (const x of fromQ) set.add(x);
  for (const h of hits || []) {
    const t = String(h?.title || '').trim();
    if (t.length >= 2) set.add(t);
  }
  return [...set].sort((a, b) => b.length - a.length).slice(0, 20);
}

function highlightText(text, keywords) {
  const raw = String(text || '');
  const kws = (keywords || []).filter(Boolean);
  if (!kws.length) return [raw];
  const pattern = kws.map((k) => escapeRegExp(k)).join('|');
  if (!pattern) return [raw];
  const reg = new RegExp(`(${pattern})`, 'gi');
  const parts = raw.split(reg);
  return parts.map((p, i) =>
    kws.some((k) => p.toLowerCase() === k.toLowerCase()) ? (
      <mark key={i} className="rounded bg-yellow-200 px-0.5">
        {p}
      </mark>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

function IconBranch() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="5" cy="5" r="2.2" />
      <circle cx="15" cy="15" r="2.2" />
      <circle cx="15" cy="5" r="2.2" />
      <path d="M7.2 5h4.6M5 7.2v3.8c0 2.2 1.8 4 4 4h3.8" />
    </svg>
  );
}
function IconRisk() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M10 3l7 12H3L10 3z" />
      <path d="M10 7v4m0 2.8h.01" />
    </svg>
  );
}
function IconDecision() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 10h12M10 4v12" />
      <circle cx="10" cy="10" r="6.5" />
    </svg>
  );
}
function IconTodo() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3.5" y="4" width="13" height="12" rx="2" />
      <path d="M6.5 10l2 2 5-5" />
    </svg>
  );
}

function EmptyResult() {
  return (
    <div className="flex h-full min-h-[520px] items-center justify-center rounded-xl border border-slate-200 bg-white">
      <div className="text-center">
        <div className="text-2xl font-semibold text-slate-700">选择会议纪要查看解析结果</div>
        <div className="mt-2 text-sm text-slate-500">从左侧列表选择一个会议纪要，或上传新的会议纪要</div>
      </div>
    </div>
  );
}

function typeMeta(type) {
  if (type === 'changes') {
    return {
      tag: '变更',
      icon: <IconBranch />,
      chip: 'bg-amber-50 text-amber-700',
      btn: '同步变更任务',
      card: 'border-amber-100',
    };
  }
  if (type === 'risks') {
    return {
      tag: '风险',
      icon: <IconRisk />,
      chip: 'bg-red-50 text-red-700',
      btn: '同步风险任务',
      card: 'border-red-100',
    };
  }
  if (type === 'decisions') {
    return {
      tag: '决策',
      icon: <IconDecision />,
      chip: 'bg-emerald-50 text-emerald-700',
      btn: '同步决策任务',
      card: 'border-emerald-100',
    };
  }
  return {
    tag: '待办',
    icon: <IconTodo />,
    chip: 'bg-blue-50 text-blue-700',
    btn: '同步待办任务',
    card: 'border-blue-100',
  };
}

function ItemCard({ type, item, onSync, index, syncing, pulse }) {
  const m = typeMeta(type);
  const synced = Boolean(item?.synced_to_task);
  const summary =
    type === 'changes'
      ? item?.content
      : type === 'risks'
        ? item?.description
        : item?.content;
  const sub = type === 'changes'
    ? `影响范围: ${item?.impact_scope || '未填写'}`
    : type === 'risks'
      ? `影响程度: ${item?.impact_level || 'medium'}`
      : `负责人: ${item?.assignee_name || item?.follow_up || '未指定'}`;
  const level = String(item?.impact_level || '').toLowerCase();
  const levelText = level ? (level === 'high' ? '高' : level === 'low' ? '低' : '中') : null;
  const levelCls =
    level === 'high'
      ? 'bg-red-50 text-red-700'
      : level === 'low'
        ? 'bg-slate-100 text-slate-700'
        : 'bg-amber-50 text-amber-700';
  return (
    <div
      className={[
        'rounded-xl border bg-white p-4 transition-all duration-300',
        m.card,
        pulse ? 'ring-2 ring-emerald-200 shadow-sm' : '',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-600">{m.icon}</span>
            <span className={`rounded px-2 py-0.5 text-xs font-semibold ${m.chip}`}>{m.tag}</span>
            {synced ? <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">已同步</span> : null}
            {levelText ? (
              <span className={`rounded px-2 py-0.5 text-xs font-semibold ${levelCls}`}>{levelText}</span>
            ) : null}
          </div>
          <div className="mt-2 text-base font-semibold text-slate-900">{summary || '（空）'}</div>
          <div className="mt-1 text-xs text-slate-500">{sub}</div>
          {type === 'todos' ? (
            <div className="mt-1 text-xs text-slate-500">截止: {item?.due_date || '未设置'}</div>
          ) : null}
        </div>
        <button
          type="button"
          disabled={syncing || synced}
          onClick={() => onSync(type, index)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {synced ? '已同步' : m.btn}
        </button>
      </div>
    </div>
  );
}

export default function MeetingRagPage() {
  const { projectId } = useProject();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(() => {
    const v = searchParams.get('tab');
    return v === 'history' ? 'history' : 'upload';
  });
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState(() => {
    const v = searchParams.get('filter');
    return ['all', 'changes', 'decisions', 'risks', 'todos'].includes(String(v))
      ? String(v)
      : 'all';
  });
  const [showUnsyncedOnly, setShowUnsyncedOnly] = useState(
    () => searchParams.get('unsynced') === '1',
  );
  const [lastSyncedKey, setLastSyncedKey] = useState('');

  const [list, setList] = useState([]);
  const [selectedId, setSelectedId] = useState(() => {
    const v = Number(searchParams.get('mid'));
    return Number.isFinite(v) && v > 0 ? v : null;
  });
  const [selected, setSelected] = useState(null);
  const [historyKeyword, setHistoryKeyword] = useState(() => searchParams.get('hk') || '');
  const [historyStatus, setHistoryStatus] = useState(() => {
    const v = searchParams.get('hs');
    return ['all', 'parsed', 'confirmed', 'synced'].includes(String(v)) ? String(v) : 'all';
  });
  const [historyPage, setHistoryPage] = useState(() => {
    const v = Number(searchParams.get('page'));
    return Number.isFinite(v) && v >= 1 ? v : 1;
  });
  const [historyPageSize, setHistoryPageSize] = useState(() => {
    const v = Number(searchParams.get('ps'));
    return [6, 8, 12, 20].includes(v) ? v : 8;
  });

  const [qaQuestion, setQaQuestion] = useState('');
  const [qaAnswer, setQaAnswer] = useState('');
  const [qaHits, setQaHits] = useState([]);
  const [batchLimit, setBatchLimit] = useState(() => {
    const v = Number(searchParams.get('bn'));
    return Number.isFinite(v) && v > 0 ? v : 20;
  });
  const [rawExpanded, setRawExpanded] = useState(() => searchParams.get('raw') === '1');
  const [rawHighlightOn, setRawHighlightOn] = useState(
    () => searchParams.get('hl') !== '0',
  );

  const parsed = useMemo(() => selected?.parsed || { todos: [], changes: [], risks: [], decisions: [] }, [selected]);

  async function loadList() {
    if (!projectId) return;
    try {
      const { data } = await api.get('/api/meetings', { params: { projectId } });
      setList(data || []);
      if (!selectedId && data?.[0]?.id) setSelectedId(data[0].id);
    } catch (e) {
      setMsg(e.message || '加载历史失败');
    }
  }

  async function loadOne(id) {
    if (!id) return;
    try {
      const { data } = await api.get(`/api/meetings/${id}`);
      setSelected(data);
    } catch (e) {
      setMsg(e.message || '加载详情失败');
    }
  }

  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  useEffect(() => {
    if (selectedId) loadOne(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // URL 参数记忆：分页/筛选/视图刷新不丢失
  useEffect(() => {
    const q = new URLSearchParams();
    if (tab !== 'upload') q.set('tab', tab);
    if (filter !== 'all') q.set('filter', filter);
    if (showUnsyncedOnly) q.set('unsynced', '1');
    if (selectedId) q.set('mid', String(selectedId));
    if (historyKeyword) q.set('hk', historyKeyword);
    if (historyStatus !== 'all') q.set('hs', historyStatus);
    if (historyPage !== 1) q.set('page', String(historyPage));
    if (historyPageSize !== 8) q.set('ps', String(historyPageSize));
    if (batchLimit !== 20) q.set('bn', String(batchLimit));
    if (rawExpanded) q.set('raw', '1');
    if (!rawHighlightOn) q.set('hl', '0');
    setSearchParams(q, { replace: true });
  }, [
    tab,
    filter,
    showUnsyncedOnly,
    selectedId,
    historyKeyword,
    historyStatus,
    historyPage,
    historyPageSize,
    batchLimit,
    rawExpanded,
    rawHighlightOn,
    setSearchParams,
  ]);

  async function onParse() {
    if (!projectId) return;
    if (!title.trim()) return setMsg('请填写会议标题');
    if (!text.trim() && !file) return setMsg('请上传文件或粘贴会议内容');
    setBusy(true);
    setMsg('');
    try {
      const fd = new FormData();
      fd.append('project_id', String(projectId));
      fd.append('title', title);
      if (text.trim()) fd.append('text', text);
      if (file) fd.append('file', file);
      const { data } = await api.post('/api/meetings/parse', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setMsg(data.message || '解析完成');
      setTitle('');
      setText('');
      setFile(null);
      await loadList();
      if (data.id) setSelectedId(data.id);
      setTab('history');
    } catch (e) {
      setMsg(e.message || '解析失败');
    } finally {
      setBusy(false);
    }
  }

  async function saveParsed() {
    if (!selected?.id) return;
    setBusy(true);
    setMsg('');
    try {
      await api.put(`/api/meetings/${selected.id}/parsed`, { parsed });
      setMsg('解析结果已保存');
      await loadOne(selected.id);
    } catch (e) {
      setMsg(e.message || '保存失败');
    } finally {
      setBusy(false);
    }
  }

  async function archiveToKb() {
    if (!selected?.id) return;
    setBusy(true);
    setMsg('');
    try {
      const { data } = await api.post(`/api/meetings/${selected.id}/archive`);
      setMsg(data.message || '已归档');
    } catch (e) {
      setMsg(e.message || '归档失败');
    } finally {
      setBusy(false);
    }
  }

  async function syncAll() {
    if (!selected?.id) return;
    setBusy(true);
    setMsg('');
    try {
      const { data } = await api.post(`/api/meetings/${selected.id}/sync`);
      setMsg(`同步完成：任务 ${data.created_count.tasks}，评审 ${data.created_count.reviews}，风险 ${data.created_count.risks}`);
      await loadOne(selected.id);
    } catch (e) {
      setMsg(e.message || '同步失败');
    } finally {
      setBusy(false);
    }
  }

  async function syncItem(category, index) {
    if (!selected?.id) return;
    setBusy(true);
    setMsg('');
    try {
      const { data } = await api.post(`/api/meetings/${selected.id}/sync-item`, { category, index });
      setMsg(data.message || '已同步');
      setLastSyncedKey(`${category}-${index}-${Date.now()}`);
      await loadOne(selected.id);
    } catch (e) {
      setMsg(e.message || '同步失败');
    } finally {
      setBusy(false);
    }
  }

  async function syncCurrentCategoryBatch() {
    if (!selected?.id) return;
    const targetsAll = visibleCards.filter((x) => !x.item?.synced_to_task);
    const n = Math.max(1, Number(batchLimit || 1));
    const targets = targetsAll.slice(0, n);
    if (targets.length === 0) {
      setMsg('当前筛选下没有可同步条目');
      return;
    }
    const ok = window.confirm(
      `确认批量同步吗？\n当前筛选下可同步 ${targetsAll.length} 条，本次将同步前 ${targets.length} 条。`,
    );
    if (!ok) return;
    setBusy(true);
    setMsg('');
    let okCnt = 0;
    let fail = 0;
    for (const x of targets) {
      try {
        await api.post(`/api/meetings/${selected.id}/sync-item`, {
          category: x.type,
          index: x.index,
        });
        okCnt += 1;
      } catch {
        fail += 1;
      }
    }
    await loadOne(selected.id);
    setBusy(false);
    setMsg(`批量同步完成：成功 ${okCnt} 条${fail ? `，失败 ${fail} 条` : ''}`);
  }

  async function copyRawText() {
    try {
      await navigator.clipboard.writeText(String(selected?.raw_text || ''));
      setMsg('原文已复制到剪贴板');
    } catch {
      setMsg('复制失败，请检查浏览器权限');
    }
  }

  function downloadRawText() {
    const text = String(selected?.raw_text || '');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const titleSafe = String(selected?.title || 'meeting').replace(/[\\/:*?"<>|]/g, '_');
    a.download = `${titleSafe || 'meeting'}-raw.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function askQa() {
    if (!projectId || !qaQuestion.trim()) return;
    setBusy(true);
    setMsg('');
    try {
      const { data } = await api.post('/api/meetings/qa', { project_id: projectId, question: qaQuestion.trim() });
      setQaAnswer(data.answer || '无结果');
      setQaHits(data.hits || []);
    } catch (e) {
      setMsg(e.message || '问答失败');
    } finally {
      setBusy(false);
    }
  }

  const visibleCards = useMemo(() => {
    const sortWithin = (type, arr) => {
      const rows = [...(arr || [])];
      rows.sort((a, b) => {
        // 每类默认排序：未同步优先
        const sa = a?.synced_to_task ? 1 : 0;
        const sb = b?.synced_to_task ? 1 : 0;
        if (sa !== sb) return sa - sb;
        if (type === 'risks') {
          const score = (x) => (String(x?.impact_level || '').toLowerCase() === 'high' ? 3 : String(x?.impact_level || '').toLowerCase() === 'medium' ? 2 : 1);
          return score(b) - score(a); // 高风险优先
        }
        if (type === 'todos') {
          const da = a?.due_date || '9999-12-31';
          const db = b?.due_date || '9999-12-31';
          return String(da).localeCompare(String(db)); // 截止近的优先
        }
        return String(a?.content || a?.description || '').localeCompare(String(b?.content || b?.description || ''));
      });
      return rows;
    };
    const out = [];
    if (!parsed) return out;
    // 分类默认顺序：变更 -> 决策 -> 风险 -> 待办（贴近目标图阅读路径）
    if (filter === 'all' || filter === 'changes') {
      sortWithin('changes', parsed.changes).forEach((x) => {
        const i = (parsed.changes || []).indexOf(x);
        out.push({ type: 'changes', item: x, index: i });
      });
    }
    if (filter === 'all' || filter === 'decisions') {
      sortWithin('decisions', parsed.decisions).forEach((x) => {
        const i = (parsed.decisions || []).indexOf(x);
        out.push({ type: 'decisions', item: x, index: i });
      });
    }
    if (filter === 'all' || filter === 'risks') {
      sortWithin('risks', parsed.risks).forEach((x) => {
        const i = (parsed.risks || []).indexOf(x);
        out.push({ type: 'risks', item: x, index: i });
      });
    }
    if (filter === 'all' || filter === 'todos') {
      sortWithin('todos', parsed.todos).forEach((x) => {
        const i = (parsed.todos || []).indexOf(x);
        out.push({ type: 'todos', item: x, index: i });
      });
    }
    return showUnsyncedOnly ? out.filter((x) => !x.item?.synced_to_task) : out;
  }, [parsed, filter, showUnsyncedOnly]);

  const filteredHistory = useMemo(() => {
    let rows = [...(list || [])];
    if (historyStatus !== 'all') {
      rows = rows.filter((x) => String(x.status) === historyStatus);
    }
    if (historyKeyword.trim()) {
      const kw = historyKeyword.trim().toLowerCase();
      rows = rows.filter((x) => String(x.title || '').toLowerCase().includes(kw));
    }
    return rows;
  }, [list, historyKeyword, historyStatus]);

  const historyTotalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredHistory.length / Number(historyPageSize || 1))),
    [filteredHistory.length, historyPageSize],
  );

  const pagedHistory = useMemo(() => {
    const p = Math.min(historyPage, historyTotalPages);
    const size = Number(historyPageSize || 8);
    const start = (p - 1) * size;
    return filteredHistory.slice(start, start + size);
  }, [filteredHistory, historyPage, historyTotalPages, historyPageSize]);

  useEffect(() => {
    setHistoryPage(1);
  }, [historyKeyword, historyStatus, historyPageSize]);

  const hitKeywords = useMemo(() => buildHitKeywords(qaQuestion, qaHits), [qaQuestion, qaHits]);
  const rawSource = String(selected?.raw_text || '');
  const rawShownText = rawExpanded ? rawSource : rawSource.slice(0, 1500);
  const rawHighlighted = useMemo(
    () => (rawHighlightOn ? highlightText(rawShownText, hitKeywords) : [rawShownText]),
    [rawHighlightOn, rawShownText, hitKeywords],
  );

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold text-slate-900">会议纪要深度解析</h1>
          <p className="mt-1 text-sm text-slate-600">基于RAG的智能解析与项目联动</p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <button type="button" className="text-slate-700 hover:underline" onClick={() => document.getElementById('qa-input')?.focus()}>
            知识库问答
          </button>
          <Link to="/settings/rag" className="text-slate-700 hover:underline">API配置</Link>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setTab('upload')} className={['rounded-lg px-4 py-2 text-sm font-semibold', tab === 'upload' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'].join(' ')}>上传会议纪要</button>
        <button type="button" onClick={() => setTab('history')} className={['rounded-lg px-4 py-2 text-sm font-semibold', tab === 'history' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'].join(' ')}>历史记录</button>
      </div>

      {msg ? <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{msg}</div> : null}

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-2xl font-semibold text-slate-900">{tab === 'upload' ? '上传会议纪要' : '历史记录'}</h2>
          <p className="mt-1 text-sm text-slate-500">{tab === 'upload' ? '支持上传文件或直接粘贴文本' : '点击查看解析结果'}</p>

          {tab === 'upload' ? (
            <div className="mt-4 space-y-3">
              <label className="block">
                <div className="text-xs text-slate-500">会议标题</div>
                <input className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="请输入会议标题" value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label className="block">
                <div className="text-xs text-slate-500">会议内容</div>
                <textarea className="mt-1 h-36 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="请粘贴会议纪要内容" value={text} onChange={(e) => setText(e.target.value)} />
              </label>
              <label className="block">
                <div className="text-xs text-slate-500">文件上传</div>
                <div className="mt-1 rounded-lg border border-dashed border-slate-300 p-3">
                  <input type="file" accept=".docx,.pdf,.txt" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                  <div className="mt-1 text-xs text-slate-500">{file ? `已选择：${file.name}` : '支持 .docx / .pdf / .txt'}</div>
                </div>
              </label>
              <button type="button" onClick={onParse} disabled={busy} className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">{busy ? '解析中…' : '创建并解析'}</button>
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                <input
                  className="w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                  placeholder="关键词搜索会议标题"
                  value={historyKeyword}
                  onChange={(e) => setHistoryKeyword(e.target.value)}
                />
                <select
                  className="w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                  value={historyStatus}
                  onChange={(e) => setHistoryStatus(e.target.value)}
                >
                  <option value="all">全部状态</option>
                  <option value="parsed">已解析</option>
                  <option value="confirmed">已确认</option>
                  <option value="synced">已同步</option>
                </select>
                <select
                  className="w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                  value={historyPageSize}
                  onChange={(e) => setHistoryPageSize(Number(e.target.value))}
                >
                  <option value={6}>每页 6 条</option>
                  <option value={8}>每页 8 条</option>
                  <option value={12}>每页 12 条</option>
                  <option value={20}>每页 20 条</option>
                </select>
              </div>
              {filteredHistory.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">暂无历史会议纪要</div>
              ) : (
                pagedHistory.map((m) => (
                  <button type="button" key={m.id} onClick={() => setSelectedId(m.id)} className={['w-full rounded-lg border px-3 py-2 text-left', selectedId === m.id ? 'border-slate-900 bg-slate-50' : 'border-slate-200 bg-white hover:bg-slate-50'].join(' ')}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium text-slate-900 truncate">{m.title}</div>
                      <span
                        className={[
                          'rounded px-2 py-0.5 text-xs font-semibold',
                          m.status === 'synced'
                            ? 'bg-emerald-50 text-emerald-700'
                            : m.status === 'parsed'
                              ? 'bg-blue-50 text-blue-700'
                              : 'bg-amber-50 text-amber-700',
                        ].join(' ')}
                      >
                        {m.status === 'synced' ? '已同步' : m.status === 'parsed' ? '已解析' : '已确认'}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{m.created_at}</div>
                  </button>
                ))
              )}
              {filteredHistory.length > 0 ? (
                <div className="flex items-center justify-between rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600">
                  <span>
                    第 {Math.min(historyPage, historyTotalPages)} / {historyTotalPages} 页（共 {filteredHistory.length} 条）
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={historyPage <= 1}
                      onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                      className="rounded border border-slate-200 bg-white px-2 py-0.5 disabled:opacity-60"
                    >
                      上一页
                    </button>
                    <button
                      type="button"
                      disabled={historyPage >= historyTotalPages}
                      onClick={() => setHistoryPage((p) => Math.min(historyTotalPages, p + 1))}
                      className="rounded border border-slate-200 bg-white px-2 py-0.5 disabled:opacity-60"
                    >
                      下一页
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="space-y-4">
          {!selected ? (
            <EmptyResult />
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-semibold text-slate-900">{selected.title}</h2>
                  <div className="text-xs text-slate-500">项目 ID: {selected.project_id} · 状态：{selected.status}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={archiveToKb} disabled={busy} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">归档</button>
                  <button type="button" onClick={saveParsed} disabled={busy} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">保存调整</button>
                  <button type="button" onClick={syncAll} disabled={busy} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">全部同步</button>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between gap-2">
                <div className="text-lg font-semibold text-slate-900">解析结果</div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={syncCurrentCategoryBatch}
                    disabled={busy || visibleCards.filter((x) => !x.item?.synced_to_task).length === 0}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    批量同步当前分类
                  </button>
                  <input
                    type="number"
                    min={1}
                    className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
                    value={batchLimit}
                    onChange={(e) => setBatchLimit(Number(e.target.value || 1))}
                    title="仅同步前 N 条"
                  />
                  <span className="text-xs text-slate-500">仅前N条</span>
                  <button
                    type="button"
                    onClick={() => setShowUnsyncedOnly((v) => !v)}
                    className={[
                      'rounded-lg border px-2.5 py-1 text-xs font-semibold',
                      showUnsyncedOnly
                        ? 'border-blue-200 bg-blue-50 text-blue-700'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                    ].join(' ')}
                  >
                    仅看未同步
                  </button>
                  <select className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm" value={filter} onChange={(e) => setFilter(e.target.value)}>
                    <option value="all">全部</option>
                    <option value="changes">变更</option>
                    <option value="decisions">决策</option>
                    <option value="risks">风险</option>
                    <option value="todos">待办</option>
                  </select>
                </div>
              </div>

              <div className="mt-3 space-y-3">
                {visibleCards.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">当前分类暂无内容</div>
                ) : (
                  visibleCards.map((x, idx) => (
                    <ItemCard
                      key={`${x.type}-${idx}`}
                      type={x.type}
                      item={x.item}
                      index={x.index}
                      onSync={syncItem}
                      syncing={busy}
                      pulse={lastSyncedKey.startsWith(`${x.type}-${x.index}-`)}
                    />
                  ))
                )}
              </div>

              <details className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <summary className="cursor-pointer text-sm font-semibold text-slate-800">查看原始会议内容</summary>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={copyRawText}
                    className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    复制原文
                  </button>
                  <button
                    type="button"
                    onClick={downloadRawText}
                    className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    下载文本
                  </button>
                  <button
                    type="button"
                    onClick={() => setRawHighlightOn((v) => !v)}
                    className={[
                      'rounded border px-2 py-1 text-xs font-semibold',
                      rawHighlightOn
                        ? 'border-yellow-200 bg-yellow-50 text-yellow-800'
                        : 'border-slate-200 bg-white text-slate-700',
                    ].join(' ')}
                  >
                    {rawHighlightOn ? '关闭高亮' : '展开高亮命中词'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRawExpanded((v) => !v)}
                    className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    {rawExpanded ? '收起原文' : '展开原文'}
                  </button>
                </div>
                {rawHighlightOn && hitKeywords.length > 0 ? (
                  <div className="mt-2 text-[11px] text-slate-500">
                    命中词：{hitKeywords.join('、')}
                  </div>
                ) : null}
                <div className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap text-xs text-slate-700">
                  {rawHighlighted}
                  {!rawExpanded && rawSource.length > rawShownText.length ? (
                    <span className="text-slate-400"> ...（已截断）</span>
                  ) : null}
                </div>
              </details>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <input id="qa-input" className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="有问题？问一下知识库…" value={qaQuestion} onChange={(e) => setQaQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); askQa(); } }} />
          <button type="button" onClick={askQa} disabled={busy} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">提问</button>
        </div>
        {qaAnswer ? (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="whitespace-pre-wrap text-sm text-slate-800">{qaAnswer}</div>
            {qaHits?.length ? <div className="mt-2 text-xs text-slate-500">命中来源：{qaHits.map((h) => h.title).join('；')}</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

