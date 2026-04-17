const { Router } = require("express");
const { getDb } = require("../db/init");

const router = Router();

// 一覧（利用者別の最新評価）
router.get("/", (req, res) => {
  const db = getDb();
  const { user_id } = req.query;

  if (user_id) {
    const assessments = db
      .prepare(
        `SELECT s.*, u.name as user_name
         FROM skill_assessments s
         JOIN users u ON s.user_id = u.id
         WHERE s.user_id = ?
         ORDER BY s.assessed_at DESC`
      )
      .all(user_id);
    return res.json(assessments);
  }

  // 各利用者の最新評価
  const latest = db
    .prepare(
      `SELECT s.*, u.name as user_name
       FROM skill_assessments s
       JOIN users u ON s.user_id = u.id
       WHERE s.id IN (
         SELECT id FROM skill_assessments s2
         WHERE s2.user_id = s.user_id
         ORDER BY s2.assessed_at DESC
         LIMIT 1
       )
       ORDER BY u.id`
    )
    .all();

  res.json(latest);
});

// 成長推移（特定利用者の全履歴）
router.get("/history/:userId", (req, res) => {
  const db = getDb();
  const history = db
    .prepare(
      `SELECT s.*, u.name as user_name
       FROM skill_assessments s
       JOIN users u ON s.user_id = u.id
       WHERE s.user_id = ?
       ORDER BY s.assessed_at ASC`
    )
    .all(req.params.userId);
  res.json(history);
});

// 作成
router.post("/", (req, res) => {
  const db = getDb();
  const {
    user_id, assessed_at, assessor,
    speed, accuracy, concentration,
    communication, independence, problem_solving,
    comment,
  } = req.body;

  if (!user_id || !assessed_at || !assessor) {
    return res.status(400).json({ error: "利用者・評価日・評価者は必須です" });
  }

  const total_score = Math.round(
    ((speed || 0) + (accuracy || 0) + (concentration || 0) +
     (communication || 0) + (independence || 0) + (problem_solving || 0)) / 6
  );

  const result = db
    .prepare(
      `INSERT INTO skill_assessments
       (user_id, assessed_at, assessor, speed, accuracy, concentration, communication, independence, problem_solving, total_score, comment)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      user_id, assessed_at, assessor,
      speed || 0, accuracy || 0, concentration || 0,
      communication || 0, independence || 0, problem_solving || 0,
      total_score, comment || null
    );

  res.status(201).json(
    db.prepare("SELECT * FROM skill_assessments WHERE id = ?").get(result.lastInsertRowid)
  );
});

router.delete("/:id", (req, res) => {
  const db = getDb();
  db.prepare("DELETE FROM skill_assessments WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
