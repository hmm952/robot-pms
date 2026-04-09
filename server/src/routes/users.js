/**
 * 用户列表（管理员）REST API
 * GET /api/users
 */
import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { sendServerError } from '../utils/http.js';

const router = Router();

/** 计划 / 任务指派用：所有登录用户可选责任人列表 */
router.get('/for-assignment', requireAuth, (_req, res) => {
  try {
    const rows = db
      .prepare(`SELECT id, username, full_name FROM users ORDER BY id`)
      .all();
    res.json(rows);
  } catch (e) {
    sendServerError(res, e);
  }
});

router.get('/', requireAuth, requireAdmin, (_req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT id, username, email, full_name, role, created_at FROM users ORDER BY id`,
      )
      .all();
    res.json(rows);
  } catch (e) {
    sendServerError(res, e);
  }
});

export default router;
