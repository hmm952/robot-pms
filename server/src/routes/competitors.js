/**
 * 竞品动态跟踪与分析 REST API
 */
import { Router } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { db, insertId, changeCount } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { sendServerError } from '../utils/http.js';
import { queryKnowledgeBase } from '../services/ragClient.js';
import PDFDocument from 'pdfkit';
import fs from 'fs';

const router = Router();
const threatLevels = ['low', 'medium', 'high'];
const nodeStatus = ['todo', 'in_progress', 'blocked', 'done'];
const sourceTypes = ['website', 'media', 'patent', 'manual'];

function safePdfFont(doc) {
  const candidates = [
    'C:\\Windows\\Fonts\\msyh.ttc',
    'C:\\Windows\\Fonts\\msyhbd.ttc',
    'C:\\Windows\\Fonts\\simhei.ttf',
    'C:\\Windows\\Fonts\\simsun.ttc',
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        doc.registerFont('CN', p);
        doc.font('CN');
        return true;
      }
    } catch {
      // ignore
    }
  }
  return false;
}

function safeJsonParse(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function fallbackExtract(rawText) {
  const text = String(rawText || '');
  const extractNum = (re) => {
    const m = text.match(re);
    return m ? Number(m[1]) : null;
  };
  return {
    new_releases: [],
    core_params: {
      payload_kg: extractNum(/(?:负载|payload)[^\d]{0,8}(\d+(?:\.\d+)?)/i),
      repeatability_mm: extractNum(/(?:重复定位精度|repeatability)[^\d]{0,8}(\d+(?:\.\d+)?)/i),
      ip_rating: (text.match(/\bIP\d{2}\b/i) || [null])[0],
      battery_life_h: extractNum(/(?:续航|battery)[^\d]{0,8}(\d+(?:\.\d+)?)/i),
    },
    patents: [],
    price_dynamic: '',
    market_moves: [],
    iteration_suggestions: [],
  };
}

async function extractByRag(rawText) {
  const prompt = `请从文本提取JSON，仅返回JSON：{
  "new_releases":[{"name":"","publish_date":"","summary":""}],
  "core_params":{"payload_kg":0,"repeatability_mm":0,"ip_rating":"","battery_life_h":0},
  "patents":[{"title":"","id":"","summary":""}],
  "price_dynamic":"",
  "market_moves":[{"title":"","summary":""}],
  "iteration_suggestions":[{"title":"","detail":""}]
}
文本如下：
${rawText}`;
  const rag = await queryKnowledgeBase({ query: prompt, topK: 6 });
  if (!rag.ok || !rag.answer) return fallbackExtract(rawText);
  const parsed = safeJsonParse(rag.answer, null);
  if (!parsed || typeof parsed !== 'object') return fallbackExtract(rawText);
  const fb = fallbackExtract(rawText);
  return {
    new_releases: Array.isArray(parsed.new_releases) ? parsed.new_releases : fb.new_releases,
    core_params: { ...fb.core_params, ...(parsed.core_params || {}) },
    patents: Array.isArray(parsed.patents) ? parsed.patents : fb.patents,
    price_dynamic: parsed.price_dynamic || fb.price_dynamic,
    market_moves: Array.isArray(parsed.market_moves) ? parsed.market_moves : fb.market_moves,
    iteration_suggestions: Array.isArray(parsed.iteration_suggestions)
      ? parsed.iteration_suggestions
      : fb.iteration_suggestions,
  };
}

function upsertKnowledgeDoc(projectId, title, content) {
  db.prepare(
    `INSERT INTO knowledge_docs (project_id, source_type, source_id, title, content)
     VALUES (?, 'other', NULL, ?, ?)`,
  ).run(projectId, title, content);
}

async function fetchPageText(url) {
  if (!url) return '';
  try {
    const resp = await fetch(url);
    if (!resp.ok) return '';
    const html = await resp.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 12000);
  } catch {
    return '';
  }
}

async function runCrawl(projectId, trigger = 'manual') {
  const logInfo = db
    .prepare(
      `INSERT INTO competitor_crawl_logs (project_id, trigger_type, status, started_at)
       VALUES (?, ?, 'running', datetime('now'))`,
    )
    .run(projectId, trigger);
  const logId = insertId(logInfo);
  const cfg =
    db.prepare(`SELECT * FROM competitor_crawl_configs WHERE project_id = ?`).get(projectId) || null;
  try {
    const competitors = db.prepare(`SELECT * FROM competitors WHERE project_id = ?`).all(projectId);
    const websites = safeJsonParse(cfg?.source_websites_json || '[]', []);
    const medias = safeJsonParse(cfg?.source_media_json || '[]', []);
    const patents = safeJsonParse(cfg?.source_patents_json || '[]', []);
    const allSources = [
      ...websites.map((u) => ({ url: u, source_type: 'website' })),
      ...medias.map((u) => ({ url: u, source_type: 'media' })),
      ...patents.map((u) => ({ url: u, source_type: 'patent' })),
    ];
    const created = [];

    for (const comp of competitors) {
      const compSources = [
        ...(comp.website ? [{ url: comp.website, source_type: 'website' }] : []),
        ...allSources,
      ];
      for (const s of compSources) {
        const rawText = await fetchPageText(s.url);
        if (!rawText) continue;
        const extracted = await extractByRag(rawText);
        const info = db
          .prepare(
            `INSERT INTO competitor_intel_snapshots
            (project_id, competitor_id, source_url, source_type, title, raw_text, extracted_json)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            projectId,
            comp.id,
            s.url,
            s.source_type,
            `${comp.name} ${s.source_type} ${new Date().toISOString().slice(0, 10)}`,
            rawText,
            JSON.stringify(extracted),
          );
        db.prepare(`UPDATE competitors SET last_updated = datetime('now') WHERE id = ?`).run(comp.id);
        upsertKnowledgeDoc(projectId, `竞品动态归档-${comp.name}`, `${s.url}\n${JSON.stringify(extracted)}`);
        created.push(insertId(info));
        if (created.length >= 30) break;
      }
    }
    db.prepare(
      `UPDATE competitor_crawl_logs
       SET status='success', finished_at=datetime('now'), created_count=?, message=?
       WHERE id=?`,
    ).run(created.length, `抓取完成，新增快照 ${created.length} 条`, logId);

    db.prepare(
      `INSERT INTO knowledge_docs (project_id, source_type, source_id, title, content)
       VALUES (?, 'other', NULL, ?, ?)`,
    ).run(projectId, '竞品抓取任务日志', `trigger=${trigger}, created=${created.length}`);
    db.prepare(
      `INSERT INTO competitor_crawl_configs (project_id, frequency_hours, enabled, last_run_at, updated_at)
       VALUES (?, 24, 1, datetime('now'), datetime('now'))
       ON CONFLICT(project_id) DO UPDATE SET last_run_at = datetime('now'), updated_at = datetime('now')`,
    ).run(projectId);
    return created.length;
  } catch (e) {
    db.prepare(
      `UPDATE competitor_crawl_logs
       SET status='failed', finished_at=datetime('now'), message=?
       WHERE id=?`,
    ).run(String(e.message || '抓取失败'), logId);
    throw e;
  }
}

function computeComparison(projectId) {
  const own = db.prepare(`SELECT * FROM project_product_specs WHERE project_id = ?`).get(projectId) || {};
  const comps = db.prepare(`SELECT * FROM competitors WHERE project_id = ? ORDER BY last_updated DESC`).all(projectId);
  const rows = [];
  for (const c of comps) {
    const snap = db
      .prepare(
        `SELECT extracted_json FROM competitor_intel_snapshots
         WHERE competitor_id = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(c.id);
    const ext = safeJsonParse(snap?.extracted_json || '{}', {});
    const p = ext.core_params || {};
    const metrics = [
      ['负载(kg)', own.payload_kg, p.payload_kg, p.payload_kg > own.payload_kg ? 'disadvantage' : 'advantage'],
      [
        '重复定位(mm)',
        own.repeatability_mm,
        p.repeatability_mm,
        own.repeatability_mm && p.repeatability_mm < own.repeatability_mm ? 'disadvantage' : 'advantage',
      ],
      ['防护等级', own.ip_rating, p.ip_rating, own.ip_rating === p.ip_rating ? 'neutral' : 'disadvantage'],
      ['续航(h)', own.battery_life_h, p.battery_life_h, p.battery_life_h > own.battery_life_h ? 'disadvantage' : 'advantage'],
    ];
    rows.push({ competitor: c, metrics, extracted: ext });
  }
  return { own, rows };
}

let crawlerStarted = false;
export function startCompetitorCrawlerJob() {
  if (crawlerStarted) return;
  crawlerStarted = true;
  setInterval(async () => {
    try {
      const cfgs = db
        .prepare(`SELECT * FROM competitor_crawl_configs WHERE enabled = 1`)
        .all();
      const now = Date.now();
      for (const c of cfgs) {
        const freq = Math.max(1, Number(c.frequency_hours || 24));
        const last = c.last_run_at ? new Date(c.last_run_at).getTime() : 0;
        if (!last || now - last >= freq * 3600 * 1000) {
          await runCrawl(c.project_id, 'timer');
        }
      }
    } catch {
      // ignore timer errors
    }
  }, 60 * 1000);
}

router.get('/', requireAuth, query('projectId').optional().isInt(), (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const pid = req.query.projectId;
    const rows = pid
      ? db.prepare(`SELECT * FROM competitors WHERE project_id = ? ORDER BY last_updated DESC, id DESC`).all(pid)
      : db.prepare(`SELECT * FROM competitors ORDER BY last_updated DESC`).all();
    res.json(rows);
  } catch (e) {
    sendServerError(res, e);
  }
});

router.post(
  '/',
  requireAuth,
  body('project_id').isInt(),
  body('name').trim().notEmpty(),
  body('website').optional({ nullable: true }).isString(),
  body('core_product_info').optional({ nullable: true }).isString(),
  body('model_or_line').optional().trim(),
  body('price_position').optional().trim(),
  body('key_features').optional(),
  body('gap_analysis').optional(),
  body('threat_level').optional().isIn(threatLevels),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const b = req.body;
      const info = db
        .prepare(
          `INSERT INTO competitors
          (project_id, name, website, core_product_info, model_or_line, price_position, key_features, gap_analysis, threat_level, last_updated)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        )
        .run(
          b.project_id,
          b.name,
          b.website ?? null,
          b.core_product_info ?? null,
          b.model_or_line ?? null,
          b.price_position ?? null,
          b.key_features ?? null,
          b.gap_analysis ?? null,
          b.threat_level || 'medium',
        );
      res.status(201).json(db.prepare(`SELECT * FROM competitors WHERE id = ?`).get(insertId(info)));
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.put(
  '/:id',
  requireAuth,
  param('id').isInt(),
  body('name').optional().trim().notEmpty(),
  body('website').optional({ nullable: true }).isString(),
  body('core_product_info').optional({ nullable: true }).isString(),
  body('model_or_line').optional({ nullable: true }).trim(),
  body('price_position').optional({ nullable: true }).trim(),
  body('key_features').optional({ nullable: true }),
  body('gap_analysis').optional({ nullable: true }),
  body('threat_level').optional().isIn(threatLevels),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const id = Number(req.params.id);
    const ex = db.prepare(`SELECT * FROM competitors WHERE id = ?`).get(id);
    if (!ex) return res.status(404).json({ message: '竞品记录不存在' });
    const n = { ...ex, ...req.body };
    try {
      db.prepare(
        `UPDATE competitors SET
          name=?, website=?, core_product_info=?, model_or_line=?, price_position=?, key_features=?,
          gap_analysis=?, threat_level=?, last_updated=datetime('now')
         WHERE id=?`,
      ).run(
        n.name,
        n.website ?? null,
        n.core_product_info ?? null,
        n.model_or_line ?? null,
        n.price_position ?? null,
        n.key_features ?? null,
        n.gap_analysis ?? null,
        n.threat_level || 'medium',
        id,
      );
      res.json(db.prepare(`SELECT * FROM competitors WHERE id = ?`).get(id));
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.delete('/:id', requireAuth, param('id').isInt(), (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const r = db.prepare(`DELETE FROM competitors WHERE id = ?`).run(req.params.id);
    if (changeCount(r) === 0) return res.status(404).json({ message: '竞品记录不存在' });
    res.status(204).send();
  } catch (e) {
    sendServerError(res, e);
  }
});

router.get('/crawl/config', requireAuth, query('projectId').isInt(), (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const row = db
      .prepare(`SELECT * FROM competitor_crawl_configs WHERE project_id = ?`)
      .get(req.query.projectId);
    res.json(
      row || {
        project_id: Number(req.query.projectId),
        frequency_hours: 24,
        source_websites_json: '[]',
        source_media_json: '[]',
        source_patents_json: '[]',
        enabled: 1,
      },
    );
  } catch (e) {
    sendServerError(res, e);
  }
});

router.put(
  '/crawl/config',
  requireAuth,
  body('project_id').isInt(),
  body('frequency_hours').optional().isInt({ min: 1, max: 168 }),
  body('source_websites').optional().isArray(),
  body('source_media').optional().isArray(),
  body('source_patents').optional().isArray(),
  body('enabled').optional().isBoolean(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const b = req.body;
      db.prepare(
        `INSERT INTO competitor_crawl_configs
        (project_id, frequency_hours, source_websites_json, source_media_json, source_patents_json, enabled, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(project_id) DO UPDATE SET
           frequency_hours = excluded.frequency_hours,
           source_websites_json = excluded.source_websites_json,
           source_media_json = excluded.source_media_json,
           source_patents_json = excluded.source_patents_json,
           enabled = excluded.enabled,
           updated_at = datetime('now')`,
      ).run(
        b.project_id,
        b.frequency_hours || 24,
        JSON.stringify(b.source_websites || []),
        JSON.stringify(b.source_media || []),
        JSON.stringify(b.source_patents || []),
        b.enabled === false ? 0 : 1,
      );
      res.json({ ok: true });
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.post('/crawl/run', requireAuth, body('project_id').isInt(), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const count = await runCrawl(Number(req.body.project_id), 'manual');
    res.json({ ok: true, created: count });
  } catch (e) {
    sendServerError(res, e);
  }
});

router.get(
  '/snapshots',
  requireAuth,
  query('projectId').isInt(),
  query('competitorId').optional().isInt(),
  query('sourceType').optional().isIn(sourceTypes),
  query('startDate').optional().isString(),
  query('endDate').optional().isString(),
  query('page').optional().isInt({ min: 1 }),
  query('pageSize').optional().isInt({ min: 1, max: 100 }),
  (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const page = Number(req.query.page || 1);
    const pageSize = Number(req.query.pageSize || 20);
    const offset = (page - 1) * pageSize;
    let where = ` WHERE s.project_id = ? `;
    const args = [req.query.projectId];
    if (req.query.competitorId) {
      where += ` AND s.competitor_id = ?`;
      args.push(req.query.competitorId);
    }
    if (req.query.sourceType) {
      where += ` AND s.source_type = ?`;
      args.push(req.query.sourceType);
    }
    if (req.query.startDate) {
      where += ` AND date(s.created_at) >= date(?)`;
      args.push(req.query.startDate);
    }
    if (req.query.endDate) {
      where += ` AND date(s.created_at) <= date(?)`;
      args.push(req.query.endDate);
    }
    const total = db
      .prepare(
        `SELECT COUNT(*) AS c
         FROM competitor_intel_snapshots s ${where}`,
      )
      .get(...args).c;
    const rows = db
      .prepare(
        `SELECT s.*, c.name AS competitor_name
         FROM competitor_intel_snapshots s
         LEFT JOIN competitors c ON c.id = s.competitor_id
         ${where}
         ORDER BY s.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...args, pageSize, offset)
      .map((r) => ({ ...r, extracted: safeJsonParse(r.extracted_json || '{}', {}) }));
    res.json({
      items: rows,
      pagination: {
        page,
        pageSize,
        total: Number(total || 0),
        totalPages: Math.max(1, Math.ceil(Number(total || 0) / pageSize)),
      },
    });
  } catch (e) {
    sendServerError(res, e);
  }
  },
);

router.get(
  '/crawl/logs',
  requireAuth,
  query('projectId').isInt(),
  query('startDate').optional().isString(),
  query('endDate').optional().isString(),
  query('page').optional().isInt({ min: 1 }),
  query('pageSize').optional().isInt({ min: 1, max: 100 }),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const page = Number(req.query.page || 1);
      const pageSize = Number(req.query.pageSize || 10);
      const offset = (page - 1) * pageSize;
      let where = ` WHERE project_id = ? `;
      const args = [req.query.projectId];
      if (req.query.startDate) {
        where += ` AND date(started_at) >= date(?)`;
        args.push(req.query.startDate);
      }
      if (req.query.endDate) {
        where += ` AND date(started_at) <= date(?)`;
        args.push(req.query.endDate);
      }
      const total = db
        .prepare(`SELECT COUNT(*) AS c FROM competitor_crawl_logs ${where}`)
        .get(...args).c;
      const items = db
        .prepare(
          `SELECT * FROM competitor_crawl_logs
           ${where}
           ORDER BY id DESC
           LIMIT ? OFFSET ?`,
        )
        .all(...args, pageSize, offset);
      res.json({
        items,
        pagination: {
          page,
          pageSize,
          total: Number(total || 0),
          totalPages: Math.max(1, Math.ceil(Number(total || 0) / pageSize)),
        },
      });
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.put(
  '/own-product-spec',
  requireAuth,
  body('project_id').isInt(),
  body('product_name').optional({ nullable: true }).isString(),
  body('payload_kg').optional({ nullable: true }).isFloat(),
  body('repeatability_mm').optional({ nullable: true }).isFloat(),
  body('ip_rating').optional({ nullable: true }).isString(),
  body('battery_life_h').optional({ nullable: true }).isFloat(),
  body('price_cny').optional({ nullable: true }).isFloat(),
  body('notes').optional({ nullable: true }).isString(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const b = req.body;
      db.prepare(
        `INSERT INTO project_product_specs
        (project_id, product_name, payload_kg, repeatability_mm, ip_rating, battery_life_h, price_cny, notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(project_id) DO UPDATE SET
           product_name=excluded.product_name, payload_kg=excluded.payload_kg,
           repeatability_mm=excluded.repeatability_mm, ip_rating=excluded.ip_rating,
           battery_life_h=excluded.battery_life_h, price_cny=excluded.price_cny, notes=excluded.notes,
           updated_at=datetime('now')`,
      ).run(
        b.project_id,
        b.product_name ?? null,
        b.payload_kg ?? null,
        b.repeatability_mm ?? null,
        b.ip_rating ?? null,
        b.battery_life_h ?? null,
        b.price_cny ?? null,
        b.notes ?? null,
      );
      res.json({ ok: true });
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.get('/compare', requireAuth, query('projectId').isInt(), (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    res.json(computeComparison(Number(req.query.projectId)));
  } catch (e) {
    sendServerError(res, e);
  }
});

router.get('/report', requireAuth, query('projectId').isInt(), (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const cmp = computeComparison(Number(req.query.projectId));
    const lines = [];
    for (const r of cmp.rows) {
      const rel = r.metrics.filter((m) => m[3] === 'disadvantage').map((m) => m[0]);
      lines.push({
        competitor: r.competitor.name,
        highlights: (r.extracted.market_moves || []).slice(0, 3),
        price_dynamic: r.extracted.price_dynamic || '',
        risk_points: rel,
        suggestions: (r.extracted.iteration_suggestions || []).slice(0, 3),
      });
    }
    res.json({ own: cmp.own, analysis: lines });
  } catch (e) {
    sendServerError(res, e);
  }
});

router.get('/report/pdf', requireAuth, query('projectId').isInt(), (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const projectId = Number(req.query.projectId);
    const project = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId);
    const report = (() => {
      const cmp = computeComparison(projectId);
      const lines = [];
      for (const r of cmp.rows) {
        const rel = r.metrics.filter((m) => m[3] === 'disadvantage').map((m) => m[0]);
        lines.push({
          competitor: r.competitor.name,
          price_dynamic: r.extracted.price_dynamic || '',
          risk_points: rel,
          suggestions: (r.extracted.iteration_suggestions || []).slice(0, 3),
        });
      }
      return { own: cmp.own, analysis: lines };
    })();

    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=competitor_report_${projectId}_${new Date().toISOString().slice(0, 10)}.pdf`,
    );
    safePdfFont(doc);
    doc.pipe(res);
    doc.fontSize(16).text('竞品动态分析报告');
    doc.moveDown(0.5);
    doc.fontSize(11).text(`项目：${project?.name || projectId}`);
    doc.text(`生成时间：${new Date().toLocaleString('zh-CN')}`);
    doc.moveDown(0.5);
    doc.fontSize(10).text(
      `我方参数：负载 ${report.own.payload_kg ?? '—'}kg；重复定位 ${report.own.repeatability_mm ?? '—'}mm；防护 ${report.own.ip_rating || '—'}；续航 ${report.own.battery_life_h ?? '—'}h`,
    );
    doc.moveDown(0.8);
    for (const r of report.analysis || []) {
      doc.fontSize(11).text(`【${r.competitor}】`);
      doc.fontSize(10).text(`价格动态：${r.price_dynamic || '—'}`);
      doc.text(`风险点：${(r.risk_points || []).join(' / ') || '—'}`);
      for (const s of r.suggestions || []) {
        doc.text(`- 建议：${s.title || ''} ${s.detail || ''}`);
      }
      doc.moveDown(0.5);
    }
    doc.end();
  } catch (e) {
    sendServerError(res, e);
  }
});

router.post(
  '/suggestions/to-task',
  requireAuth,
  body('project_id').isInt(),
  body('title').trim().notEmpty(),
  body('detail').optional().isString(),
  body('priority').optional().isIn(['low', 'medium', 'high', 'critical']),
  body('status').optional().isIn(nodeStatus),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const info = db
        .prepare(
          `INSERT INTO tasks (project_id, title, description, status, priority, reporter_id, progress)
           VALUES (?, ?, ?, ?, ?, ?, 0)`,
        )
        .run(
          req.body.project_id,
          `[竞品建议] ${req.body.title}`,
          req.body.detail || '来自竞品分析建议',
          req.body.status || 'todo',
          req.body.priority || 'medium',
          req.user.id,
        );
      res.status(201).json(db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(insertId(info)));
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

router.post(
  '/qa',
  requireAuth,
  body('project_id').isInt(),
  body('question').trim().notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const rows = db
        .prepare(
          `SELECT title, content FROM knowledge_docs
           WHERE project_id = ? AND title LIKE '竞品%'
           ORDER BY id DESC LIMIT 12`,
        )
        .all(req.body.project_id);
      const context = rows.map((r) => `${r.title}\n${String(r.content).slice(0, 1000)}`).join('\n\n');
      const prompt = `请根据竞品动态上下文回答问题，无法确定请明确说明。\n上下文：\n${context}\n\n问题：${req.body.question}`;
      const rag = await queryKnowledgeBase({ query: prompt, topK: 6, context });
      res.json({
        ok: true,
        answer: rag.ok && rag.answer ? rag.answer : '未检索到明确答案，请先执行竞品抓取并检查 RAG 配置。',
      });
    } catch (e) {
      sendServerError(res, e);
    }
  },
);

export default router;
