/**
 * 首次启动时写入默认管理员与示例项目数据（便于本地演示）
 */
import bcrypt from 'bcryptjs';
import { db, insertId } from './db.js';

const DEFAULT_ADMIN_USER = 'admin';
const DEFAULT_ADMIN_PASS = 'admin123';

export function seedIfEmpty() {
  const row = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  if (row.c > 0) return;

  const hash = bcrypt.hashSync(DEFAULT_ADMIN_PASS, 10);
  db.prepare(
    `INSERT INTO users (username, password_hash, email, full_name, role)
     VALUES (?, ?, ?, ?, 'admin')`
  ).run(DEFAULT_ADMIN_USER, hash, 'admin@example.com', '系统管理员');

  const adminId = db.prepare('SELECT id FROM users WHERE username = ?').get(
    DEFAULT_ADMIN_USER
  ).id;

  const info = db.prepare(
    `INSERT INTO projects (name, description, product_line, status, start_date, budget_note)
     VALUES (?, ?, ?, 'active', date('now'), ?)`
  ).run(
    '六轴协作机器人 X1 研发项目',
    '单产品线全生命周期管理示例：结构、电控、软件、试产与认证。',
    '协作机器人',
    '预算与成本在 MVP 阶段仅作备注字段，后续可扩展子表。'
  );
  const projectId = insertId(info);

  db.prepare(
    `INSERT INTO project_members (project_id, user_id, role_in_project) VALUES (?, ?, 'pm')`
  ).run(projectId, adminId);

  const phaseRows = [
    ['EVT — 工程验证试产', 'evt', 10],
    ['DVT — 设计验证试产', 'dvt', 20],
    ['PVT — 制程验证试产', 'pvt', 30],
    ['MP — 量产导入', 'mp', 40],
  ];
  let evtMilestoneId = null;
  for (const [pname, ptmpl, ord] of phaseRows) {
    const mi = db
      .prepare(
        `INSERT INTO plan_milestones (project_id, name, phase_template, target_date, status, description, sort_order)
         VALUES (?, ?, ?, NULL, 'planned', NULL, ?)`,
      )
      .run(projectId, pname, ptmpl, ord);
    const mid = insertId(mi);
    if (ptmpl === 'evt') evtMilestoneId = mid;
  }

  const rootInfo = db
    .prepare(
      `INSERT INTO tasks (project_id, title, status, priority, assignee_id, reporter_id, start_date, end_date, due_date, progress, sort_order)
       VALUES (?, ?, 'in_progress', 'high', ?, ?, date('now'), date('now', '+120 day'), date('now', '+120 day'), 5, 0)`,
    )
    .run(projectId, '整机研发 WBS（根节点）', adminId, adminId);
  const rootTaskId = insertId(rootInfo);

  db.prepare(
    `INSERT INTO tasks (project_id, title, status, priority, assignee_id, reporter_id, parent_id, milestone_id, start_date, end_date, due_date, progress, sort_order)
     VALUES (?, ?, 'in_progress', 'high', ?, ?, ?, ?, date('now'), date('now', '+14 day'), date('now', '+14 day'), 35, 1)`,
  ).run(
    projectId,
    '完成整机BOM冻结与供应商短名单',
    adminId,
    adminId,
    rootTaskId,
    evtMilestoneId,
  );

  db.prepare(
    `INSERT INTO reviews (project_id, title, review_type, status, lead_reviewer_id, review_date, conclusion)
     VALUES (?, ?, 'design', 'scheduled', ?, date('now', '+7 day'), NULL)`
  ).run(projectId, 'DFM/DFA 设计评审 — 减速器与关节模组', adminId);

  db.prepare(
    `INSERT INTO contracts (project_id, title, counterparty, amount, currency, status, effective_date)
     VALUES (?, ?, ?, 1280000, 'CNY', 'negotiating', NULL)`
  ).run(projectId, '核心伺服驱动器框架协议', '某伺服技术供应商');

  db.prepare(
    `INSERT INTO kpi_records (project_id, user_id, metric_name, metric_unit, period_year, period_month, target_value, actual_value, score)
     VALUES (?, ?, '里程碑准时率', '%', CAST(strftime('%Y','now') AS INT), CAST(strftime('%m','now') AS INT), 90, 85, 85)`
  ).run(projectId, adminId);

  db.prepare(
    `INSERT INTO competitors (project_id, name, model_or_line, price_position, key_features, gap_analysis, threat_level)
     VALUES (?, ?, ?, ?, ?, ?, 'high')`
  ).run(
    projectId,
    '竞品A公司',
    'C系列 10kg',
    '定价高于我方预估15%',
    '生态成熟、海外渠道强',
    '我方在核心零部件自主化上有优势，需补强应用软件插件市场',
  );

  console.log(
    '[seed] 已创建默认管理员账号: 用户名 admin / 密码 admin123 （首次启动仅执行一次，请及时修改密码）'
  );
}
