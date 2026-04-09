/**
 * 科大讯飞 RAG API 对接占位
 * 后续在此封装 HTTP 请求（如 fetch/axios），与贵司实际文档路径、鉴权头保持一致即可。
 */
import { getIflytekRagConfig } from '../config/integrations.js';
import { getEffectiveRagConfig } from './integrationSettingsService.js';

/**
 * 检查 RAG 是否已配置（供管理台或健康检查展示）
 * @returns {{ configured: boolean, hint: string }}
 */
export function getRagStatus() {
  const c = getEffectiveRagConfig();
  if (c.enabled) {
    return { configured: true, hint: 'RAG 已配置，可用于会议纪要解析与知识库问答。' };
  }
  return {
    configured: false,
    hint: '请在「API 配置」页面填写讯飞 RAG 地址与 API Key，或在 server/.env 配置。',
  };
}

/**
 * 示例：向知识库发起检索（占位实现，返回未配置说明）
 * @param {{ query: string, topK?: number }} _params
 * @returns {Promise<{ ok: boolean, items?: Array<{ title: string, snippet: string }>, message?: string }>}
 */
export async function queryKnowledgeBase(_params) {
  const c = getEffectiveRagConfig();
  if (!c.enabled) {
    return {
      ok: false,
      message: 'RAG 未配置：请设置环境变量并实现 ragClient.queryKnowledgeBase。',
    };
  }
  const { query, topK = 5, context = '' } = _params || {};
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), Number(c.timeoutMs || 30000));
    const resp = await fetch(c.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${c.apiKey}`,
        'x-app-id': c.appId || '',
      },
      body: JSON.stringify({
        query,
        topK,
        context,
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(t));
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return { ok: false, message: data?.message || `RAG 请求失败: ${resp.status}` };
    }
    return {
      ok: true,
      items: data?.items || [],
      answer: data?.answer || data?.result || '',
      raw: data,
    };
  } catch (e) {
    return {
      ok: false,
      message: `RAG 调用异常：${e.message}`,
    };
  }
}
