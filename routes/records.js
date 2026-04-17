const { Router } = require("express");
const { getDb } = require("../db/init");

const router = Router();

// 一覧（フィルタ対応）
router.get("/", (req, res) => {
  const db = getDb();
  const { user_id, limit = 50, offset = 0 } = req.query;

  let sql = `
    SELECT r.*, u.name as user_name
    FROM support_records r
    JOIN users u ON r.user_id = u.id
  `;
  const params = [];

  if (user_id) {
    sql += " WHERE r.user_id = ?";
    params.push(user_id);
  }

  sql += " ORDER BY r.recorded_at DESC LIMIT ? OFFSET ?";
  params.push(Number(limit), Number(offset));

  const records = db.prepare(sql).all(...params);
  res.json(records);
});

// 詳細
router.get("/:id", (req, res) => {
  const db = getDb();
  const record = db
    .prepare(
      `SELECT r.*, u.name as user_name
       FROM support_records r JOIN users u ON r.user_id = u.id
       WHERE r.id = ?`
    )
    .get(req.params.id);
  if (!record) return res.status(404).json({ error: "記録が見つかりません" });
  res.json(record);
});

// 作成
router.post("/", (req, res) => {
  const db = getDb();
  const {
    user_id, recorded_at, task_name, duration_minutes,
    output_rate, accuracy_rate, concentration,
    support_content, growth_notes, staff_name,
  } = req.body;

  if (!user_id || !recorded_at || !task_name) {
    return res.status(400).json({ error: "利用者・日時・業務内容は必須です" });
  }

  const result = db
    .prepare(
      `INSERT INTO support_records
       (user_id, recorded_at, task_name, duration_minutes, output_rate, accuracy_rate, concentration, support_content, growth_notes, staff_name)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      user_id, recorded_at, task_name,
      duration_minutes || null, output_rate || null, accuracy_rate || null,
      concentration || null, support_content || null, growth_notes || null,
      staff_name || null
    );

  const record = db.prepare("SELECT * FROM support_records WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(record);
});

// 更新
router.put("/:id", (req, res) => {
  const db = getDb();
  const {
    user_id, recorded_at, task_name, duration_minutes,
    output_rate, accuracy_rate, concentration,
    support_content, growth_notes, staff_name,
  } = req.body;

  db.prepare(
    `UPDATE support_records SET
     user_id=?, recorded_at=?, task_name=?, duration_minutes=?,
     output_rate=?, accuracy_rate=?, concentration=?,
     support_content=?, growth_notes=?, staff_name=?
     WHERE id=?`
  ).run(
    user_id, recorded_at, task_name, duration_minutes,
    output_rate, accuracy_rate, concentration,
    support_content, growth_notes, staff_name,
    req.params.id
  );

  const record = db.prepare("SELECT * FROM support_records WHERE id = ?").get(req.params.id);
  res.json(record);
});

// 削除
router.delete("/:id", (req, res) => {
  const db = getDb();
  db.prepare("DELETE FROM support_records WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
