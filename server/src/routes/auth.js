/**
 * 认证 REST API
 * POST /api/auth/login    — 登录签发 JWT
 * POST /api/auth/register — 管理员创建用户
 * GET  /api/auth/me       — 当前用户信息
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import { db, insertId } from '../db.js';
import { JWT_SECRET, requireAuth, requireAdmin } from '../middleware/auth.js';
import { sendServerError } from '../utils/http.js';

const router = Router();

router.post(
  '/login',
  body('username').trim().notEmpty(),
  body('password').notEmpty(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: '参数无效', errors: errors.array() });
    }
    const { username, password } = req.body;
    try {
      const user = db
        .prepare(
          `SELECT id, username, password_hash, email, full_name, role, created_at FROM users WHERE username = ?`,
        )
        .get(username);
      if (!user || !bcrypt.compareSync(password, user.password_hash)) {
        return res.status(401).json({ message: '用户名或密码错误' });
      }
      const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        JWT_SECRET,
        { expiresIn: '7d' },
      );
      const { password_hash: _, ...safe } = user;
      res.json({ token, user: safe });
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.post(
  '/register',
  requireAuth,
  requireAdmin,
  body('username').trim().isLength({ min: 2, max: 64 }),
  body('password').isLength({ min: 6, max: 128 }),
  body('email').optional().isEmail(),
  body('full_name').optional().trim(),
  body('role').optional().isIn(['admin', 'user']),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: '参数无效', errors: errors.array() });
    }
    const { username, password, email, full_name, role } = req.body;
    const r = role === 'admin' ? 'admin' : 'user';
    const hash = bcrypt.hashSync(password, 10);
    try {
      const info = db
        .prepare(
          `INSERT INTO users (username, password_hash, email, full_name, role) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(username, hash, email || null, full_name || null, r);
      const user = db
        .prepare(
          `SELECT id, username, email, full_name, role, created_at FROM users WHERE id = ?`,
        )
        .get(insertId(info));
      res.status(201).json(user);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        return res.status(409).json({ message: '用户名已存在' });
      }
      sendServerError(res, e);
    }
  },
);

router.get('/me', requireAuth, (req, res) => {
  try {
    const user = db
      .prepare(
        `SELECT id, username, email, full_name, role, created_at FROM users WHERE id = ?`,
      )
      .get(req.user.id);
    if (!user) return res.status(404).json({ message: '用户不存在' });
    res.json(user);
  } catch (e) {
    sendServerError(res, e);
  }
});

export default router;
