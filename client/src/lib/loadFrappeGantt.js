/**
 * 动态加载 public/gantt 下的 Frappe Gantt（UMD 挂载到 window.Gantt）
 */
let loadPromise;

export function loadFrappeGantt() {
  if (typeof window !== 'undefined' && window.Gantt) {
    return Promise.resolve(window.Gantt);
  }
  if (loadPromise) return loadPromise.then(() => window.Gantt);

  loadPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[href="/gantt/frappe-gantt.css"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/gantt/frappe-gantt.css';
      document.head.appendChild(link);
    }
    if (window.Gantt) {
      resolve(window.Gantt);
      return;
    }
    const existing = document.querySelector('script[data-frappe-gantt="1"]');
    if (existing) {
      const done = () => (window.Gantt ? resolve(window.Gantt) : reject(new Error('Gantt 未挂载')));
      if (window.Gantt) {
        resolve(window.Gantt);
        return;
      }
      existing.addEventListener('load', done);
      existing.addEventListener('error', reject);
      return;
    }
    const s = document.createElement('script');
    s.src = '/gantt/frappe-gantt.js';
    s.async = true;
    s.dataset.frappeGantt = '1';
    s.onload = () => resolve(window.Gantt);
    s.onerror = () => reject(new Error('无法加载甘特图脚本'));
    document.body.appendChild(s);
  });
  return loadPromise;
}
