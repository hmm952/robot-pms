/**
 * WBS 进度汇总、逾期判断、展示用起止日期（与计划/甘特模块联动）
 */
import { db } from '../db.js';

function statusToProgress(status) {
  switch (status) {
    case 'done':
      return 100;
    case 'in_progress':
      return 50;
    case 'blocked':
      return 25;
    default:
      return 0;
  }
}

function leafEffectiveProgress(t) {
  if (t.progress != null && t.progress !== '') {
    const n = Number(t.progress);
    return Math.min(100, Math.max(0, Number.isFinite(n) ? n : 0));
  }
  return statusToProgress(t.status);
}

/**
 * 为任务列表附加 computed_progress、display_start、display_end、is_overdue
 * @param {Array<Record<string, unknown>>} rows
 */
export function enrichPlanTasks(rows) {
  const byId = Object.fromEntries(rows.map((r) => [r.id, { ...r }]));
  const childrenByParent = {};
  for (const r of rows) {
    const pid = r.parent_id ?? 0;
    if (!childrenByParent[pid]) childrenByParent[pid] = [];
    childrenByParent[pid].push(r.id);
  }

  function computedProgress(id) {
    const kids = childrenByParent[id] || [];
    if (!kids.length) return leafEffectiveProgress(byId[id]);
    const sum = kids.reduce((s, cid) => s + computedProgress(cid), 0);
    return Math.round(sum / kids.length);
  }

  function displayDates(id) {
    const t = byId[id];
    const kids = childrenByParent[id] || [];
    if (!kids.length) {
      return {
        display_start: t.start_date || null,
        display_end: t.end_date || t.due_date || null,
      };
    }
    let minS = null;
    let maxE = null;
    for (const cid of kids) {
      const { display_start: ds, display_end: de } = displayDates(cid);
      if (ds && (!minS || ds < minS)) minS = ds;
      if (de && (!maxE || de > maxE)) maxE = de;
    }
    return {
      display_start: minS || t.start_date || null,
      display_end: maxE || t.end_date || t.due_date || null,
    };
  }

  return rows.map((r) => {
    const { display_start, display_end } = displayDates(r.id);
    const cp = computedProgress(r.id);
    let isOverdue = false;
    if (byId[r.id].status !== 'done' && display_end) {
      const d = new Date(`${display_end}T12:00:00`);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (d < today) isOverdue = true;
    }
    return {
      ...byId[r.id],
      computed_progress: cp,
      display_start,
      display_end,
      is_overdue: isOverdue,
    };
  });
}

function listChildIdsRecursive(parentId) {
  const out = [];
  const stack = [parentId];
  while (stack.length) {
    const id = stack.pop();
    const kids = db.prepare('SELECT id FROM tasks WHERE parent_id = ?').all(id);
    for (const k of kids) {
      out.push(k.id);
      stack.push(k.id);
    }
  }
  return out;
}

export function deleteTaskWithDescendants(taskId) {
  const ids = [taskId, ...listChildIdsRecursive(taskId)];
  ids.reverse();
  for (const id of ids) {
    db.prepare('DELETE FROM task_external_links WHERE task_id = ?').run(id);
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  }
}

export function effectiveProgressDb(id) {
  const kids = db.prepare('SELECT id FROM tasks WHERE parent_id = ?').all(id);
  if (kids.length) {
    const sum = kids.reduce((s, k) => s + effectiveProgressDb(k.id), 0);
    return Math.round(sum / kids.length);
  }
  const t = db.prepare('SELECT progress, status FROM tasks WHERE id = ?').get(id);
  if (!t) return 0;
  return leafEffectiveProgress(t);
}

/** 父节点 progress 与祖先链汇总（子任务变更后调用） */
export function rollupAncestorProgress(taskId) {
  let row = db.prepare('SELECT parent_id FROM tasks WHERE id = ?').get(taskId);
  let pid = row?.parent_id ?? null;
  while (pid) {
    const children = db.prepare('SELECT id FROM tasks WHERE parent_id = ?').all(pid);
    if (!children.length) break;
    const sum = children.reduce((s, { id }) => s + effectiveProgressDb(id), 0);
    const avg = Math.round(sum / children.length);
    db.prepare(
      `UPDATE tasks SET progress = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(avg, pid);
    const pRow = db.prepare('SELECT parent_id FROM tasks WHERE id = ?').get(pid);
    pid = pRow?.parent_id ?? null;
  }
}
