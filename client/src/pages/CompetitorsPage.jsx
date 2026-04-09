import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api/client.js';
import { useProject } from '../context/ProjectContext.jsx';

const threatLabel = { low: '低', medium: '中', high: '高' };
const levelCls = {
  advantage: 'bg-emerald-50 text-emerald-700',
  disadvantage: 'bg-red-50 text-red-700',
  neutral: 'bg-slate-100 text-slate-700',
};

// URL 短码字典（筛选/分页/爬虫草稿）：
// cid: competitorId, src: sourceType, sd: startDate, ed: endDate
// sp/sps: snapshots page/pageSize, lp/lps: logs page/pageSize
// cfh/cen: crawl frequency_hours/enabled
// cws/cmd/cpt: crawl websites/media/patents 列表（换行分隔）
// iws/imd/ipt: 来源输入框临时草稿
const QK = {
  cid: 'cid',
  src: 'src',
  sd: 'sd',
  ed: 'ed',
  sp: 'sp',
  sps: 'sps',
  lp: 'lp',
  lps: 'lps',
  cfh: 'cfh',
  cen: 'cen',
  cws: 'cws',
  cmd: 'cmd',
  cpt: 'cpt',
  iws: 'iws',
  imd: 'imd',
  ipt: 'ipt',
};

export default function CompetitorsPage() {
  const { projectId } = useProject();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [msg, setMsg] = useState('');
  const [compare, setCompare] = useState({ own: {}, rows: [] });
  const [report, setReport] = useState({ analysis: [] });
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotPage, setSnapshotPage] = useState(() => ({
    page: Math.max(1, Number(searchParams.get(QK.sp) || 1)),
    pageSize: Math.max(1, Number(searchParams.get(QK.sps) || 10)),
    totalPages: 1,
    total: 0,
  }));
  const [logs, setLogs] = useState([]);
  const [logPage, setLogPage] = useState(() => ({
    page: Math.max(1, Number(searchParams.get(QK.lp) || 1)),
    pageSize: Math.max(1, Number(searchParams.get(QK.lps) || 8)),
    totalPages: 1,
    total: 0,
  }));
  const [qaQuestion, setQaQuestion] = useState('');
  const [qaAnswer, setQaAnswer] = useState('');
  const [copied, setCopied] = useState(false);
  const [filters, setFilters] = useState(() => ({
    competitorId: searchParams.get(QK.cid) || '',
    sourceType: searchParams.get(QK.src) || '',
    startDate: searchParams.get(QK.sd) || '',
    endDate: searchParams.get(QK.ed) || '',
  }));
  const [crawlCfg, setCrawlCfg] = useState({
    frequency_hours: Number(searchParams.get(QK.cfh) || 24),
    source_websites: (searchParams.get(QK.cws) || '').split('\n').map((x) => x.trim()).filter(Boolean),
    source_media: (searchParams.get(QK.cmd) || '').split('\n').map((x) => x.trim()).filter(Boolean),
    source_patents: (searchParams.get(QK.cpt) || '').split('\n').map((x) => x.trim()).filter(Boolean),
    enabled: searchParams.get(QK.cen) === '0' ? false : true,
  });
  const [sourceInput, setSourceInput] = useState({
    websites: searchParams.get(QK.iws) || '',
    media: searchParams.get(QK.imd) || '',
    patents: searchParams.get(QK.ipt) || '',
  });
  const [ownSpec, setOwnSpec] = useState({
    product_name: '',
    payload_kg: '',
    repeatability_mm: '',
    ip_rating: '',
    battery_life_h: '',
    price_cny: '',
    notes: '',
  });
  const [form, setForm] = useState({
    name: '',
    website: '',
    core_product_info: '',
    model_or_line: '',
    price_position: '',
    threat_level: 'medium',
    key_features: '',
    gap_analysis: '',
  });

  const topSuggestions = useMemo(
    () =>
      snapshots
        .flatMap((s) =>
          (s.extracted?.iteration_suggestions || []).map((x) => ({ ...x, from: s.competitor_name })),
        )
        .slice(0, 8),
    [snapshots],
  );

  async function loadBase() {
    if (!projectId) return;
    const [a, b, c, e] = await Promise.all([
      api.get('/api/competitors', { params: { projectId } }),
      api.get('/api/competitors/compare', { params: { projectId } }),
      api.get('/api/competitors/report', { params: { projectId } }),
      api.get('/api/competitors/crawl/config', { params: { projectId } }),
    ]);
    setItems(a.data || []);
    setCompare(b.data || { own: {}, rows: [] });
    setReport(c.data || { analysis: [] });
    const cfg = e.data || {};
    setCrawlCfg({
      frequency_hours: Number(cfg.frequency_hours || 24),
      source_websites: JSON.parse(cfg.source_websites_json || '[]'),
      source_media: JSON.parse(cfg.source_media_json || '[]'),
      source_patents: JSON.parse(cfg.source_patents_json || '[]'),
      enabled: Number(cfg.enabled || 1) === 1,
    });
    setOwnSpec({
      product_name: b.data?.own?.product_name || '',
      payload_kg: b.data?.own?.payload_kg ?? '',
      repeatability_mm: b.data?.own?.repeatability_mm ?? '',
      ip_rating: b.data?.own?.ip_rating || '',
      battery_life_h: b.data?.own?.battery_life_h ?? '',
      price_cny: b.data?.own?.price_cny ?? '',
      notes: b.data?.own?.notes || '',
    });
  }

  async function loadSnapshots(page = snapshotPage.page) {
    if (!projectId) return;
    const { data } = await api.get('/api/competitors/snapshots', {
      params: {
        projectId,
        competitorId: filters.competitorId || undefined,
        sourceType: filters.sourceType || undefined,
        startDate: filters.startDate || undefined,
        endDate: filters.endDate || undefined,
        page,
        pageSize: snapshotPage.pageSize,
      },
    });
    setSnapshots(data.items || []);
    setSnapshotPage((prev) => ({ ...prev, ...(data.pagination || {}), pageSize: prev.pageSize }));
  }

  async function loadLogs(page = logPage.page) {
    if (!projectId) return;
    const { data } = await api.get('/api/competitors/crawl/logs', {
      params: {
        projectId,
        startDate: filters.startDate || undefined,
        endDate: filters.endDate || undefined,
        page,
        pageSize: logPage.pageSize,
      },
    });
    setLogs(data.items || []);
    setLogPage((prev) => ({ ...prev, ...(data.pagination || {}), pageSize: prev.pageSize }));
  }

  useEffect(() => {
    loadBase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    loadSnapshots(1);
    loadLogs(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, filters.competitorId, filters.sourceType, filters.startDate, filters.endDate]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    const setOrDelete = (k, v, omit = '') => {
      if (v == null || String(v) === String(omit)) next.delete(k);
      else next.set(k, String(v));
    };
    setOrDelete(QK.cid, filters.competitorId, '');
    setOrDelete(QK.src, filters.sourceType, '');
    setOrDelete(QK.sd, filters.startDate, '');
    setOrDelete(QK.ed, filters.endDate, '');
    setOrDelete(QK.sp, snapshotPage.page, 1);
    setOrDelete(QK.sps, snapshotPage.pageSize, 10);
    setOrDelete(QK.lp, logPage.page, 1);
    setOrDelete(QK.lps, logPage.pageSize, 8);
    setOrDelete(QK.cfh, crawlCfg.frequency_hours, 24);
    setOrDelete(QK.cen, crawlCfg.enabled ? 1 : 0, 1);
    setOrDelete(QK.cws, (crawlCfg.source_websites || []).join('\n'), '');
    setOrDelete(QK.cmd, (crawlCfg.source_media || []).join('\n'), '');
    setOrDelete(QK.cpt, (crawlCfg.source_patents || []).join('\n'), '');
    setOrDelete(QK.iws, sourceInput.websites, '');
    setOrDelete(QK.imd, sourceInput.media, '');
    setOrDelete(QK.ipt, sourceInput.patents, '');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filters.competitorId,
    filters.sourceType,
    filters.startDate,
    filters.endDate,
    snapshotPage.page,
    snapshotPage.pageSize,
    logPage.page,
    logPage.pageSize,
    crawlCfg.frequency_hours,
    crawlCfg.enabled,
    (crawlCfg.source_websites || []).join('\n'),
    (crawlCfg.source_media || []).join('\n'),
    (crawlCfg.source_patents || []).join('\n'),
    sourceInput.websites,
    sourceInput.media,
    sourceInput.patents,
  ]);

  async function onSubmit(e) {
    e.preventDefault();
    if (!projectId) return;
    try {
      await api.post('/api/competitors', {
        project_id: projectId,
        name: form.name,
        website: form.website || null,
        core_product_info: form.core_product_info || null,
        model_or_line: form.model_or_line || null,
        price_position: form.price_position || null,
        threat_level: form.threat_level,
        key_features: form.key_features || null,
        gap_analysis: form.gap_analysis || null,
      });
      setForm({
        name: '',
        website: '',
        core_product_info: '',
        model_or_line: '',
        price_position: '',
        threat_level: 'medium',
        key_features: '',
        gap_analysis: '',
      });
      await loadBase();
      setMsg('竞品已新增');
    } catch (err) {
      setMsg(err.message);
    }
  }

  async function saveCrawlConfig(e) {
    e.preventDefault();
    if (!projectId) return;
    try {
      await api.put('/api/competitors/crawl/config', {
        project_id: projectId,
        frequency_hours: Number(crawlCfg.frequency_hours || 24),
        source_websites: crawlCfg.source_websites,
        source_media: crawlCfg.source_media,
        source_patents: crawlCfg.source_patents,
        enabled: crawlCfg.enabled,
      });
      setMsg('抓取配置已保存');
    } catch (err) {
      setMsg(err.message);
    }
  }

  async function runCrawlNow() {
    if (!projectId) return;
    try {
      const { data } = await api.post('/api/competitors/crawl/run', { project_id: projectId });
      setMsg(`抓取完成，新增 ${data.created || 0} 条动态`);
      await loadSnapshots(1);
      await loadLogs(1);
      await loadBase();
    } catch (err) {
      setMsg(err.message);
    }
  }

  async function saveOwnSpec(e) {
    e.preventDefault();
    if (!projectId) return;
    try {
      await api.put('/api/competitors/own-product-spec', {
        project_id: projectId,
        product_name: ownSpec.product_name || null,
        payload_kg: ownSpec.payload_kg === '' ? null : Number(ownSpec.payload_kg),
        repeatability_mm: ownSpec.repeatability_mm === '' ? null : Number(ownSpec.repeatability_mm),
        ip_rating: ownSpec.ip_rating || null,
        battery_life_h: ownSpec.battery_life_h === '' ? null : Number(ownSpec.battery_life_h),
        price_cny: ownSpec.price_cny === '' ? null : Number(ownSpec.price_cny),
        notes: ownSpec.notes || null,
      });
      setMsg('自家参数已保存');
      await loadBase();
    } catch (err) {
      setMsg(err.message);
    }
  }

  async function askQa(e) {
    e.preventDefault();
    if (!projectId || !qaQuestion.trim()) return;
    try {
      const { data } = await api.post('/api/competitors/qa', {
        project_id: projectId,
        question: qaQuestion.trim(),
      });
      setQaAnswer(data.answer || '暂无答案');
    } catch (err) {
      setQaAnswer(err.message);
    }
  }

  async function suggestionToTask(s) {
    if (!projectId) return;
    try {
      await api.post('/api/competitors/suggestions/to-task', {
        project_id: projectId,
        title: s.title || '竞品迭代建议',
        detail: `${s.detail || ''}\n来源：${s.from || '竞品动态分析'}`,
        priority: 'high',
      });
      setMsg('建议已转为任务');
    } catch (err) {
      setMsg(err.message);
    }
  }

  function exportReportPdf() {
    if (!projectId) return;
    window.open(`/api/competitors/report/pdf?projectId=${projectId}`, '_blank');
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
        <h1 className="font-display text-2xl font-semibold text-slate-900">竞品动态跟踪与分析</h1>
        <p className="mt-1 text-sm text-slate-600">竞品列表、参数对比、分析报告、问答与运营日志。</p>
      </div>
      <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">
          参数说明（URL 状态短码字典）
        </summary>
        <p className="mt-2 text-xs text-slate-500">
          用于筛选/分页/草稿记忆，便于产品与测试同学复现页面状态。
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
                ['cid', 'competitorId（竞品筛选）'],
                ['src', 'sourceType（来源筛选）'],
                ['sd', 'startDate（开始日期）'],
                ['ed', 'endDate（结束日期）'],
                ['sp/sps', '动态快照页码 / 每页条数'],
                ['lp/lps', '抓取日志页码 / 每页条数'],
                ['cfh', '爬虫频率草稿（frequency_hours）'],
                ['cen', '爬虫启用草稿（1/0）'],
                ['cws/cmd/cpt', '官网/媒体/专利来源草稿（换行拼接）'],
                ['iws/imd/ipt', '官网/媒体/专利输入框临时草稿'],
              ].map(([k, v]) => (
                <tr key={k} className="border-t border-slate-100">
                  <td className="py-2 pr-3 font-mono text-xs">{k}</td>
                  <td className="py-2 pr-3">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {msg ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{msg}</div> : null}

      {!projectId ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">请先选择项目。</div>
      ) : (
        <>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">爬虫配置入口</h2>
              <button type="button" onClick={runCrawlNow} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800">立即抓取</button>
            </div>
            <form onSubmit={saveCrawlConfig} className="mt-3 grid gap-2 sm:grid-cols-2">
              <input type="number" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={crawlCfg.frequency_hours} onChange={(e) => setCrawlCfg((f) => ({ ...f, frequency_hours: e.target.value }))} placeholder="抓取频率(小时)" />
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={crawlCfg.enabled} onChange={(e) => setCrawlCfg((f) => ({ ...f, enabled: e.target.checked }))} />启用定时抓取</label>
              {['websites', 'media', 'patents'].map((k) => (
                <div key={k} className="sm:col-span-2">
                  <div className="mb-1 text-xs text-slate-500">来源 {k}</div>
                  <div className="flex gap-2">
                    <input className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" value={sourceInput[k]} onChange={(e) => setSourceInput((s) => ({ ...s, [k]: e.target.value }))} />
                    <button type="button" className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold" onClick={() => {
                      const v = sourceInput[k].trim();
                      if (!v) return;
                      const key = `source_${k}`;
                      setCrawlCfg((f) => ({ ...f, [key]: Array.from(new Set([...(f[key] || []), v])) }));
                      setSourceInput((s) => ({ ...s, [k]: '' }));
                    }}>添加</button>
                  </div>
                </div>
              ))}
              <div className="sm:col-span-2"><button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">保存配置</button></div>
            </form>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">竞品列表</h2>
            <div className="mt-3 grid gap-3">
              {items.map((c) => (
                <div key={c.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-slate-900">{c.name}</div>
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">威胁 {threatLabel[c.threat_level] || c.threat_level}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{c.website || '未配置官网'} · {c.model_or_line || '—'}</div>
                  <div className="mt-1 text-sm text-slate-700">{c.core_product_info || c.key_features || '—'}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">参数对比看板</h2>
            <form onSubmit={saveOwnSpec} className="mt-3 grid gap-2 sm:grid-cols-3">
              <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="自家产品名" value={ownSpec.product_name} onChange={(e) => setOwnSpec((f) => ({ ...f, product_name: e.target.value }))} />
              <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="负载kg" value={ownSpec.payload_kg} onChange={(e) => setOwnSpec((f) => ({ ...f, payload_kg: e.target.value }))} />
              <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="重复定位mm" value={ownSpec.repeatability_mm} onChange={(e) => setOwnSpec((f) => ({ ...f, repeatability_mm: e.target.value }))} />
              <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="防护等级(IP)" value={ownSpec.ip_rating} onChange={(e) => setOwnSpec((f) => ({ ...f, ip_rating: e.target.value }))} />
              <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="续航h" value={ownSpec.battery_life_h} onChange={(e) => setOwnSpec((f) => ({ ...f, battery_life_h: e.target.value }))} />
              <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="价格CNY" value={ownSpec.price_cny} onChange={(e) => setOwnSpec((f) => ({ ...f, price_cny: e.target.value }))} />
              <div className="sm:col-span-3"><button className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-800">保存自家参数</button></div>
            </form>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-2 pr-3">竞品</th><th className="py-2 pr-3">指标</th><th className="py-2 pr-3">我方</th><th className="py-2 pr-3">竞品</th><th className="py-2 pr-3">结论</th>
                  </tr>
                </thead>
                <tbody>
                  {compare.rows.flatMap((r) => r.metrics.map((m, i) => (
                    <tr key={`${r.competitor.id}_${i}`} className="border-t border-slate-100">
                      <td className="py-2 pr-3">{r.competitor.name}</td>
                      <td className="py-2 pr-3">{m[0]}</td>
                      <td className="py-2 pr-3">{m[1] ?? '—'}</td>
                      <td className="py-2 pr-3">{m[2] ?? '—'}</td>
                      <td className="py-2 pr-3"><span className={`rounded px-2 py-0.5 text-xs ${levelCls[m[3] || 'neutral']}`}>{m[3] === 'disadvantage' ? '我方劣势' : m[3] === 'advantage' ? '我方优势' : '持平'}</span></td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">动态分析报告</h2>
              <button type="button" onClick={exportReportPdf} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800">导出 PDF</button>
            </div>
            <div className="mt-3 grid gap-2">
              {(report.analysis || []).map((r) => (
                <div key={r.competitor} className="rounded-lg border border-slate-200 p-3">
                  <div className="font-semibold text-slate-900">{r.competitor}</div>
                  <div className="mt-1 text-xs text-slate-500">价格动态：{r.price_dynamic || '—'}</div>
                  <div className="mt-1 text-xs text-red-700">风险点：{(r.risk_points || []).join(' / ') || '—'}</div>
                </div>
              ))}
            </div>
            <div className="mt-3">
              <h3 className="text-xs font-semibold text-slate-700">迭代建议（一键转任务）</h3>
              <div className="mt-2 space-y-2">
                {topSuggestions.map((s, i) => (
                  <div key={`${s.title}_${i}`} className="flex items-start justify-between gap-3 rounded border border-slate-200 p-2">
                    <div className="text-sm">
                      <div className="font-medium text-slate-800">{s.title || '迭代建议'}</div>
                      <div className="text-xs text-slate-500">{s.detail || '—'} · 来源 {s.from || '竞品'}</div>
                    </div>
                    <button type="button" onClick={() => suggestionToTask(s)} className="rounded border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">转任务</button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">动态筛选与分页（按竞品/来源/时间）</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={filters.competitorId} onChange={(e) => setFilters((f) => ({ ...f, competitorId: e.target.value }))}>
                <option value="">全部竞品</option>
                {items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={filters.sourceType} onChange={(e) => setFilters((f) => ({ ...f, sourceType: e.target.value }))}>
                <option value="">全部来源</option><option value="website">官网</option><option value="media">媒体</option><option value="patent">专利</option>
              </select>
              <input type="date" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={filters.startDate} onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value }))} />
              <input type="date" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={filters.endDate} onChange={(e) => setFilters((f) => ({ ...f, endDate: e.target.value }))} />
            </div>
            <div className="mt-3 space-y-2">
              {snapshots.map((s) => (
                <div key={s.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="text-sm font-semibold text-slate-900">{s.competitor_name} · {s.source_type}</div>
                  <div className="text-xs text-slate-500">{s.source_url} · {s.created_at}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2 text-sm">
              <button
                type="button"
                disabled={snapshotPage.page <= 1}
                onClick={() => {
                  const p = snapshotPage.page - 1;
                  setSnapshotPage((x) => ({ ...x, page: p }));
                  loadSnapshots(p);
                }}
                className="rounded border border-slate-200 px-2 py-1 disabled:opacity-50"
              >
                上一页
              </button>
              <span>第 {snapshotPage.page} / {snapshotPage.totalPages} 页（共 {snapshotPage.total} 条）</span>
              <button
                type="button"
                disabled={snapshotPage.page >= snapshotPage.totalPages}
                onClick={() => {
                  const p = snapshotPage.page + 1;
                  setSnapshotPage((x) => ({ ...x, page: p }));
                  loadSnapshots(p);
                }}
                className="rounded border border-slate-200 px-2 py-1 disabled:opacity-50"
              >
                下一页
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">抓取任务执行日志</h2>
            <div className="mt-3 space-y-2">
              {logs.map((l) => (
                <div key={l.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="text-sm font-semibold text-slate-900">{l.trigger_type} · {l.status}</div>
                  <div className="text-xs text-slate-500">开始：{l.started_at}；结束：{l.finished_at || '—'}；新增：{l.created_count}</div>
                  <div className="text-xs text-slate-600">{l.message || '—'}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2 text-sm">
              <button
                type="button"
                disabled={logPage.page <= 1}
                onClick={() => {
                  const p = logPage.page - 1;
                  setLogPage((x) => ({ ...x, page: p }));
                  loadLogs(p);
                }}
                className="rounded border border-slate-200 px-2 py-1 disabled:opacity-50"
              >
                上一页
              </button>
              <span>第 {logPage.page} / {logPage.totalPages} 页（共 {logPage.total} 条）</span>
              <button
                type="button"
                disabled={logPage.page >= logPage.totalPages}
                onClick={() => {
                  const p = logPage.page + 1;
                  setLogPage((x) => ({ ...x, page: p }));
                  loadLogs(p);
                }}
                className="rounded border border-slate-200 px-2 py-1 disabled:opacity-50"
              >
                下一页
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">RAG问答入口</h2>
            <form onSubmit={askQa} className="mt-3 flex gap-2">
              <input className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="例如：竞品A最新重复定位精度和我方对比如何？" value={qaQuestion} onChange={(e) => setQaQuestion(e.target.value)} />
              <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">提问</button>
            </form>
            <div className="mt-3 rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{qaAnswer || '暂无问答结果'}</div>
          </div>

          <form onSubmit={onSubmit} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">新增竞品</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <input required className="sm:col-span-2 rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="名称" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              <input className="sm:col-span-2 rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="官网" value={form.website} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))} />
              <textarea className="sm:col-span-2 rounded-lg border border-slate-200 px-3 py-2 text-sm" rows={2} placeholder="核心产品信息" value={form.core_product_info} onChange={(e) => setForm((f) => ({ ...f, core_product_info: e.target.value }))} />
              <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="型号/系列" value={form.model_or_line} onChange={(e) => setForm((f) => ({ ...f, model_or_line: e.target.value }))} />
              <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="价格定位" value={form.price_position} onChange={(e) => setForm((f) => ({ ...f, price_position: e.target.value }))} />
              <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={form.threat_level} onChange={(e) => setForm((f) => ({ ...f, threat_level: e.target.value }))}>
                <option value="low">低</option><option value="medium">中</option><option value="high">高</option>
              </select>
              <textarea className="sm:col-span-2 rounded-lg border border-slate-200 px-3 py-2 text-sm" rows={2} placeholder="关键特性" value={form.key_features} onChange={(e) => setForm((f) => ({ ...f, key_features: e.target.value }))} />
              <textarea className="sm:col-span-2 rounded-lg border border-slate-200 px-3 py-2 text-sm" rows={3} placeholder="差距分析" value={form.gap_analysis} onChange={(e) => setForm((f) => ({ ...f, gap_analysis: e.target.value }))} />
            </div>
            <div className="mt-3"><button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">保存</button></div>
          </form>
        </>
      )}
    </div>
  );
}
