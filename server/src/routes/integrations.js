/**
 * 集成状态与占位接口（科大讯飞 RAG / SMTP）
 * GET  /api/integrations/status — 配置是否就绪
 * POST /api/integrations/rag/query — 占位检索（需后续实现真实调用）
 */
import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import { requireAuth } from '../middleware/auth.js';
import { getRagStatus, queryKnowledgeBase } from '../services/ragClient.js';
import { getMailStatus } from '../services/mailService.js';
import { sendServerError } from '../utils/http.js';
import {
  getDbRagConfig,
  getEffectiveRagConfig,
  saveRagConfig,
} from '../services/integrationSettingsService.js';

const router = Router();

router.get('/status', requireAuth, (_req, res) => {
  try {
    res.json({
      iflytekRag: getRagStatus(),
      smtp: getMailStatus(),
    });
  } catch (e) {
    sendServerError(res, e);
  }
});

router.post(
  '/rag/query',
  requireAuth,
  body('query').trim().notEmpty(),
  body('topK').optional().isInt({ min: 1, max: 50 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const result = await queryKnowledgeBase({
        query: req.body.query,
        topK: req.body.topK ?? 5,
      });
      res.json(result);
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.get('/rag/config', requireAuth, (_req, res) => {
  try {
    const dbCfg = getDbRagConfig();
    const eff = getEffectiveRagConfig();
    res.json({
      source: {
        db: {
          ...dbCfg,
          apiKey: dbCfg.apiKey ? '***已填写***' : '',
        },
        effective: {
          ...eff,
          apiKey: eff.apiKey ? '***已填写***' : '',
        },
      },
    });
  } catch (e) {
    sendServerError(res, e);
  }
});

router.put(
  '/rag/config',
  requireAuth,
  body('baseUrl').optional().isString(),
  body('apiKey').optional().isString(),
  body('appId').optional().isString(),
  body('timeoutMs').optional().isInt({ min: 1000, max: 120000 }),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const saved = saveRagConfig({
        baseUrl: req.body.baseUrl,
        apiKey: req.body.apiKey,
        appId: req.body.appId,
        timeoutMs: req.body.timeoutMs,
      });
      res.json({
        message: 'RAG 配置已保存',
        config: {
          ...saved,
          apiKey: saved.apiKey ? '***已填写***' : '',
        },
      });
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

export default router;
