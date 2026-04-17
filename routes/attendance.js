const { Router } = require("express");
const { getDb } = require("../db/init");

const router = Router();

// 月別一覧
router.get("/", (req, res) => {
  const db = getDb();
  const { user_id, year_month } = req.query;

  let sql = `
    SELECT a.*, u.name as user_name
    FROM attendance a
    JOIN users u ON a.user_id = u.id
    WHERE 1=1
  `;
  const params = [];

  if (user_id) {
    sql += " AND a.user_id = ?";
    params.push(user_id);
  }
  if (year_month) {
    sql += " AND a.date LIKE ?";
    params.push(year_month + "%");
  }

  sql += " ORDER BY a.date DESC";
  res.json(db.prepare(sql).all(...params));
});

// サマリ（利用者別出席率）
router.get("/summary", (req, res) => {
  const db = getDb();
  const { year_month = "2026-04" } = req.query;

  const summary = db
    .prepare(
      `SELECT
        u.id, u.name,
        COUNT(CASE WHEN a.status='出席' THEN 1 END) as present_days,
        COUNT(CASE WHEN a.status='欠席' THEN 1 END) as absent_days,
        COUNT(a.id) as total_days,
        ROUND(COUNT(CASE WHEN a.status='出席' THEN 1 END) * 100.0 / MAX(COUNT(a.id), 1)) as attendance_rate
      FROM users u
      LEFT JOIN attendance a ON u.id = a.user_id AND a.date LIKE ?
      WHERE u.status = '利用中'
      GROUP BY u.id
      ORDER BY u.id`
    )
    .all(year_month + "%");

  // 前月比を計算
  const prevMonth = getPrevMonth(year_month);
  for (const s of summary) {
    const prev = db
      .prepare(
        `SELECT
          ROUND(COUNT(CASE WHEN status='出席' THEN 1 END) * 100.0 / MAX(COUNT(id), 1)) as rate
        FROM attendance WHERE user_id = ? AND date LIKE ?`
      )
      .get(s.id, prevMonth + "%");
    s.prev_rate = prev ? prev.rate : 0;
    s.rate_change = Math.round((s.attendance_rate || 0) - (s.prev_rate || 0));
  }

  res.json(summary);
});

// 登録・更新（UPSERT）
router.post("/", (req, res) => {
  const db = getDb();
  const { user_id, date, status, check_in, check_out, notes } = req.body;
  if (!user_id || !date || !status) {
    return res.status(400).json({ error: "利用者・日付・ステータスは必須です" });
  }

  db.prepare(
    `INSERT INTO attendance (user_id, date, status, check_in, check_out, notes)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(user_id, date) DO UPDATE SET status=excluded.status, check_in=excluded.check_in, check_out=excluded.check_out, notes=excluded.notes`
  ).run(user_id, date, status, check_in || null, check_out || null, notes || null);

  const att = db.prepare("SELECT * FROM attendance WHERE user_id = ? AND date = ?").get(user_id, date);
  res.status(201).json(att);
});

// 一括登録
router.post("/bulk", (req, res) => {
  const db = getDb();
  const { records } = req.body;
  if (!Array.isArray(records)) {
    return res.status(400).json({ error: "records配列が必要です" });
  }

  const stmt = db.prepare(
    `INSERT INTO attendance (user_id, date, status, check_in, check_out, notes)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(user_id, date) DO UPDATE SET status=excluded.status, check_in=excluded.check_in, check_out=excluded.check_out, notes=excluded.notes`
  );

  const insert = db.transaction(() => {
    for (const r of records) {
      stmt.run(r.user_id, r.date, r.status, r.check_in || null, r.check_out || null, r.notes || null);
    }
  });
  insert();

  res.status(201).json({ ok: true, count: records.length });
});

function getPrevMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  const prev = new Date(y, m - 2, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
}

module.exports = router;
