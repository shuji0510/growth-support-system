const { Router } = require("express");
const { getDb } = require("../db/init");

const router = Router();

router.get("/", (req, res) => {
  const db = getDb();
  const { user_id } = req.query;
  let sql = `
    SELECT p.*, u.name as user_name
    FROM support_plans p
    JOIN users u ON p.user_id = u.id
  `;
  const params = [];
  if (user_id) {
    sql += " WHERE p.user_id = ?";
    params.push(user_id);
  }
  sql += " ORDER BY p.period_start DESC";
  res.json(db.prepare(sql).all(...params));
});

router.get("/:id", (req, res) => {
  const db = getDb();
  const plan = db
    .prepare("SELECT p.*, u.name as user_name FROM support_plans p JOIN users u ON p.user_id = u.id WHERE p.id = ?")
    .get(req.params.id);
  if (!plan) return res.status(404).json({ error: "計画が見つかりません" });
  res.json(plan);
});

router.post("/", (req, res) => {
  const db = getDb();
  const { user_id, period_start, period_end, long_term_goal, short_term_goal, achievement_rate, next_review_date, notes } = req.body;
  if (!user_id || !period_start || !period_end || !long_term_goal || !short_term_goal) {
    return res.status(400).json({ error: "必須項目を入力してください" });
  }
  const result = db
    .prepare(
      `INSERT INTO support_plans (user_id, period_start, period_end, long_term_goal, short_term_goal, achievement_rate, next_review_date, notes)
       VALUES (?,?,?,?,?,?,?,?)`
    )
    .run(user_id, period_start, period_end, long_term_goal, short_term_goal, achievement_rate || 0, next_review_date || null, notes || null);
  res.status(201).json(db.prepare("SELECT * FROM support_plans WHERE id = ?").get(result.lastInsertRowid));
});

router.put("/:id", (req, res) => {
  const db = getDb();
  const { user_id, period_start, period_end, long_term_goal, short_term_goal, achievement_rate, next_review_date, notes } = req.body;
  db.prepare(
    `UPDATE support_plans SET user_id=?, period_start=?, period_end=?, long_term_goal=?, short_term_goal=?, achievement_rate=?, next_review_date=?, notes=?, updated_at=datetime('now','localtime')
     WHERE id=?`
  ).run(user_id, period_start, period_end, long_term_goal, short_term_goal, achievement_rate, next_review_date, notes, req.params.id);
  res.json(db.prepare("SELECT * FROM support_plans WHERE id = ?").get(req.params.id));
});

router.delete("/:id", (req, res) => {
  const db = getDb();
  db.prepare("DELETE FROM support_plans WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
