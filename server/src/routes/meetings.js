/**
 * 基于 RAG 的会议纪要深度解析与项目联动
 */
import { Router } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { db, insertId } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { sendServerError } from '../utils/http.js';
import { queryKnowledgeBase } from '../services/ragClient.js';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadRoot = path.join(__dirname, '..', '..', 'uploads', 'meetings');
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

function extractDate(line) {
  const m = String(line).match(/(20\d{2}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function extractAssignee(line, users) {
  const text = String(line || '');
  for (const u of users) {
    const n1 = String(u.full_name || '').trim();
    const n2 = String(u.username || '').trim();
    if ((n1 && text.includes(n1)) || (n2 && text.includes(n2))) {
      return u.id;
    }
  }
  return null;
}

function fallbackParseMeeting(text, users) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  const todos = [];
  const changes = [];
  const risks = [];
  const decisions = [];
  for (const ln of lines) {
    const low = ln.toLowerCase();
    if (/(待办|todo|行动项|action)/i.test(ln)) {
      todos.push({
        content: ln.replace(/^(待办|todo|行动项)[:：-]?\s*/i, ''),
        assignee_id: extractAssignee(ln, users),
        due_date: extractDate(ln),
      });
      continue;
    }
    if (/(变更|需求变更|change)/i.test(ln)) {
      changes.push({
        content: ln.replace(/^(需求变更|变更|change)[:：-]?\s*/i, ''),
        impact_scope: '',
        decision: '',
      });
      continue;
    }
    if (/(风险|risk)/i.test(ln)) {
      risks.push({
        description: ln.replace(/^(风险|risk)[:：-]?\s*/i, ''),
        impact_level: /高|high/i.test(ln) ? 'high' : /低|low/i.test(ln) ? 'low' : 'medium',
        suggestion: '',
      });
      continue;
    }
    if (/(决策|决定|decision)/i.test(ln)) {
      decisions.push({
        content: ln.replace(/^(决策|决定|decision)[:：-]?\s*/i, ''),
        requirement: '',
        follow_up: '',
      });
    }
  }
  return { todos, changes, risks, decisions, source: 'fallback' };
}

async function parseMeetingTextWithRag(text, users) {
  const prompt = `
你是项目经理助理。请从会议纪要中提取 JSON（仅输出 JSON）：
{
  "todos":[{"content":"","assignee_name":"","due_date":""}],
  "changes":[{"content":"","impact_scope":"","decision":""}],
  "risks":[{"description":"","impact_level":"low|medium|high","suggestion":""}],
  "decisions":[{"content":"","requirement":"","follow_up":""}]
}
会议纪要如下：
${text}
`;
  const rag = await queryKnowledgeBase({ query: prompt, topK: 6 });
  if (!rag.ok || !rag.answer) {
    return fallbackParseMeeting(text, users);
  }
  const extracted = safeJsonParse(rag.answer, null);
  if (!extracted || typeof extracted !== 'object') {
    return fallbackParseMeeting(text, users);
  }
  const todos = (extracted.todos || []).map((t) => ({
    content: t.content || '',
    assignee_id: extractAssignee(`${t.assignee_name || ''} ${t.content || ''}`, users),
    due_date: extractDate(t.due_date || ''),
  }));
  return {
    todos,
    changes: extracted.changes || [],
    risks: extracted.risks || [],
    decisions: extracted.decisions || [],
    source: 'iflytek_rag',
  };
}

async function readUploadedText(file) {
  const ext = path.extname(file.originalname || file.filename).toLowerCase();
  if (ext === '.txt') {
    return fs.readFileSync(file.path, 'utf8');
  }
  if (ext === '.docx') {
    const out = await mammoth.extractRawText({ path: file.path });
    return out.value || '';
  }
  if (ext === '.pdf') {
    const buf = fs.readFileSync(file.path);
    const out = await pdfParse(buf);
    return out.text || '';
  }
  throw new Error('仅支持 Word(.docx)/PDF/TXT');
}

function addKnowledgeDoc(projectId, sourceType, sourceId, title, content) {
  db.prepare(
    `INSERT INTO knowledge_docs (project_id, source_type, source_id, title, content)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(projectId, sourceType, sourceId ?? null, title, content);
}

function normalizeParsed(parsed) {
  return {
    todos: Array.isArray(parsed?.todos) ? parsed.todos : [],
    changes: Array.isArray(parsed?.changes) ? parsed.changes : [],
    risks: Array.isArray(parsed?.risks) ? parsed.risks : [],
    decisions: Array.isArray(parsed?.decisions) ? parsed.decisions : [],
    source: parsed?.source || 'unknown',
  };
}

function buildTaskPayloadByCategory(category, item) {
  if (category === 'todos') {
    return {
      title: String(item.content || '').trim() || '会议待办任务',
      description: '',
      due_date: item.due_date || null,
      priority: 'medium',
      assignee_id: item.assignee_id ?? null,
    };
  }
  if (category === 'changes') {
    return {
      title: `[需求变更] ${String(item.content || '').trim() || '待确认变更'}`,
      description: `影响范围：${item.impact_scope || '未填写'}\n决策结论：${item.decision || '未填写'}`,
      due_date: null,
      priority: 'high',
      assignee_id: item.assignee_id ?? null,
    };
  }
  if (category === 'risks') {
    const lv = String(item.impact_level || 'medium').toLowerCase();
    return {
      title: `[风险跟进] ${String(item.description || '').trim() || '会议识别风险'}`,
      description: `风险描述：${item.description || ''}\n应对建议：${item.suggestion || ''}`,
      due_date: null,
      priority: lv === 'high' ? 'critical' : lv === 'low' ? 'medium' : 'high',
      assignee_id: item.assignee_id ?? null,
    };
  }
  // decisions
  return {
    title: `[决策执行] ${String(item.content || '').trim() || '会议决策执行'}`,
    description: `执行要求：${item.requirement || '未填写'}\n跟进人：${item.follow_up || '未填写'}`,
    due_date: null,
    priority: 'medium',
    assignee_id: item.assignee_id ?? null,
  };
}

function createTaskFromMeetingItem({ meeting, category, item, userId, users }) {
  const payload = buildTaskPayloadByCategory(category, item || {});
  const assigneeId =
    payload.assignee_id ||
    extractAssignee(`${item?.assignee_name || ''} ${payload.title}`, users);
  const info = db
    .prepare(
      `INSERT INTO tasks (project_id, title, description, status, priority, assignee_id, reporter_id, due_date, progress)
       VALUES (?, ?, ?, 'todo', ?, ?, ?, ?, 0)`,
    )
    .run(
      meeting.project_id,
      payload.title,
      payload.description || null,
      payload.priority,
      assigneeId ?? null,
      userId,
      payload.due_date || null,
    );
  const taskId = insertId(info);
  db.prepare(
    `INSERT INTO task_external_links (task_id, link_type, ref_id, ref_title, note)
     VALUES (?, 'meeting', ?, ?, 'meeting-sync')`,
  ).run(taskId, String(meeting.id), meeting.title);
  return db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(taskId);
}

router.get(
  '/',
  requireAuth,
  query('projectId').isInt(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const rows = db
        .prepare(
          `SELECT m.*, u.username AS creator_username, u.full_name AS creator_full_name
           FROM meeting_minutes m
           LEFT JOIN users u ON u.id = m.created_by_id
           WHERE m.project_id = ?
           ORDER BY m.id DESC`,
        )
        .all(Number(req.query.projectId));
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
    const row = db.prepare(`SELECT * FROM meeting_minutes WHERE id = ?`).get(Number(req.params.id));
    if (!row) return res.status(404).json({ message: '会议纪要不存在' });
    res.json({
      ...row,
      parsed: safeJsonParse(row.parsed_json || '{}', {
        todos: [],
        changes: [],
        risks: [],
        decisions: [],
      }),
      file_url: row.storage_path ? `/uploads/meetings/${row.storage_path}` : null,
    });
  } catch (e) {
    sendServerError(res, e);
  }
});

router.post(
  '/parse',
  requireAuth,
  upload.single('file'),
  async (req, res) => {
    try {
      const project_id = Number(req.body.project_id);
      const title = String(req.body.title || '').trim();
      const pasted = String(req.body.text || '').trim();
      if (!project_id) return res.status(400).json({ message: 'project_id 必填' });
      if (!title) return res.status(400).json({ message: '会议标题必填' });
      if (!pasted && !req.file) {
        return res.status(400).json({ message: '请上传文件或粘贴会议内容' });
      }
      let rawText = pasted;
      let source_type = 'text';
      let file_name = null;
      let storage_path = null;
      if (req.file) {
        rawText = await readUploadedText(req.file);
        const ext = path.extname(req.file.originalname || '').toLowerCase();
        source_type = ext === '.pdf' ? 'pdf' : ext === '.docx' ? 'docx' : ext === '.txt' ? 'txt' : 'text';
        file_name = req.file.originalname;
        storage_path = req.file.filename;
      }
      if (!rawText || !rawText.trim()) {
        return res.status(400).json({ message: '会议内容为空，无法解析' });
      }
      const users = db
        .prepare(`SELECT id, username, full_name FROM users ORDER BY id`)
        .all();
      const parsed = await parseMeetingTextWithRag(rawText, users);

      const info = db
        .prepare(
          `INSERT INTO meeting_minutes
           (project_id, title, source_type, file_name, storage_path, raw_text, parsed_json, status, created_by_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'parsed', ?)`,
        )
        .run(
          project_id,
          title,
          source_type,
          file_name,
          storage_path,
          rawText,
          JSON.stringify(parsed),
          req.user.id,
        );
      const id = insertId(info);
      addKnowledgeDoc(project_id, 'meeting', id, `${title}（原文）`, rawText);
      addKnowledgeDoc(project_id, 'meeting', id, `${title}（解析）`, JSON.stringify(parsed, null, 2));
      const row = db.prepare(`SELECT * FROM meeting_minutes WHERE id = ?`).get(id);
      res.status(201).json({
        ...row,
        parsed,
        message: parsed.source === 'iflytek_rag' ? '已通过讯飞RAG解析' : 'RAG 不可用，已使用本地规则解析',
      });
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.put(
  '/:id/parsed',
  requireAuth,
  param('id').isInt(),
  body('parsed').isObject(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const id = Number(req.params.id);
    try {
      const row = db.prepare(`SELECT * FROM meeting_minutes WHERE id = ?`).get(id);
      if (!row) return res.status(404).json({ message: '会议纪要不存在' });
      db.prepare(
        `UPDATE meeting_minutes
         SET parsed_json = ?, status = 'confirmed', updated_at = datetime('now')
         WHERE id = ?`,
      ).run(JSON.stringify(req.body.parsed || {}), id);
      res.json({ message: '解析结果已保存', parsed: req.body.parsed });
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.post('/:id/sync', requireAuth, param('id').isInt(), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const id = Number(req.params.id);
  try {
    const meeting = db.prepare(`SELECT * FROM meeting_minutes WHERE id = ?`).get(id);
    if (!meeting) return res.status(404).json({ message: '会议纪要不存在' });
    const parsed = normalizeParsed(safeJsonParse(meeting.parsed_json || '{}', {}));
    const users = db
      .prepare(`SELECT id, username, full_name FROM users ORDER BY id`)
      .all();
    const created = { tasks: [], reviews: [], risks: [] };

    for (const category of ['changes', 'risks', 'decisions', 'todos']) {
      const rows = parsed[category] || [];
      for (let i = 0; i < rows.length; i += 1) {
        const item = rows[i];
        if (item?.synced_to_task) continue;
        const t = createTaskFromMeetingItem({
          meeting: { ...meeting, id },
          category,
          item,
          userId: req.user.id,
          users,
        });
        created.tasks.push(t);
        rows[i] = { ...item, synced_to_task: true, synced_task_id: t.id };

        if (category === 'changes') {
          const title = String(item.content || '').trim() || '需求变更评审';
          const info = db
            .prepare(
              `INSERT INTO reviews (project_id, title, review_type, status, lead_reviewer_id, review_date, conclusion, created_by_id)
               VALUES (?, ?, 'design', 'scheduled', ?, date('now', '+3 day'), ?, ?)`,
            )
            .run(meeting.project_id, `[需求变更] ${title}`, req.user.id, item.decision || null, req.user.id);
          created.reviews.push(db.prepare(`SELECT * FROM reviews WHERE id = ?`).get(insertId(info)));
        }
        if (category === 'risks') {
          const info = db
            .prepare(
              `INSERT INTO risk_register (project_id, meeting_id, title, description, impact_level, mitigation, status, warning_triggered)
               VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
            )
            .run(
              meeting.project_id,
              id,
              String(item.description || '').slice(0, 120) || '会议识别风险',
              item.description || null,
              ['low', 'medium', 'high'].includes(item.impact_level) ? item.impact_level : 'medium',
              item.suggestion || null,
              /high/i.test(String(item.impact_level || '')) ? 1 : 0,
            );
          created.risks.push(db.prepare(`SELECT * FROM risk_register WHERE id = ?`).get(insertId(info)));
        }
      }
      parsed[category] = rows;
    }

    addKnowledgeDoc(
      meeting.project_id,
      'meeting',
      id,
      `${meeting.title}（同步结果）`,
      JSON.stringify(created, null, 2),
    );

    db.prepare(
      `UPDATE meeting_minutes SET parsed_json = ?, status = 'synced', updated_at = datetime('now') WHERE id = ?`,
    ).run(JSON.stringify(parsed), id);

    res.json({
      message: '已同步到任务/评审/风险模块',
      created_count: {
        tasks: created.tasks.length,
        reviews: created.reviews.length,
        risks: created.risks.length,
      },
      created,
    });
  } catch (e) {
    sendServerError(res, e);
  }
});

router.post(
  '/:id/sync-item',
  requireAuth,
  param('id').isInt(),
  body('category').isIn(['changes', 'risks', 'decisions', 'todos']),
  body('index').isInt({ min: 0 }),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const id = Number(req.params.id);
    const category = req.body.category;
    const index = Number(req.body.index);
    try {
      const meeting = db.prepare(`SELECT * FROM meeting_minutes WHERE id = ?`).get(id);
      if (!meeting) return res.status(404).json({ message: '会议纪要不存在' });
      const parsed = normalizeParsed(safeJsonParse(meeting.parsed_json || '{}', {}));
      const rows = parsed[category] || [];
      if (!rows[index]) return res.status(404).json({ message: '该条目不存在' });
      if (rows[index].synced_to_task) {
        return res.json({ message: '该条目已同步', task_id: rows[index].synced_task_id || null });
      }
      const users = db.prepare(`SELECT id, username, full_name FROM users ORDER BY id`).all();
      const task = createTaskFromMeetingItem({
        meeting: { ...meeting, id },
        category,
        item: rows[index],
        userId: req.user.id,
        users,
      });
      rows[index] = { ...rows[index], synced_to_task: true, synced_task_id: task.id };
      parsed[category] = rows;
      db.prepare(
        `UPDATE meeting_minutes SET parsed_json = ?, updated_at = datetime('now') WHERE id = ?`,
      ).run(JSON.stringify(parsed), id);

      if (category === 'risks') {
        const r = rows[index];
        db.prepare(
          `INSERT INTO risk_register (project_id, meeting_id, title, description, impact_level, mitigation, status, warning_triggered)
           VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
        ).run(
          meeting.project_id,
          id,
          String(r.description || '').slice(0, 120) || '会议识别风险',
          r.description || null,
          ['low', 'medium', 'high'].includes(r.impact_level) ? r.impact_level : 'medium',
          r.suggestion || null,
          /high/i.test(String(r.impact_level || '')) ? 1 : 0,
        );
      }
      if (category === 'changes') {
        const c = rows[index];
        const title = String(c.content || '').trim() || '需求变更评审';
        db.prepare(
          `INSERT INTO reviews (project_id, title, review_type, status, lead_reviewer_id, review_date, conclusion, created_by_id)
           VALUES (?, ?, 'design', 'scheduled', ?, date('now', '+3 day'), ?, ?)`,
        ).run(meeting.project_id, `[需求变更] ${title}`, req.user.id, c.decision || null, req.user.id);
      }
      res.json({ message: '已同步到任务', task });
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.post('/:id/archive', requireAuth, param('id').isInt(), (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const id = Number(req.params.id);
  try {
    const meeting = db.prepare(`SELECT * FROM meeting_minutes WHERE id = ?`).get(id);
    if (!meeting) return res.status(404).json({ message: '会议纪要不存在' });
    const parsed = safeJsonParse(meeting.parsed_json || '{}', {});
    addKnowledgeDoc(
      meeting.project_id,
      'meeting',
      id,
      `${meeting.title}（手动归档-原文）`,
      meeting.raw_text || '',
    );
    addKnowledgeDoc(
      meeting.project_id,
      'meeting',
      id,
      `${meeting.title}（手动归档-解析）`,
      JSON.stringify(parsed, null, 2),
    );
    res.json({ message: '已归档到项目知识库' });
  } catch (e) {
    sendServerError(res, e);
  }
});

router.post(
  '/qa',
  requireAuth,
  body('project_id').isInt(),
  body('question').trim().notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const projectId = Number(req.body.project_id);
    const q = String(req.body.question || '');
    try {
      // 本地知识库召回（简单关键词）
      const docs = db
        .prepare(
          `SELECT * FROM knowledge_docs WHERE project_id = ? ORDER BY id DESC LIMIT 100`,
        )
        .all(projectId);
      const keywords = q
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
      const scored = docs
        .map((d) => {
          const txt = `${d.title}\n${d.content}`.toLowerCase();
          let score = 0;
          for (const k of keywords) if (txt.includes(k)) score += 1;
          return { doc: d, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((x) => x.doc);

      const context = scored
        .map((d, i) => `#${i + 1} ${d.title}\n${String(d.content || '').slice(0, 1200)}`)
        .join('\n\n');
      const prompt = `你是项目知识库助手。请基于以下上下文回答用户问题，若上下文不足请明确说明。\n\n上下文：\n${context}\n\n问题：${q}`;
      const rag = await queryKnowledgeBase({ query: prompt, topK: 5, context });
      const answer =
        rag.ok && rag.answer
          ? rag.answer
          : scored.length
            ? `未能调用外部RAG，以下为本地知识库命中：\n${scored
                .map((d) => `- ${d.title}`)
                .join('\n')}`
            : '知识库未检索到相关内容。';
      res.json({
        ok: true,
        answer,
        hits: scored.map((d) => ({
          id: d.id,
          title: d.title,
          source_type: d.source_type,
          source_id: d.source_id,
        })),
      });
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

export default router;

