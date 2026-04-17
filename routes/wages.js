const { Router } = require("express");
const { getDb } = require("../db/init");

const router = Router();

router.get("/", (req, res) => {
  const db = getDb();
  const { user_id, year_month } = req.query;

  let sql = `
    SELECT w.*, u.name as user_name
    FROM wages w
    JOIN users u ON w.user_id = u.id
    WHERE 1=1
  `;
  const params = [];
  if (user_id) { sql += " AND w.user_id = ?"; params.push(user_id); }
  if (year_month) { sql += " AND w.year_month = ?"; params.push(year_month); }
  sql += " ORDER BY w.year_month DESC, u.id";

  res.json(db.prepare(sql).all(...params));
});

// サマリ
router.get("/summary", (req, res) => {
  const db = getDb();
  const { year_month = "2026-04" } = req.query;
  const prevMonth = getPrevMonth(year_month);

  const current = db
    .prepare(
      `SELECT
        AVG(total_wage) as avg_wage,
        AVG(hourly_rate) as avg_hourly,
        SUM(total_wage) as total
      FROM wages WHERE year_month = ?`
    )
    .get(year_month);

  const prev = db
    .prepare(
      `SELECT AVG(total_wage) as avg_wage, AVG(hourly_rate) as avg_hourly
      FROM wages WHERE year_month = ?`
    )
    .get(prevMonth);

  const change =
    prev && prev.avg_wage
      ? (((current.avg_wage - prev.avg_wage) / prev.avg_wage) * 100).toFixed(1)
      : 0;

  res.json({
    year_month,
    avg_wage: Math.round(current.avg_wage || 0),
    avg_hourly: Math.round(current.avg_hourly || 0),
    total: Math.round(current.total || 0),
    change_percent: Number(change),
  });
});

router.post("/", (req, res) => {
  const db = getDb();
  const { user_id, year_month, work_hours, hourly_rate, total_wage, skill_note } = req.body;
  if (!user_id || !year_month || !work_hours || !hourly_rate) {
    return res.status(400).json({ error: "必須項目を入力してください" });
  }
  const wage = total_wage || Math.round(work_hours * hourly_rate);

  db.prepare(
    `INSERT INTO wages (user_id, year_month, work_hours, hourly_rate, total_wage, skill_note)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(user_id, year_month) DO UPDATE SET work_hours=excluded.work_hours, hourly_rate=excluded.hourly_rate, total_wage=excluded.total_wage, skill_note=excluded.skill_note`
  ).run(user_id, year_month, work_hours, hourly_rate, wage, skill_note || null);

  res.status(201).json(
    db.prepare("SELECT * FROM wages WHERE user_id = ? AND year_month = ?").get(user_id, year_month)
  );
});

router.delete("/:id", (req, res) => {
  const db = getDb();
  db.prepare("DELETE FROM wages WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

function getPrevMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  const prev = new Date(y, m - 2, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
}

module.exports = router;
