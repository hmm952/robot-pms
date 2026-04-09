/**
 * SQLite 数据库（Node.js 内置 node:sqlite / DatabaseSync）
 * 无需原生编译，在 Node.js 22.5+（推荐 24 LTS）下直接可用。
 * 表结构覆盖：用户权限、项目、任务、评审、合同、KPI、竞品分析
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dbPath =
  process.env.DATABASE_PATH ||
  path.join(__dirname, '..', 'data', 'robot_pms.db');

const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
db.exec(`PRAGMA journal_mode = WAL;`);

/** INSERT 后将 lastInsertRowid 转为 number（兼容 bigint） */
export function insertId(runResult) {
  const id = runResult.lastInsertRowid;
  return typeof id === 'bigint' ? Number(id) : id;
}

/** DELETE/UPDATE 后统一读取受影响行数（兼容 bigint） */
export function changeCount(runResult) {
  const c = runResult.changes;
  return typeof c === 'bigint' ? Number(c) : c;
}

/** 初始化完整表结构（幂等：仅 CREATE IF NOT EXISTS） */
function runMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      email TEXT,
      full_name TEXT,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      product_line TEXT DEFAULT '工业机器人',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('planning', 'active', 'on_hold', 'completed', 'cancelled')),
      start_date TEXT,
      end_date TEXT,
      budget_note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_in_project TEXT DEFAULT 'member',
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'blocked', 'done')),
      priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
      assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      due_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      review_type TEXT NOT NULL DEFAULT 'design' CHECK (review_type IN ('design', 'process', 'safety', 'quality', 'milestone', 'other')),
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'passed', 'conditional', 'rejected', 'cancelled')),
      lead_reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      review_date TEXT,
      conclusion TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      counterparty TEXT NOT NULL,
      contract_type TEXT DEFAULT 'procurement',
      amount REAL,
      currency TEXT DEFAULT 'CNY',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'negotiating', 'signed', 'executing', 'closed', 'terminated')),
      effective_date TEXT,
      expiry_date TEXT,
      document_ref TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS kpi_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      metric_name TEXT NOT NULL,
      metric_unit TEXT,
      period_year INTEGER NOT NULL,
      period_month INTEGER NOT NULL CHECK (period_month >= 1 AND period_month <= 12),
      target_value REAL,
      actual_value REAL,
      score REAL,
      comment TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, user_id, metric_name, period_year, period_month)
    );

    CREATE TABLE IF NOT EXISTS competitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      website TEXT,
      core_product_info TEXT,
      model_or_line TEXT,
      price_position TEXT,
      key_features TEXT,
      gap_analysis TEXT,
      threat_level TEXT DEFAULT 'medium' CHECK (threat_level IN ('low', 'medium', 'high')),
      last_updated TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_project ON reviews(project_id);
    CREATE INDEX IF NOT EXISTS idx_contracts_project ON contracts(project_id);
    CREATE INDEX IF NOT EXISTS idx_kpi_project ON kpi_records(project_id);
    CREATE INDEX IF NOT EXISTS idx_competitors_project ON competitors(project_id);
  `);
}

/** 计划 / 里程碑 / WBS / 外部联动预留（会议纪要、评审、邮件） */
function migratePlanModule() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plan_milestones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      phase_template TEXT NOT NULL DEFAULT 'custom' CHECK (phase_template IN ('evt', 'dvt', 'pvt', 'mp', 'custom')),
      target_date TEXT,
      status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'achieved', 'delayed', 'cancelled')),
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS task_external_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      link_type TEXT NOT NULL CHECK (link_type IN ('meeting', 'review', 'email', 'other')),
      ref_id TEXT,
      ref_title TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_plan_milestones_project ON plan_milestones(project_id);
    CREATE INDEX IF NOT EXISTS idx_task_links_task ON task_external_links(task_id);
  `);

  // 任务与待办模块（备注/附件/提醒预留）
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS task_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      uploader_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT,
      file_size INTEGER,
      storage_path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id);
    CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(task_id);
  `);

  // 硬件产品全阶段评审管理模块（专家打分、问题闭环、报告与里程碑联动）
  db.exec(`
    CREATE TABLE IF NOT EXISTS review_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phase_template TEXT NOT NULL DEFAULT 'custom' CHECK (phase_template IN ('evt', 'dvt', 'pvt', 'mp', 'custom')),
      name TEXT NOT NULL,
      steps_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS review_experts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0,1)),
      status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'submitted')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(review_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS review_expert_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_expert_id INTEGER NOT NULL REFERENCES review_experts(id) ON DELETE CASCADE,
      score REAL,
      opinion TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(review_expert_id)
    );

    CREATE TABLE IF NOT EXISTS review_issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
      creator_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT,
      severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','closed','converted')),
      converted_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS review_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
      uploader_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT,
      file_size INTEGER,
      storage_path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS review_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE UNIQUE,
      report_text TEXT,
      report_data_json TEXT,
      generated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_review_experts_review ON review_experts(review_id);
    CREATE INDEX IF NOT EXISTS idx_review_issues_review ON review_issues(review_id);
    CREATE INDEX IF NOT EXISTS idx_review_attachments_review ON review_attachments(review_id);
  `);

  // 人力负载（工时填报/部门） + KPI 自动核算（指标库/报告）
  db.exec(`
    CREATE TABLE IF NOT EXISTS departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
      title TEXT,
      capacity_hours_per_day REAL NOT NULL DEFAULT 8,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id)
    );

    CREATE TABLE IF NOT EXISTS worklog_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      work_date TEXT NOT NULL, -- YYYY-MM-DD
      hours REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, user_id, work_date)
    );

    CREATE INDEX IF NOT EXISTS idx_worklog_project_date ON worklog_entries(project_id, work_date);
    CREATE INDEX IF NOT EXISTS idx_worklog_user_date ON worklog_entries(user_id, work_date);

    CREATE TABLE IF NOT EXISTS kpi_metric_defs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      metric_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      unit TEXT,
      weight REAL NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS kpi_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      period_year INTEGER NOT NULL,
      period_month INTEGER NOT NULL CHECK (period_month >= 1 AND period_month <= 12),
      generated_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      summary_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, period_year, period_month)
    );

    CREATE INDEX IF NOT EXISTS idx_kpi_reports_project_period ON kpi_reports(project_id, period_year, period_month);

    CREATE TABLE IF NOT EXISTS integration_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS meeting_minutes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'text' CHECK (source_type IN ('text','docx','pdf','txt')),
      file_name TEXT,
      storage_path TEXT,
      raw_text TEXT NOT NULL,
      parsed_json TEXT,
      status TEXT NOT NULL DEFAULT 'parsed' CHECK (status IN ('parsed','confirmed','synced')),
      created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS risk_register (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      meeting_id INTEGER REFERENCES meeting_minutes(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT,
      impact_level TEXT NOT NULL DEFAULT 'medium' CHECK (impact_level IN ('low','medium','high')),
      mitigation TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','monitoring','closed')),
      warning_triggered INTEGER NOT NULL DEFAULT 0 CHECK (warning_triggered IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS knowledge_docs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL DEFAULT 'meeting' CHECK (source_type IN ('meeting','review','task','other')),
      source_id INTEGER,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_meeting_project ON meeting_minutes(project_id);
    CREATE INDEX IF NOT EXISTS idx_risk_project ON risk_register(project_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_project ON knowledge_docs(project_id);

    CREATE TABLE IF NOT EXISTS contract_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      version_no INTEGER NOT NULL,
      file_name TEXT,
      storage_path TEXT,
      raw_text TEXT,
      parsed_json TEXT,
      created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(contract_id, version_no)
    );

    CREATE TABLE IF NOT EXISTS contract_payment_nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      amount REAL,
      due_date TEXT NOT NULL,
      milestone_id INTEGER REFERENCES plan_milestones(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','paid','delayed','cancelled')),
      reminder_sent INTEGER NOT NULL DEFAULT 0 CHECK (reminder_sent IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS contract_deliverables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      requirement TEXT,
      due_date TEXT,
      linked_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      check_status TEXT NOT NULL DEFAULT 'pending' CHECK (check_status IN ('pending','matched','unmatched')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS contract_change_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      change_title TEXT NOT NULL,
      change_content TEXT NOT NULL,
      impact_scope TEXT,
      plan_adjustment TEXT,
      linked_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS contract_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      payment_node_id INTEGER REFERENCES contract_payment_nodes(id) ON DELETE CASCADE,
      notify_type TEXT NOT NULL CHECK (notify_type IN ('payment_apply','delivery_warn','other')),
      title TEXT NOT NULL,
      body TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','sent','closed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_contract_versions_contract ON contract_versions(contract_id);
    CREATE INDEX IF NOT EXISTS idx_contract_payment_contract ON contract_payment_nodes(contract_id);
    CREATE INDEX IF NOT EXISTS idx_contract_deliverable_contract ON contract_deliverables(contract_id);
    CREATE INDEX IF NOT EXISTS idx_contract_change_contract ON contract_change_logs(contract_id);
    CREATE INDEX IF NOT EXISTS idx_contract_notify_contract ON contract_notifications(contract_id);

    CREATE TABLE IF NOT EXISTS competitor_crawl_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
      frequency_hours INTEGER NOT NULL DEFAULT 24,
      source_websites_json TEXT,
      source_media_json TEXT,
      source_patents_json TEXT,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
      last_run_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS competitor_intel_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      competitor_id INTEGER REFERENCES competitors(id) ON DELETE CASCADE,
      source_url TEXT,
      source_type TEXT NOT NULL DEFAULT 'website' CHECK (source_type IN ('website','media','patent','manual')),
      title TEXT,
      raw_text TEXT,
      extracted_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS competitor_crawl_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      trigger_type TEXT NOT NULL DEFAULT 'manual' CHECK (trigger_type IN ('manual','timer')),
      status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','failed')),
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      created_count INTEGER NOT NULL DEFAULT 0,
      message TEXT
    );

    CREATE TABLE IF NOT EXISTS notification_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'custom',
      subject_template TEXT NOT NULL,
      body_template TEXT NOT NULL,
      is_builtin INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0,1)),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notification_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL CHECK (event_type IN ('task_overdue','review_reminder','payment_reminder','milestone_warning')),
      template_code TEXT NOT NULL REFERENCES notification_templates(code) ON DELETE RESTRICT,
      offset_days INTEGER NOT NULL DEFAULT 1,
      recipient_mode TEXT NOT NULL DEFAULT 'auto' CHECK (recipient_mode IN ('auto','manual')),
      manual_recipients TEXT,
      channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email','wecom','dingtalk')),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notification_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      rule_id INTEGER REFERENCES notification_rules(id) ON DELETE SET NULL,
      template_code TEXT,
      channel TEXT NOT NULL DEFAULT 'email',
      to_recipients TEXT,
      subject TEXT,
      body TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
      provider_message_id TEXT,
      error_message TEXT,
      sent_at TEXT,
      reply_status TEXT NOT NULL DEFAULT 'unknown' CHECK (reply_status IN ('unknown','replied','no_reply')),
      reply_note TEXT,
      dedupe_key TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_product_specs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
      product_name TEXT,
      payload_kg REAL,
      repeatability_mm REAL,
      ip_rating TEXT,
      battery_life_h REAL,
      price_cny REAL,
      notes TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_competitor_crawl_project ON competitor_crawl_configs(project_id);
    CREATE INDEX IF NOT EXISTS idx_competitor_snapshot_project ON competitor_intel_snapshots(project_id);
    CREATE INDEX IF NOT EXISTS idx_competitor_snapshot_comp ON competitor_intel_snapshots(competitor_id);
    CREATE INDEX IF NOT EXISTS idx_competitor_crawl_logs_project ON competitor_crawl_logs(project_id);
    CREATE INDEX IF NOT EXISTS idx_product_specs_project ON project_product_specs(project_id);
    CREATE INDEX IF NOT EXISTS idx_notify_tpl_code ON notification_templates(code);
    CREATE INDEX IF NOT EXISTS idx_notify_rule_project ON notification_rules(project_id);
    CREATE INDEX IF NOT EXISTS idx_notify_history_project ON notification_history(project_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_notify_history_dedupe ON notification_history(dedupe_key);
  `);

  const names = new Set(
    db.prepare('PRAGMA table_info(tasks)').all().map((c) => c.name),
  );
  const addCol = (sql) => {
    try {
      db.exec(sql);
    } catch (e) {
      if (!String(e.message).includes('duplicate column')) throw e;
    }
  };
  if (!names.has('parent_id')) addCol('ALTER TABLE tasks ADD COLUMN parent_id INTEGER');
  if (!names.has('milestone_id')) addCol('ALTER TABLE tasks ADD COLUMN milestone_id INTEGER');
  if (!names.has('start_date')) addCol('ALTER TABLE tasks ADD COLUMN start_date TEXT');
  if (!names.has('end_date')) addCol('ALTER TABLE tasks ADD COLUMN end_date TEXT');
  if (!names.has('progress')) addCol('ALTER TABLE tasks ADD COLUMN progress REAL DEFAULT 0');
  if (!names.has('sort_order')) addCol('ALTER TABLE tasks ADD COLUMN sort_order INTEGER DEFAULT 0');
  if (!names.has('reminder_days_before'))
    addCol('ALTER TABLE tasks ADD COLUMN reminder_days_before INTEGER DEFAULT 3');
  if (!names.has('escalation_level'))
    addCol('ALTER TABLE tasks ADD COLUMN escalation_level INTEGER DEFAULT 0');

  const competitorNames = new Set(
    db.prepare('PRAGMA table_info(competitors)').all().map((c) => c.name),
  );
  if (!competitorNames.has('website'))
    addCol('ALTER TABLE competitors ADD COLUMN website TEXT');
  if (!competitorNames.has('core_product_info'))
    addCol('ALTER TABLE competitors ADD COLUMN core_product_info TEXT');

  // reviews 表新增评审模块字段（workflow_state / 模板阶段 / 目标里程碑等）
  const reviewNames = new Set(
    db.prepare('PRAGMA table_info(reviews)').all().map((c) => c.name),
  );
  if (!reviewNames.has('template_phase'))
    addCol('ALTER TABLE reviews ADD COLUMN template_phase TEXT');
  if (!reviewNames.has('workflow_state'))
    addCol('ALTER TABLE reviews ADD COLUMN workflow_state TEXT NOT NULL DEFAULT \'experts_reviewing\'');
  if (!reviewNames.has('target_milestone_id'))
    addCol('ALTER TABLE reviews ADD COLUMN target_milestone_id INTEGER');
  if (!reviewNames.has('workflow_steps_json'))
    addCol('ALTER TABLE reviews ADD COLUMN workflow_steps_json TEXT');
  if (!reviewNames.has('created_by_id'))
    addCol('ALTER TABLE reviews ADD COLUMN created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL');

  // 内置 EVT/DVT/PVT/MP 评审模板（仅当 review_templates 为空时写入一次）
  const tplRow = db.prepare('SELECT COUNT(*) AS c FROM review_templates').get();
  if (tplRow.c === 0) {
    const insert = db.prepare(
      `INSERT INTO review_templates (phase_template, name, steps_json)
       VALUES (?, ?, ?)`,
    );
    const defaultSteps = [
      { key: 'experts_scoring', name: '专家打分与意见', required: true },
      { key: 'issue_tracking', name: '问题闭环与转任务', required: true },
      { key: 'report', name: '生成评审报告', required: true },
    ];
    insert.run('evt', 'EVT 全阶段评审模板', JSON.stringify(defaultSteps));
    insert.run('dvt', 'DVT 全阶段评审模板', JSON.stringify(defaultSteps));
    insert.run('pvt', 'PVT 全阶段评审模板', JSON.stringify(defaultSteps));
    insert.run('mp', 'MP 全阶段评审模板', JSON.stringify(defaultSteps));
    insert.run('custom', '自定义评审流程模板', JSON.stringify(defaultSteps));
  }

  // KPI 指标库默认值（仅当 kpi_metric_defs 为空时写入一次）
  const kpiDefRow = db.prepare('SELECT COUNT(*) AS c FROM kpi_metric_defs').get();
  if (kpiDefRow.c === 0) {
    const ins = db.prepare(
      `INSERT INTO kpi_metric_defs (metric_key, name, unit, weight, enabled, description)
       VALUES (?, ?, ?, ?, 1, ?)`,
    );
    ins.run('task_completion_rate', '任务完成率', '%', 1, '当月到期任务中已完成占比（可按人/按项目）');
    ins.run('review_pass_rate', '评审通过率', '%', 1, '当月评审中通过/有条件通过占比（按项目）');
    ins.run('schedule_achievement_rate', '进度达成率', '%', 1, '当月目标里程碑达成占比（按项目）');
    ins.run('defect_closure_rate', '缺陷闭环率', '%', 1, '当月评审问题已闭环（closed/converted）占比（按项目）');
  }

  // 默认部门（演示用）
  const deptRow = db.prepare('SELECT COUNT(*) AS c FROM departments').get();
  if (deptRow.c === 0) {
    const ins = db.prepare(`INSERT INTO departments (name) VALUES (?)`);
    ins.run('项目管理部');
    ins.run('机械结构部');
    ins.run('电控硬件部');
    ins.run('嵌入式软件部');
    ins.run('工艺与试产部');
    ins.run('质量与认证部');
  }

  const tplRow2 = db.prepare('SELECT COUNT(*) AS c FROM notification_templates').get();
  if (tplRow2.c === 0) {
    const insTpl = db.prepare(
      `INSERT INTO notification_templates
      (code, name, category, subject_template, body_template, is_builtin, enabled)
       VALUES (?, ?, ?, ?, ?, 1, 1)`,
    );
    insTpl.run(
      'production_urge',
      '生产催办',
      'production',
      '【生产催办】{{project_name}} - {{task_title}}',
      '项目：{{project_name}}\n任务：{{task_title}}\n责任人：{{assignee_name}}\n截止时间：{{due_date}}\n当前进度：{{progress}}%\n系统链接：{{system_link}}',
    );
    insTpl.run(
      'test_fix_urge',
      '测试催改',
      'test',
      '【测试催改】{{project_name}} - {{task_title}}',
      '项目：{{project_name}}\n测试整改项：{{task_title}}\n责任人：{{assignee_name}}\n截止时间：{{due_date}}\n延迟天数：{{delay_days}}\n系统链接：{{system_link}}',
    );
    insTpl.run(
      'review_reminder',
      '评审提醒',
      'review',
      '【评审提醒】{{project_name}} - {{review_title}}',
      '项目：{{project_name}}\n评审主题：{{review_title}}\n评审时间：{{review_date}}\n负责人：{{assignee_name}}\n系统链接：{{system_link}}',
    );
    insTpl.run(
      'payment_reminder',
      '付款提醒',
      'contract',
      '【付款提醒】{{project_name}} - {{payment_title}}',
      '项目：{{project_name}}\n付款节点：{{payment_title}}\n到期时间：{{due_date}}\n金额：{{amount}}\n系统链接：{{system_link}}',
    );
    insTpl.run(
      'milestone_warning',
      '里程碑预警',
      'milestone',
      '【里程碑预警】{{project_name}} - {{milestone_name}}',
      '项目：{{project_name}}\n里程碑：{{milestone_name}}\n目标日期：{{due_date}}\n延迟天数：{{delay_days}}\n系统链接：{{system_link}}',
    );
    insTpl.run(
      'overdue_warning',
      '逾期预警',
      'task',
      '【逾期预警】{{project_name}} - {{task_title}}',
      '项目：{{project_name}}\n任务：{{task_title}}\n责任人：{{assignee_name}}\n截止时间：{{due_date}}\n当前进度：{{progress}}%\n延迟天数：{{delay_days}}\n系统链接：{{system_link}}',
    );
  }

  // 修复：如果 plan_milestones 为空，则自动补齐 EVT/DVT/PVT/MP
  // 目的是确保评审结果归档时可以同步到目标里程碑，并影响项目进度。
  const msRow = db.prepare('SELECT COUNT(*) AS c FROM plan_milestones').get();
  if (msRow.c === 0) {
    const projectIds = db.prepare('SELECT id FROM projects').all().map((p) => p.id);
    const phaseDefaults = [
      { phase_template: 'evt', name: 'EVT — 工程验证试产', sort_order: 10 },
      { phase_template: 'dvt', name: 'DVT — 设计验证试产', sort_order: 20 },
      { phase_template: 'pvt', name: 'PVT — 制程验证试产', sort_order: 30 },
      { phase_template: 'mp', name: 'MP — 量产导入', sort_order: 40 },
    ];
    for (const projectId of projectIds) {
      for (const ph of phaseDefaults) {
        db.prepare(
          `INSERT INTO plan_milestones (project_id, name, phase_template, target_date, status, description, sort_order)
           VALUES (?, ?, ?, NULL, 'planned', NULL, ?)`,
        ).run(projectId, ph.name, ph.phase_template, ph.sort_order);
      }
    }
  }

  db.exec(`
    UPDATE tasks SET end_date = due_date
    WHERE (end_date IS NULL OR end_date = '') AND due_date IS NOT NULL AND due_date != '';
  `);
}

runMigrations();
migratePlanModule();

export { db, runMigrations, migratePlanModule };
