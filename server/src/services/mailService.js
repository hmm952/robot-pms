/**
 * 邮件 SMTP 发送服务
 */
import nodemailer from 'nodemailer';
import { getEffectiveSmtpConfig } from './integrationSettingsService.js';

/**
 * @returns {{ configured: boolean, hint: string }}
 */
export function getMailStatus() {
  const c = getEffectiveSmtpConfig();
  if (c.enabled && c.from) {
    return {
      configured: true,
      hint: 'SMTP 已配置，可用于自动通知发送。',
    };
  }
  return {
    configured: false,
    hint: '请在“自动通知配置”页面填写 SMTP_HOST、SMTP_USER、SMTP_PASS、SMTP_FROM。',
  };
}

/**
 * 发送邮件占位
 * @param {{ to: string, subject: string, text: string, html?: string }} _opts
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function sendMail(_opts) {
  const c = getEffectiveSmtpConfig();
  if (!c.enabled) {
    return { ok: false, message: 'SMTP 未配置' };
  }
  const transporter = nodemailer.createTransport({
    host: c.host,
    port: Number(c.port || 587),
    secure: Boolean(c.secure),
    auth: {
      user: c.user,
      pass: c.pass,
    },
  });
  const info = await transporter.sendMail({
    from: c.from,
    to: _opts.to,
    subject: _opts.subject,
    text: _opts.text,
    html: _opts.html || undefined,
  });
  return {
    ok: true,
    message: '发送成功',
    messageId: info.messageId || '',
  };
}
