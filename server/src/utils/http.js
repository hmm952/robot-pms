/**
 * 通用 HTTP 辅助
 * @param {unknown} err
 * @param {import('express').Response} res
 */
export function sendServerError(res, err) {
  console.error(err);
  res.status(500).json({ message: '服务器内部错误', detail: String(err?.message || err) });
}
