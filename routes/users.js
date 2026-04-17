const { Router } = require("express");
const { getDb } = require("../db/init");

const router = Router();

// 一覧
router.get("/", (req, res) => {
  const db = getDb();
  const users = db
    .prepare(
      `SELECT u.*,
        (SELECT total_score FROM skill_assessments WHERE user_id = u.id ORDER BY assessed_at DESC LIMIT 1) as skill_score,
        (SELECT total_score FROM skill_assessments WHERE user_id = u.id ORDER BY assessed_at DESC LIMIT 1 OFFSET 1) as prev_skill_score
      FROM users u ORDER BY u.id`
    )
    .all();

  // 出席率を計算
  for (const u of users) {
    const att = db
      .prepare(
        `SELECT
          COUNT(CASE WHEN status='出席' THEN 1 END) as present,
          COUNT(*) as total
        FROM attendance WHERE user_id = ? AND date >= date('now','localtime','-30 days')`
      )
      .get(u.id);
    u.attendance_rate =
      att.total > 0 ? Math.round((att.present / att.total) * 100) : 0;
    u.growth =
      u.skill_score && u.prev_skill_score
        ? u.skill_score - u.prev_skill_score
        : 0;
  }

  res.json(users);
});

// 詳細
router.get("/:id", (req, res) => {
  const db = getDb();
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "利用者が見つかりません" });
  res.json(user);
});

// 作成
router.post("/", (req, res) => {
  const db = getDb();
  const { name, name_kana, start_date, primary_task, notes } = req.body;
  if (!name || !start_date) {
    return res.status(400).json({ error: "名前と利用開始日は必須です" });
  }
  const result = db
    .prepare(
      "INSERT INTO users (name, name_kana, start_date, primary_task, notes) VALUES (?,?,?,?,?)"
    )
    .run(name, name_kana || null, start_date, primary_task || null, notes || null);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(user);
});

// 更新
router.put("/:id", (req, res) => {
  const db = getDb();
  const { name, name_kana, start_date, primary_task, status, notes } = req.body;
  db.prepare(
    `UPDATE users SET name=?, name_kana=?, start_date=?, primary_task=?, status=?, notes=?, updated_at=datetime('now','localtime')
     WHERE id=?`
  ).run(name, name_kana, start_date, primary_task, status, notes, req.params.id);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  res.json(user);
});

// 削除
router.delete("/:id", (req, res) => {
  const db = getDb();
  db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
