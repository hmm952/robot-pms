/**
 * 合同全生命周期 REST API（RAG 解析 + 版本 + 付款节点 + 交付校验 + 变更 + 问答）
 */
import { Router } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { db, insertId, changeCount } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { sendServerError } from '../utils/http.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { queryKnowledgeBase } from '../services/ragClient.js';

const router = Router();

const contractStatus = [
  'draft',
  'negotiating',
  'signed',
  'executing',
  'closed',
  'terminated',
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadRoot = path.join(__dirname, '..', '..', 'uploads', 'contracts');
fs.mkdirSync(uploadRoot, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadRoot),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-() ]+/g, '_');
    cb(null, `${Date.now()}_${Math.random().toString(16).slice(2)}_${safe}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 30 * 1024 * 1024 } });

function safeJsonParse(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function addKnowledgeDoc(projectId, sourceId, title, content) {
  db.prepare(
    `INSERT INTO knowledge_docs (project_id, source_type, source_id, title, content)
     VALUES (?, 'other', ?, ?, ?)`,
  ).run(projectId, sourceId, title, content);
}

async function readUploadedContractText(file) {
  const ext = path.extname(file.originalname || file.filename).toLowerCase();
  if (ext === '.docx') {
    const out = await mammoth.extractRawText({ path: file.path });
    return out.value || '';
  }
  if (ext === '.pdf') {
    const buf = fs.readFileSync(file.path);
    const out = await pdfParse(buf);
    return out.text || '';
  }
  throw new Error('仅支持 PDF / Word(.docx)');
}

function fallbackExtractContract(rawText, existing = {}) {
  const text = String(rawText || '');
  const amt = text.match(/([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?)/);
  const maybeAmount = amt ? Number(String(amt[1]).replaceAll(',', '')) : null;
  return {
    title: existing.title || '合同（待确认）',
    counterparty: existing.counterparty || '待确认合作方',
    amount: Number.isFinite(maybeAmount) ? maybeAmount : existing.amount ?? null,
    payment_nodes: [],
    deliverables: [],
    breach_liability: '',
    confidentiality_clause: '',
  };
}

async function extractContractByRag(rawText, existing) {
  const prompt = `请从合同文本提取JSON，仅返回JSON：{
  "title":"", "counterparty":"", "amount":0,
  "payment_nodes":[{"title":"","amount":0,"due_date":""}],
  "deliverables":[{"title":"","requirement":"","due_date":""}],
  "breach_liability":"", "confidentiality_clause":""
}
合同文本如下：
${rawText}`;
  const rag = await queryKnowledgeBase({ query: prompt, topK: 6 });
  if (!rag.ok || !rag.answer) return fallbackExtractContract(rawText, existing);
  const parsed = safeJsonParse(rag.answer, null);
  if (!parsed || typeof parsed !== 'object') return fallbackExtractContract(rawText, existing);
  return {
    title: parsed.title || existing.title || '合同（待确认）',
    counterparty: parsed.counterparty || existing.counterparty || '待确认合作方',
    amount: parsed.amount ?? existing.amount ?? null,
    payment_nodes: Array.isArray(parsed.payment_nodes) ? parsed.payment_nodes : [],
    deliverables: Array.isArray(parsed.deliverables) ? parsed.deliverables : [],
    breach_liability: parsed.breach_liability || '',
    confidentiality_clause: parsed.confidentiality_clause || '',
  };
}

router.get(
  '/',
  requireAuth,
  query('projectId').optional().isInt(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      let rows;
      if (req.query.projectId) {
        rows = db
          .prepare(`SELECT * FROM contracts WHERE project_id = ? ORDER BY updated_at DESC`)
          .all(req.query.projectId);
      } else {
        rows = db.prepare(`SELECT * FROM contracts ORDER BY updated_at DESC`).all();
      }
      res.json(rows);
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.get('/:id', requireAuth, param('id').isInt(), (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const row = db.prepare(`SELECT * FROM contracts WHERE id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ message: '合同不存在' });
    const versions = db
      .prepare(`SELECT * FROM contract_versions WHERE contract_id = ? ORDER BY version_no DESC, id DESC`)
      .all(req.params.id)
      .map((v) => ({ ...v, file_url: v.storage_path ? `/uploads/contracts/${v.storage_path}` : null }));
    const payment_nodes = db
      .prepare(
        `SELECT p.*, m.name AS milestone_name
         FROM contract_payment_nodes p
         LEFT JOIN plan_milestones m ON m.id = p.milestone_id
         WHERE p.contract_id = ?
         ORDER BY p.due_date ASC, p.id ASC`,
      )
      .all(req.params.id)
      .map((n) => {
        const due = new Date(`${n.due_date}T12:00:00`);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const due_in_days = Math.ceil((due - today) / (24 * 3600 * 1000));
        return {
          ...n,
          due_in_days,
          warn_soon: due_in_days >= 0 && due_in_days <= 7 && n.status === 'pending',
          overdue: due_in_days < 0 && n.status === 'pending',
        };
      });
    const deliverables = db
      .prepare(
        `SELECT d.*, t.title AS linked_task_title, t.status AS linked_task_status
         FROM contract_deliverables d
         LEFT JOIN tasks t ON t.id = d.linked_task_id
         WHERE d.contract_id = ?
         ORDER BY d.id ASC`,
      )
      .all(req.params.id);
    const changes = db
      .prepare(
        `SELECT c.*, t.title AS linked_task_title
         FROM contract_change_logs c
         LEFT JOIN tasks t ON t.id = c.linked_task_id
         WHERE c.contract_id = ?
         ORDER BY c.id DESC`,
      )
      .all(req.params.id);
    const notifications = db
      .prepare(`SELECT * FROM contract_notifications WHERE contract_id = ? ORDER BY id DESC`)
      .all(req.params.id);
    res.json({ ...row, versions, payment_nodes, deliverables, changes, notifications });
  } catch (e) {
    sendServerError(res, e);
  }
});

router.post(
  '/',
  requireAuth,
  body('project_id').isInt(),
  body('title').trim().notEmpty(),
  body('counterparty').trim().notEmpty(),
  body('contract_type').optional().trim(),
  body('amount').optional().isFloat(),
  body('currency').optional().trim(),
  body('status').optional().isIn(contractStatus),
  body('effective_date').optional(),
  body('expiry_date').optional(),
  body('document_ref').optional(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const {
      project_id,
      title,
      counterparty,
      contract_type,
      amount,
      currency,
      status,
      effective_date,
      expiry_date,
      document_ref,
    } = req.body;
    try {
      const info = db
        .prepare(
          `INSERT INTO contracts (project_id, title, counterparty, contract_type, amount, currency, status, effective_date, expiry_date, document_ref)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          project_id,
          title,
          counterparty,
          contract_type ?? null,
          amount ?? null,
          currency || 'CNY',
          status || 'draft',
          effective_date ?? null,
          expiry_date ?? null,
          document_ref ?? null,
        );
      const row = db.prepare(`SELECT * FROM contracts WHERE id = ?`).get(insertId(info));
      res.status(201).json(row);
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.put(
  '/:id',
  requireAuth,
  param('id').isInt(),
  body('title').optional().trim().notEmpty(),
  body('counterparty').optional().trim().notEmpty(),
  body('contract_type').optional({ nullable: true }).trim(),
  body('amount').optional({ nullable: true }).isFloat(),
  body('currency').optional().trim(),
  body('status').optional().isIn(contractStatus),
  body('effective_date').optional({ nullable: true }),
  body('expiry_date').optional({ nullable: true }),
  body('document_ref').optional({ nullable: true }),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const id = Number(req.params.id);
    const existing = db.prepare(`SELECT * FROM contracts WHERE id = ?`).get(id);
    if (!existing) return res.status(404).json({ message: '合同不存在' });
    const next = { ...existing, ...req.body };
    try {
      db.prepare(
        `UPDATE contracts SET
          title = ?, counterparty = ?, contract_type = ?, amount = ?, currency = ?,
          status = ?, effective_date = ?, expiry_date = ?, document_ref = ?,
          updated_at = datetime('now')
         WHERE id = ?`,
      ).run(
        next.title,
        next.counterparty,
        next.contract_type ?? null,
        next.amount ?? null,
        next.currency || 'CNY',
        next.status,
        next.effective_date ?? null,
        next.expiry_date ?? null,
        next.document_ref ?? null,
        id,
      );
      res.json(db.prepare(`SELECT * FROM contracts WHERE id = ?`).get(id));
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.post(
  '/:id/upload-and-parse',
  requireAuth,
  param('id').isInt(),
  upload.single('file'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const id = Number(req.params.id);
      const contract = db.prepare(`SELECT * FROM contracts WHERE id = ?`).get(id);
      if (!contract) return res.status(404).json({ message: '合同不存在' });
      if (!req.file) return res.status(400).json({ message: '请上传合同文件' });

      const rawText = await readUploadedContractText(req.file);
      if (!rawText?.trim()) return res.status(400).json({ message: '未提取到合同文本内容' });
      const extracted = await extractContractByRag(rawText, contract);

      const maxVer = db
        .prepare(`SELECT MAX(version_no) AS mv FROM contract_versions WHERE contract_id = ?`)
        .get(id)?.mv;
      const nextVer = Number(maxVer || 0) + 1;
      db.prepare(
        `INSERT INTO contract_versions (contract_id, version_no, file_name, storage_path, raw_text, parsed_json, created_by_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, nextVer, req.file.originalname, req.file.filename, rawText, JSON.stringify(extracted), req.user.id);

      db.prepare(
        `UPDATE contracts SET
          title = ?, counterparty = ?, amount = COALESCE(?, amount),
          document_ref = ?, updated_at = datetime('now')
         WHERE id = ?`,
      ).run(
        extracted.title || contract.title,
        extracted.counterparty || contract.counterparty,
        extracted.amount ?? null,
        req.file.originalname,
        id,
      );

      for (const n of extracted.payment_nodes || []) {
        if (!n?.title || !n?.due_date) continue;
        db.prepare(
          `INSERT INTO contract_payment_nodes (contract_id, title, amount, due_date, status)
           VALUES (?, ?, ?, ?, 'pending')`,
        ).run(id, n.title, n.amount ?? null, n.due_date);
      }
      for (const d of extracted.deliverables || []) {
        if (!d?.title) continue;
        db.prepare(
          `INSERT INTO contract_deliverables (contract_id, title, requirement, due_date, check_status)
           VALUES (?, ?, ?, ?, 'pending')`,
        ).run(id, d.title, d.requirement ?? null, d.due_date ?? null);
      }

      addKnowledgeDoc(contract.project_id, id, `${contract.title} v${nextVer} 原文`, rawText);
      addKnowledgeDoc(
        contract.project_id,
        id,
        `${contract.title} v${nextVer} 解析`,
        JSON.stringify(extracted, null, 2),
      );
      res.status(201).json({ message: '合同上传并解析成功', extracted, version_no: nextVer });
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.post(
  '/:id/payment-nodes',
  requireAuth,
  param('id').isInt(),
  body('title').trim().notEmpty(),
  body('due_date').isString(),
  body('amount').optional({ nullable: true }).isFloat(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const id = Number(req.params.id);
      const c = db.prepare(`SELECT * FROM contracts WHERE id = ?`).get(id);
      if (!c) return res.status(404).json({ message: '合同不存在' });
      const info = db
        .prepare(
          `INSERT INTO contract_payment_nodes (contract_id, title, amount, due_date, status)
           VALUES (?, ?, ?, ?, 'pending')`,
        )
        .run(id, req.body.title, req.body.amount ?? null, req.body.due_date);
      res
        .status(201)
        .json(db.prepare(`SELECT * FROM contract_payment_nodes WHERE id = ?`).get(insertId(info)));
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.put(
  '/:id/payment-nodes/:nodeId',
  requireAuth,
  param('id').isInt(),
  param('nodeId').isInt(),
  body('status').isIn(['pending', 'applied', 'paid', 'delayed', 'cancelled']),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const contractId = Number(req.params.id);
      const nodeId = Number(req.params.nodeId);
      const c = db.prepare(`SELECT id FROM contracts WHERE id = ?`).get(contractId);
      if (!c) return res.status(404).json({ message: '合同不存在' });
      const node = db
        .prepare(`SELECT * FROM contract_payment_nodes WHERE id = ? AND contract_id = ?`)
        .get(nodeId, contractId);
      if (!node) return res.status(404).json({ message: '付款节点不存在' });
      db.prepare(
        `UPDATE contract_payment_nodes
         SET status = ?, updated_at = datetime('now')
         WHERE id = ?`,
      ).run(req.body.status, nodeId);

      if (req.body.status === 'paid') {
        db.prepare(
          `UPDATE contract_notifications
           SET status = 'closed'
           WHERE contract_id = ?
             AND payment_node_id = ?
             AND status IN ('open', 'sent')`,
        ).run(contractId, nodeId);
      }

      res.json(db.prepare(`SELECT * FROM contract_payment_nodes WHERE id = ?`).get(nodeId));
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.post(
  '/:id/payment-nodes/:nodeId/sync-milestone',
  requireAuth,
  param('id').isInt(),
  param('nodeId').isInt(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const contractId = Number(req.params.id);
      const nodeId = Number(req.params.nodeId);
      const c = db.prepare(`SELECT * FROM contracts WHERE id = ?`).get(contractId);
      if (!c) return res.status(404).json({ message: '合同不存在' });
      const n = db
        .prepare(`SELECT * FROM contract_payment_nodes WHERE id = ? AND contract_id = ?`)
        .get(nodeId, contractId);
      if (!n) return res.status(404).json({ message: '付款节点不存在' });
      const info = db
        .prepare(
          `INSERT INTO plan_milestones (project_id, name, phase_template, target_date, status, description, sort_order)
           VALUES (?, ?, 'custom', ?, 'planned', ?, 999)`,
        )
        .run(c.project_id, `[付款节点] ${n.title}`, n.due_date, `来源合同 #${contractId}`);
      const mid = insertId(info);
      db.prepare(
        `UPDATE contract_payment_nodes SET milestone_id = ?, updated_at = datetime('now') WHERE id = ?`,
      ).run(mid, nodeId);
      res.json({
        message: '已同步到里程碑',
        milestone: db.prepare(`SELECT * FROM plan_milestones WHERE id = ?`).get(mid),
      });
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.post('/:id/payment-nodes/run-reminder', requireAuth, param('id').isInt(), (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const contractId = Number(req.params.id);
    const c = db.prepare(`SELECT * FROM contracts WHERE id = ?`).get(contractId);
    if (!c) return res.status(404).json({ message: '合同不存在' });
    const nodes = db
      .prepare(
        `SELECT * FROM contract_payment_nodes
         WHERE contract_id = ? AND status = 'pending'`,
      )
      .all(contractId);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const created = [];
    for (const n of nodes) {
      const d = new Date(`${n.due_date}T12:00:00`);
      const dueIn = Math.ceil((d - today) / (24 * 3600 * 1000));
      if (dueIn < 0 || dueIn > 7) continue;
      const exists = db
        .prepare(
          `SELECT id FROM contract_notifications
           WHERE payment_node_id = ? AND notify_type = 'payment_apply'`,
        )
        .get(n.id);
      if (exists) continue;
      const title = `付款申请提醒：${n.title}`;
      const body = `合同「${c.title}」付款节点将于 ${n.due_date} 到期（剩余 ${dueIn} 天）。请发起付款申请。`;
      const info = db
        .prepare(
          `INSERT INTO contract_notifications (contract_id, payment_node_id, notify_type, title, body, status)
           VALUES (?, ?, 'payment_apply', ?, ?, 'open')`,
        )
        .run(contractId, n.id, title, body);
      created.push(db.prepare(`SELECT * FROM contract_notifications WHERE id = ?`).get(insertId(info)));
      db.prepare(
        `UPDATE contract_payment_nodes SET reminder_sent = 1, updated_at = datetime('now') WHERE id = ?`,
      ).run(n.id);
    }
    res.json({ message: `已生成 ${created.length} 条付款申请通知`, created });
  } catch (e) {
    sendServerError(res, e);
  }
});

router.post(
  '/:id/deliverables',
  requireAuth,
  param('id').isInt(),
  body('title').trim().notEmpty(),
  body('requirement').optional().isString(),
  body('due_date').optional({ nullable: true }).isString(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const contractId = Number(req.params.id);
      const c = db.prepare(`SELECT id FROM contracts WHERE id = ?`).get(contractId);
      if (!c) return res.status(404).json({ message: '合同不存在' });
      const info = db
        .prepare(
          `INSERT INTO contract_deliverables (contract_id, title, requirement, due_date, check_status)
           VALUES (?, ?, ?, ?, 'pending')`,
        )
        .run(contractId, req.body.title, req.body.requirement ?? null, req.body.due_date ?? null);
      res
        .status(201)
        .json(db.prepare(`SELECT * FROM contract_deliverables WHERE id = ?`).get(insertId(info)));
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.post('/:id/validate-deliverables', requireAuth, param('id').isInt(), (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const contractId = Number(req.params.id);
    const c = db.prepare(`SELECT * FROM contracts WHERE id = ?`).get(contractId);
    if (!c) return res.status(404).json({ message: '合同不存在' });
    const delivs = db
      .prepare(`SELECT * FROM contract_deliverables WHERE contract_id = ?`)
      .all(contractId);
    const tasks = db
      .prepare(`SELECT * FROM tasks WHERE project_id = ? ORDER BY id DESC`)
      .all(c.project_id);
    const result = [];
    for (const d of delivs) {
      const hit = tasks.find((t) =>
        String(t.title || '').toLowerCase().includes(String(d.title || '').toLowerCase()),
      );
      const matched = Boolean(hit);
      db.prepare(
        `UPDATE contract_deliverables
         SET linked_task_id = ?, check_status = ?, updated_at = datetime('now')
         WHERE id = ?`,
      ).run(hit?.id ?? null, matched ? 'matched' : 'unmatched', d.id);
      result.push({ deliverable_id: d.id, title: d.title, matched, task: hit || null });
    }
    res.json({ message: '交付物校验完成', result });
  } catch (e) {
    sendServerError(res, e);
  }
});

router.post(
  '/:id/changes',
  requireAuth,
  param('id').isInt(),
  body('change_title').trim().notEmpty(),
  body('change_content').trim().notEmpty(),
  body('impact_scope').optional().isString(),
  body('plan_adjustment').optional().isString(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const contractId = Number(req.params.id);
      const c = db.prepare(`SELECT * FROM contracts WHERE id = ?`).get(contractId);
      if (!c) return res.status(404).json({ message: '合同不存在' });
      const { change_title, change_content, impact_scope, plan_adjustment } = req.body;
      const taskInfo = db
        .prepare(
          `INSERT INTO tasks (project_id, title, description, status, priority, assignee_id, reporter_id, progress)
           VALUES (?, ?, ?, 'todo', 'high', NULL, ?, 0)`,
        )
        .run(
          c.project_id,
          `[合同变更] ${change_title}`,
          `${change_content}\n影响范围：${impact_scope || '未填写'}\n计划调整：${plan_adjustment || '未填写'}`,
          req.user.id,
        );
      const linkedTaskId = insertId(taskInfo);
      const info = db
        .prepare(
          `INSERT INTO contract_change_logs (contract_id, change_title, change_content, impact_scope, plan_adjustment, linked_task_id, created_by_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          contractId,
          change_title,
          change_content,
          impact_scope ?? null,
          plan_adjustment ?? null,
          linkedTaskId,
          req.user.id,
        );
      res
        .status(201)
        .json(db.prepare(`SELECT * FROM contract_change_logs WHERE id = ?`).get(insertId(info)));
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.post(
  '/:id/qa',
  requireAuth,
  param('id').isInt(),
  body('question').trim().notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const contractId = Number(req.params.id);
      const c = db.prepare(`SELECT * FROM contracts WHERE id = ?`).get(contractId);
      if (!c) return res.status(404).json({ message: '合同不存在' });
      const versions = db
        .prepare(
          `SELECT version_no, file_name, raw_text
           FROM contract_versions
           WHERE contract_id = ?
           ORDER BY version_no DESC
           LIMIT 5`,
        )
        .all(contractId);
      const context = versions
        .map((v) => `v${v.version_no} ${v.file_name || ''}\n${String(v.raw_text || '').slice(0, 1200)}`)
        .join('\n\n');
      const q = String(req.body.question || '');
      const prompt = `你是合同助手，请基于合同文本回答问题。若无法确定请明确说明。\n合同上下文：\n${context}\n\n问题：${q}`;
      const rag = await queryKnowledgeBase({ query: prompt, topK: 5, context });
      const answer =
        rag.ok && rag.answer ? rag.answer : '未检索到明确答案，请检查合同文本或RAG配置。';
      res.json({ ok: true, answer });
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.delete('/:id', requireAuth, param('id').isInt(), (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const r = db.prepare(`DELETE FROM contracts WHERE id = ?`).run(req.params.id);
    if (changeCount(r) === 0) return res.status(404).json({ message: '合同不存在' });
    res.status(204).send();
  } catch (e) {
    sendServerError(res, e);
  }
});

export default router;
