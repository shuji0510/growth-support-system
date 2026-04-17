const { Router } = require("express");
const { getDb } = require("../db/init");

const router = Router();

// ダッシュボード統合データ
router.get("/", (req, res) => {
  const db = getDb();

  // 利用者数
  const userCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE status='利用中'").get().c;

  // 平均出席率（今月）
  const ym = getCurrentYM();
  const attRate = db
    .prepare(
      `SELECT ROUND(COUNT(CASE WHEN status='出席' THEN 1 END) * 100.0 / MAX(COUNT(id), 1), 1) as rate
       FROM attendance WHERE date LIKE ?`
    )
    .get(ym + "%");

  // 平均工賃
  const wageAvg = db
    .prepare("SELECT AVG(hourly_rate) as avg_hourly FROM wages WHERE year_month = ?")
    .get(ym);

  // スキル向上者数
  const growthUsers = db
    .prepare(
      `SELECT COUNT(DISTINCT s1.user_id) as c
       FROM skill_assessments s1
       WHERE s1.total_score > (
         SELECT s2.total_score FROM skill_assessments s2
         WHERE s2.user_id = s1.user_id AND s2.assessed_at < s1.assessed_at
         ORDER BY s2.assessed_at DESC LIMIT 1
       )`
    )
    .get().c;

  // 最近の記録
  const recentRecords = db
    .prepare(
      `SELECT r.*, u.name as user_name
       FROM support_records r JOIN users u ON r.user_id = u.id
       ORDER BY r.recorded_at DESC LIMIT 5`
    )
    .all();

  // 注目利用者（スキルスコア付き）
  const notableUsers = db
    .prepare(
      `SELECT u.id, u.name, u.primary_task,
        s.total_score as skill_score,
        (SELECT s2.total_score FROM skill_assessments s2
         WHERE s2.user_id = u.id ORDER BY s2.assessed_at DESC LIMIT 1 OFFSET 1) as prev_score
       FROM users u
       LEFT JOIN skill_assessments s ON s.user_id = u.id
         AND s.assessed_at = (SELECT MAX(assessed_at) FROM skill_assessments WHERE user_id = u.id)
       WHERE u.status = '利用中'
       ORDER BY (s.total_score - COALESCE((SELECT s2.total_score FROM skill_assessments s2
         WHERE s2.user_id = u.id ORDER BY s2.assessed_at DESC LIMIT 1 OFFSET 1), s.total_score)) DESC
       LIMIT 6`
    )
    .all();

  for (const u of notableUsers) {
    const att = db
      .prepare(
        `SELECT ROUND(COUNT(CASE WHEN status='出席' THEN 1 END) * 100.0 / MAX(COUNT(id),1)) as rate
         FROM attendance WHERE user_id = ? AND date LIKE ?`
      )
      .get(u.id, ym + "%");
    u.attendance_rate = att ? att.rate : 0;
    u.growth = u.skill_score && u.prev_score ? u.skill_score - u.prev_score : 0;
  }

  // 全体スキルスコア推移（過去6ヶ月）
  const months = getLast6Months();
  const trend = months.map((m) => {
    const avg = db
      .prepare(
        `SELECT ROUND(AVG(total_score)) as avg_score
         FROM skill_assessments
         WHERE assessed_at LIKE ?`
      )
      .get(m + "%");
    return { month: m, avg_score: avg ? avg.avg_score : null };
  });

  res.json({
    user_count: userCount,
    avg_attendance_rate: attRate ? attRate.rate : 0,
    avg_hourly_rate: wageAvg ? Math.round(wageAvg.avg_hourly || 0) : 0,
    skill_growth_count: growthUsers,
    recent_records: recentRecords,
    notable_users: notableUsers,
    skill_trend: trend,
  });
});

// 利用者個別の成長レポート
router.get("/growth/:userId", (req, res) => {
  const db = getDb();
  const userId = req.params.userId;

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) return res.status(404).json({ error: "利用者が見つかりません" });

  // スキル推移
  const skillHistory = db
    .prepare("SELECT * FROM skill_assessments WHERE user_id = ? ORDER BY assessed_at ASC")
    .all(userId);

  // 工賃推移
  const wageHistory = db
    .prepare("SELECT * FROM wages WHERE user_id = ? ORDER BY year_month ASC")
    .all(userId);

  // 最新スキル
  const latestSkill = skillHistory.length ? skillHistory[skillHistory.length - 1] : null;

  // 出席率
  const ym = getCurrentYM();
  const att = db
    .prepare(
      `SELECT ROUND(COUNT(CASE WHEN status='出席' THEN 1 END) * 100.0 / MAX(COUNT(id),1)) as rate
       FROM attendance WHERE user_id = ? AND date LIKE ?`
    )
    .get(userId, ym + "%");

  // 支援記録（成長に関する記録）
  const growthRecords = db
    .prepare(
      `SELECT recorded_at, task_name, growth_notes, support_content
       FROM support_records
       WHERE user_id = ? AND growth_notes IS NOT NULL AND growth_notes != ''
       ORDER BY recorded_at DESC LIMIT 10`
    )
    .all(userId);

  // 現在の支援計画
  const currentPlan = db
    .prepare(
      "SELECT * FROM support_plans WHERE user_id = ? ORDER BY period_start DESC LIMIT 1"
    )
    .get(userId);

  res.json({
    user,
    skill_history: skillHistory,
    wage_history: wageHistory,
    latest_skill: latestSkill,
    attendance_rate: att ? att.rate : 0,
    growth_records: growthRecords,
    current_plan: currentPlan,
  });
});

// 業務マッチング提案
router.get("/matching", (req, res) => {
  const db = getDb();

  const users = db
    .prepare(
      `SELECT u.id, u.name, u.primary_task,
        s.speed, s.accuracy, s.concentration, s.communication, s.independence, s.problem_solving, s.total_score
       FROM users u
       LEFT JOIN skill_assessments s ON s.user_id = u.id
         AND s.assessed_at = (SELECT MAX(assessed_at) FROM skill_assessments WHERE user_id = u.id)
       WHERE u.status = '利用中'
       ORDER BY u.id`
    )
    .all();

  const suggestions = users.map((u) => {
    const { suggestion, fit, reason, expected } = getMatchingSuggestion(u);
    return { ...u, suggested_task: suggestion, fit_score: fit, reason, expected_effect: expected };
  });

  res.json(suggestions);
});

function getMatchingSuggestion(user) {
  if (!user.total_score) {
    return { suggestion: "評価未実施", fit: 0, reason: "スキル評価を実施してください", expected: "-" };
  }

  // ルールベースの簡易マッチング
  if (user.accuracy >= 85 && user.independence >= 75) {
    if (user.total_score >= 80) {
      return { suggestion: "リーダー補助", fit: 92, reason: `正確性${user.accuracy}、自立度${user.independence}と高水準`, expected: "責任感・社会性の向上" };
    }
    return { suggestion: "品質管理補助", fit: 85, reason: `正確性${user.accuracy}が高い`, expected: "専門スキルの習得" };
  }

  if (user.speed >= 75 && user.concentration >= 70) {
    return { suggestion: "生産量重視の業務", fit: 80, reason: `作業速度${user.speed}、集中力${user.concentration}が安定`, expected: "工賃向上" };
  }

  if (user.concentration < 55) {
    return { suggestion: "現業務を継続（支援強化）", fit: 60, reason: "集中力の課題を先に解決", expected: "休憩サイクルの確立が優先" };
  }

  return { suggestion: "段階的にステップアップ", fit: 70, reason: "現在の業務で安定後に移行", expected: "基礎スキルの定着" };
}

function getCurrentYM() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getLast6Months() {
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

module.exports = router;
