/**
 * 第三方集成配置（科大讯飞 RAG、邮件 SMTP）
 * 从环境变量读取；未配置时相关功能可安全降级或返回提示。
 *
 * 复制 server/.env.example 为 server/.env 并填写对应项即可。
 */

/** @returns {import('./integrations.types.js').IflytekRagConfig} */
export function getIflytekRagConfig() {
  return {
    baseUrl: process.env.IFLYTEK_RAG_BASE_URL || '',
    apiKey: process.env.IFLYTEK_RAG_API_KEY || '',
    appId: process.env.IFLYTEK_RAG_APP_ID || '',
    timeoutMs: Number(process.env.IFLYTEK_RAG_TIMEOUT_MS || 30000),
    enabled: Boolean(
      process.env.IFLYTEK_RAG_BASE_URL && process.env.IFLYTEK_RAG_API_KEY,
    ),
  };
}

/** @returns {import('./integrations.types.js').SmtpConfig} */
export function getSmtpConfig() {
  return {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '',
    enabled: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER),
  };
}
