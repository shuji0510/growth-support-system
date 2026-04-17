const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "growth-support.db");

let db;
let saveTimer;

// Auto-save to disk periodically
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (db) {
      fs.writeFileSync(DB_PATH, Buffer.from(db._db.export()));
    }
  }, 1000);
}

// Wrapper to match better-sqlite3-like API
class DbWrapper {
  constructor(sqlDb) {
    this._db = sqlDb;
  }

  prepare(sql) {
    const self = this;
    return {
      run(...params) {
        self._db.run(sql, params);
        scheduleSave();
        const lastId = self._db.exec("SELECT last_insert_rowid() as id")[0];
        const changes = self._db.getRowsModified();
        return { lastInsertRowid: lastId ? lastId.values[0][0] : 0, changes };
      },
      get(...params) {
        const stmt = self._db.prepare(sql);
        stmt.bind(params);
        if (stmt.step()) {
          const cols = stmt.getColumnNames();
          const vals = stmt.get();
          stmt.free();
          const row = {};
          cols.forEach((c, i) => { row[c] = vals[i]; });
          return row;
        }
        stmt.free();
        return undefined;
      },
      all(...params) {
        const results = [];
        const stmt = self._db.prepare(sql);
        stmt.bind(params);
        while (stmt.step()) {
          const cols = stmt.getColumnNames();
          const vals = stmt.get();
          const row = {};
          cols.forEach((c, i) => { row[c] = vals[i]; });
          results.push(row);
        }
        stmt.free();
        return results;
      }
    };
  }

  exec(sql) {
    this._db.run(sql);
    scheduleSave();
  }

  transaction(fn) {
    return (...args) => {
      this._db.run("BEGIN");
      try {
        fn(...args);
        this._db.run("COMMIT");
        scheduleSave();
      } catch (e) {
        this._db.run("ROLLBACK");
        throw e;
      }
    };
  }
}

async function initDb() {
  if (db) return db;

  fs.mkdirSync(DATA_DIR, { recursive: true });

  const SQL = await initSqlJs();

  let sqlDb;
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    sqlDb = new SQL.Database(buf);
  } else {
    sqlDb = new SQL.Database();
  }

  sqlDb.run("PRAGMA foreign_keys = ON");

  db = new DbWrapper(sqlDb);

  createTables(db);
  seedIfEmpty(db);

  // Save initial state
  fs.writeFileSync(DB_PATH, Buffer.from(sqlDb.export()));
  console.log("Database saved to", DB_PATH);

  return db;
}

function getDb() {
  if (!db) throw new Error("Database not initialized. Call initDb() first.");
  return db;
}

function createTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      name_kana TEXT,
      start_date TEXT NOT NULL,
      primary_task TEXT,
      status TEXT DEFAULT '利用中',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS support_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      recorded_at TEXT NOT NULL,
      task_name TEXT NOT NULL,
      duration_minutes INTEGER,
      output_rate INTEGER,
      accuracy_rate INTEGER,
      concentration TEXT,
      support_content TEXT,
      growth_notes TEXT,
      staff_name TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS support_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      long_term_goal TEXT NOT NULL,
      short_term_goal TEXT NOT NULL,
      achievement_rate INTEGER DEFAULT 0,
      next_review_date TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      status TEXT NOT NULL,
      check_in TEXT,
      check_out TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id, date)
    );

    CREATE TABLE IF NOT EXISTS wages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      year_month TEXT NOT NULL,
      work_hours REAL NOT NULL,
      hourly_rate INTEGER NOT NULL,
      total_wage INTEGER NOT NULL,
      skill_note TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id, year_month)
    );

    CREATE TABLE IF NOT EXISTS skill_assessments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      assessed_at TEXT NOT NULL,
      assessor TEXT NOT NULL,
      speed INTEGER,
      accuracy INTEGER,
      concentration INTEGER,
      communication INTEGER,
      independence INTEGER,
      problem_solving INTEGER,
      total_score INTEGER,
      comment TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
}

function seedIfEmpty(db) {
  const count = db.prepare("SELECT COUNT(*) as c FROM users").get().c;
  if (count > 0) return;

  const insertUser = db.prepare(
    "INSERT INTO users (name, name_kana, start_date, primary_task, status) VALUES (?,?,?,?,?)"
  );
  const users = [
    ["田中 太郎", "たなか たろう", "2024-06-01", "袋詰め・検品", "利用中"],
    ["鈴木 花子", "すずき はなこ", "2024-08-15", "データ入力", "利用中"],
    ["佐藤 健一", "さとう けんいち", "2025-01-10", "清掃業務", "利用中"],
    ["山田 美咲", "やまだ みさき", "2025-03-20", "軽作業", "利用中"],
    ["中村 翔", "なかむら しょう", "2024-11-01", "ピッキング", "利用中"],
    ["高橋 次郎", "たかはし じろう", "2025-02-01", "組立作業", "利用中"],
  ];
  const insertUsers = db.transaction(() => { for (const u of users) insertUser.run(...u); });
  insertUsers();

  const insertRecord = db.prepare(
    "INSERT INTO support_records (user_id, recorded_at, task_name, duration_minutes, output_rate, accuracy_rate, concentration, support_content, growth_notes, staff_name) VALUES (?,?,?,?,?,?,?,?,?,?)"
  );
  const records = [
    [1, "2026-04-17 09:30", "袋詰め", 120, 120, 98, "高い", "声かけなしで安定作業", "集中力が向上。1時間あたりの作業量が前月比120%に。", "篠塚"],
    [2, "2026-04-17 10:15", "データ入力", 120, 100, 98, "高い", "入力精度が安定", "ミス率が先月の5%から2%に改善。", "篠塚"],
    [3, "2026-04-16 14:00", "清掃業務", 90, 100, 90, "普通", "チェックリスト活用", "手順を自分で確認しながら進められるようになった。", "篠塚"],
    [4, "2026-04-16 15:30", "シール貼り", 60, 95, 92, "やや低い", "休憩タイミング調整検討", "作業スピードは安定。30分で集中力低下。", "篠塚"],
    [5, "2026-04-15 09:00", "ピッキング", 120, 110, 96, "高い", "新ロケーション対応", "新しいロケーションにも対応できた。", "田村"],
    [1, "2026-04-14 09:30", "検品", 120, 115, 97, "高い", "検品手順の確認", "検品作業の精度も高い。リーダー補助の素養あり。", "篠塚"],
    [2, "2026-04-14 10:00", "データ入力", 120, 105, 97, "高い", "難易度の高いデータに挑戦", "新しいフォーマットにも適応。", "田村"],
    [6, "2026-04-15 13:00", "組立作業", 90, 100, 88, "普通", "手順の反復練習", "基本工程を覚えつつある段階。", "篠塚"],
  ];
  const insertRecords = db.transaction(() => { for (const r of records) insertRecord.run(...r); });
  insertRecords();

  const insertPlan = db.prepare(
    "INSERT INTO support_plans (user_id, period_start, period_end, long_term_goal, short_term_goal, achievement_rate, next_review_date) VALUES (?,?,?,?,?,?,?)"
  );
  const plans = [
    [1, "2026-04-01", "2026-09-30", "検品リーダー補助", "1時間連続作業の定着", 80, "2026-07-01"],
    [2, "2026-04-01", "2026-09-30", "一般就労への移行", "入力精度99%以上", 60, "2026-07-01"],
    [3, "2026-01-01", "2026-06-30", "手順の自立遂行", "チェックリスト自主活用", 75, "2026-06-01"],
    [4, "2026-04-01", "2026-09-30", "45分間の連続作業", "休憩サイクルの確立", 30, "2026-06-01"],
    [5, "2026-04-01", "2026-09-30", "出荷管理補助", "新ロケーション完全対応", 65, "2026-07-01"],
    [6, "2026-04-01", "2026-09-30", "全工程の自立作業", "基本3工程の習得", 40, "2026-07-01"],
  ];
  const insertPlans = db.transaction(() => { for (const p of plans) insertPlan.run(...p); });
  insertPlans();

  const insertAtt = db.prepare(
    "INSERT INTO attendance (user_id, date, status, check_in, check_out) VALUES (?,?,?,?,?)"
  );
  const attData = [];
  for (let userId = 1; userId <= 6; userId++) {
    for (let d = 1; d <= 17; d++) {
      const date = `2026-04-${String(d).padStart(2, "0")}`;
      const dow = new Date(date).getDay();
      if (dow === 0 || dow === 6) continue;
      let status = "出席";
      if (userId === 4 && (d === 3 || d === 8 || d === 10 || d === 15)) status = "欠席";
      if (userId === 3 && (d === 7 || d === 14)) status = "欠席";
      if (userId === 2 && d === 11) status = "欠席";
      attData.push([userId, date, status, status === "出席" ? "09:00" : null, status === "出席" ? "16:00" : null]);
    }
  }
  const insertAtts = db.transaction(() => { for (const a of attData) insertAtt.run(...a); });
  insertAtts();

  const insertWage = db.prepare(
    "INSERT INTO wages (user_id, year_month, work_hours, hourly_rate, total_wage, skill_note) VALUES (?,?,?,?,?,?)"
  );
  const wageData = [
    [1, "2026-03", 68, 270, 18360, "検品追加で単価UP"],
    [1, "2026-04", 72, 280, 20160, "スキルUPにより時給増"],
    [2, "2026-03", 60, 250, 15000, "精度安定"],
    [2, "2026-04", 64, 260, 16640, "精度向上で単価UP"],
    [3, "2026-03", 58, 230, 13340, "維持"],
    [3, "2026-04", 60, 230, 13800, "維持"],
    [4, "2026-03", 50, 220, 11000, "出席率やや低下"],
    [4, "2026-04", 48, 220, 10560, "出席率低下の影響"],
    [5, "2026-03", 66, 250, 16500, "安定"],
    [5, "2026-04", 70, 260, 18200, "新ロケ対応で昇給"],
    [6, "2026-03", 56, 220, 12320, "習得中"],
    [6, "2026-04", 58, 220, 12760, "維持"],
  ];
  const insertWages = db.transaction(() => { for (const w of wageData) insertWage.run(...w); });
  insertWages();

  const insertSkill = db.prepare(
    "INSERT INTO skill_assessments (user_id, assessed_at, assessor, speed, accuracy, concentration, communication, independence, problem_solving, total_score, comment) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
  );
  const skillData = [
    [1, "2026-01-01", "篠塚", 72, 78, 68, 65, 70, 55, 70, "安定期。基盤固め"],
    [1, "2026-02-01", "田村", 75, 82, 72, 67, 73, 58, 73, "集中力の持続時間が伸長"],
    [1, "2026-03-01", "篠塚", 80, 88, 75, 68, 78, 62, 78, "正確性が大幅に改善"],
    [1, "2026-04-01", "篠塚", 85, 90, 78, 70, 82, 65, 82, "作業速度・自立度が向上"],
    [2, "2026-02-01", "篠塚", 70, 82, 75, 72, 68, 60, 71, "入力速度向上中"],
    [2, "2026-04-01", "篠塚", 75, 88, 78, 74, 72, 62, 76, "精度98%に到達"],
    [3, "2026-02-01", "田村", 60, 70, 62, 55, 58, 50, 59, "手順理解が進む"],
    [3, "2026-04-01", "篠塚", 65, 75, 65, 58, 68, 55, 65, "チェックリスト活用が定着"],
    [4, "2026-04-01", "篠塚", 60, 68, 45, 62, 52, 48, 58, "集中力に課題"],
    [5, "2026-02-01", "田村", 68, 75, 70, 60, 65, 58, 66, "新エリア対応中"],
    [5, "2026-04-01", "篠塚", 75, 80, 72, 62, 70, 62, 71, "対応力向上"],
    [6, "2026-04-01", "篠塚", 58, 65, 60, 55, 55, 50, 60, "基本工程を習得中"],
  ];
  const insertSkills = db.transaction(() => { for (const s of skillData) insertSkill.run(...s); });
  insertSkills();

  console.log("Seed data inserted.");
}

module.exports = { initDb, getDb };
