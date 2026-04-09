import { db } from '../db.js';
import { getIflytekRagConfig, getSmtpConfig } from '../config/integrations.js';

const KEYS = {
  baseUrl: 'iflytek_rag_base_url',
  apiKey: 'iflytek_rag_api_key',
  appId: 'iflytek_rag_app_id',
  timeoutMs: 'iflytek_rag_timeout_ms',
  smtpHost: 'smtp_host',
  smtpPort: 'smtp_port',
  smtpSecure: 'smtp_secure',
  smtpUser: 'smtp_user',
  smtpPass: 'smtp_pass',
  smtpFrom: 'smtp_from',
  wecomWebhook: 'wecom_webhook',
  dingtalkWebhook: 'dingtalk_webhook',
};

function read(key) {
  const row = db.prepare(`SELECT value FROM integration_settings WHERE key = ?`).get(key);
  return row?.value ?? '';
}

function upsert(key, value) {
  const existing = db.prepare(`SELECT key FROM integration_settings WHERE key = ?`).get(key);
  if (existing) {
    db.prepare(
      `UPDATE integration_settings SET value = ?, updated_at = datetime('now') WHERE key = ?`,
    ).run(String(value ?? ''), key);
  } else {
    db.prepare(`INSERT INTO integration_settings (key, value) VALUES (?, ?)`).run(
      key,
      String(value ?? ''),
    );
  }
}

export function getDbRagConfig() {
  return {
    baseUrl: read(KEYS.baseUrl),
    apiKey: read(KEYS.apiKey),
    appId: read(KEYS.appId),
    timeoutMs: Number(read(KEYS.timeoutMs) || 30000),
  };
}

export function getEffectiveRagConfig() {
  const envCfg = getIflytekRagConfig();
  const dbCfg = getDbRagConfig();
  const cfg = {
    baseUrl: dbCfg.baseUrl || envCfg.baseUrl,
    apiKey: dbCfg.apiKey || envCfg.apiKey,
    appId: dbCfg.appId || envCfg.appId,
    timeoutMs: Number(dbCfg.timeoutMs || envCfg.timeoutMs || 30000),
  };
  return {
    ...cfg,
    enabled: Boolean(cfg.baseUrl && cfg.apiKey),
  };
}

export function saveRagConfig(input) {
  upsert(KEYS.baseUrl, input.baseUrl || '');
  upsert(KEYS.apiKey, input.apiKey || '');
  upsert(KEYS.appId, input.appId || '');
  upsert(KEYS.timeoutMs, Number(input.timeoutMs || 30000));
  return getDbRagConfig();
}

export function getDbSmtpConfig() {
  return {
    host: read(KEYS.smtpHost),
    port: Number(read(KEYS.smtpPort) || 587),
    secure: String(read(KEYS.smtpSecure) || 'false') === 'true',
    user: read(KEYS.smtpUser),
    pass: read(KEYS.smtpPass),
    from: read(KEYS.smtpFrom),
    wecomWebhook: read(KEYS.wecomWebhook),
    dingtalkWebhook: read(KEYS.dingtalkWebhook),
  };
}

export function getEffectiveSmtpConfig() {
  const envCfg = getSmtpConfig();
  const dbCfg = getDbSmtpConfig();
  const cfg = {
    host: dbCfg.host || envCfg.host,
    port: Number(dbCfg.port || envCfg.port || 587),
    secure: Boolean(dbCfg.host ? dbCfg.secure : envCfg.secure),
    user: dbCfg.user || envCfg.user,
    pass: dbCfg.pass || envCfg.pass,
    from: dbCfg.from || envCfg.from,
    wecomWebhook: dbCfg.wecomWebhook || '',
    dingtalkWebhook: dbCfg.dingtalkWebhook || '',
  };
  return {
    ...cfg,
    enabled: Boolean(cfg.host && cfg.user && cfg.pass && cfg.from),
  };
}

export function saveSmtpConfig(input) {
  upsert(KEYS.smtpHost, input.host || '');
  upsert(KEYS.smtpPort, Number(input.port || 587));
  upsert(KEYS.smtpSecure, input.secure ? 'true' : 'false');
  upsert(KEYS.smtpUser, input.user || '');
  upsert(KEYS.smtpPass, input.pass || '');
  upsert(KEYS.smtpFrom, input.from || '');
  upsert(KEYS.wecomWebhook, input.wecomWebhook || '');
  upsert(KEYS.dingtalkWebhook, input.dingtalkWebhook || '');
  return getDbSmtpConfig();
}

