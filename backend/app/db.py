# -*- coding: utf-8 -*-
"""
数据库层：SQLite 连接管理、建表、schema 版本迁移
==============================================
- 所有表统一带软删除字段 deleted_at（为 NULL 表示正常，非 NULL 表示在回收站）
- 日期统一存 TEXT "YYYY-MM-DD"，时间戳存 ISO8601 TEXT，简单可靠、可读性好
- tags 一类多值字段存 JSON 字符串，个人数据量级下 LIKE 搜索足够快
"""
import json
import os
import sqlite3
from datetime import datetime
from pathlib import Path

# 数据目录：backend/data（数据库 + 备份 + 上传附件都在这里，方便整体备份）
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
BACKUP_DIR = DATA_DIR / "backups"
DB_PATH = DATA_DIR / "life.db"

# 当前 schema 版本；未来加表/加列时把这里 +1 并在 MIGRATIONS 里写迁移语句
SCHEMA_VERSION = 9


def now_iso() -> str:
    """当前时间的 ISO8601 字符串（本地时间，含秒）"""
    return datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def today_str() -> str:
    """今天的日期字符串 YYYY-MM-DD"""
    return datetime.now().strftime("%Y-%m-%d")


def get_conn() -> sqlite3.Connection:
    """
    创建一个新的数据库连接（每个请求各自持有，避免跨线程共享）。
    check_same_thread=False：FastAPI 用线程池处理同步端点，连接的创建、
    使用、关闭可能落在不同线程；同一时刻只有一个线程在用这个连接，
    因此这样是安全的（SQLite 官方允许的用法）。
    """
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10, check_same_thread=False)
    conn.row_factory = sqlite3.Row  # 查询结果按列名取值
    conn.execute("PRAGMA journal_mode=WAL")       # WAL 模式：写入更安全，减少库损坏风险
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")      # 遇到锁最多等 5 秒
    return conn


# ---------------------------------------------------------------- 建表语句
SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL,
    applied_at TEXT NOT NULL
);

-- 方向与阶段目标（type=direction 长期方向 / stage_goal 阶段目标；阶段目标用 parent_id 挂在方向下）
CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id INTEGER REFERENCES goals(id) ON DELETE SET NULL,
    type TEXT NOT NULL DEFAULT 'stage_goal',
    title TEXT NOT NULL,
    color TEXT DEFAULT '',
    description TEXT DEFAULT '',
    start_date TEXT DEFAULT '',
    due_date TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',   -- active/paused/done/archived
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

-- 项目（挂在目标下，也可以独立存在）
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    goal_id INTEGER REFERENCES goals(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    color TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',   -- active/paused/done/archived
    start_date TEXT DEFAULT '',
    due_date TEXT DEFAULT '',
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

-- 每日行动 / 任务
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    goal_id INTEGER REFERENCES goals(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    notes TEXT DEFAULT '',
    task_date TEXT NOT NULL,                 -- 任务归属日期 YYYY-MM-DD
    done INTEGER NOT NULL DEFAULT 0,         -- 0 未完成 / 1 已完成
    done_at TEXT,
    priority INTEGER NOT NULL DEFAULT 0,     -- 0 普通 / 1 重要（小红旗）
    estimate_min INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(task_date) WHERE deleted_at IS NULL;

-- 习惯与打卡记录
CREATE TABLE IF NOT EXISTS habits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    icon TEXT DEFAULT '✅',
    color TEXT DEFAULT '',
    sort INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS habit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    log_date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    deleted_at TEXT,
    UNIQUE(habit_id, log_date)               -- 同一习惯同一天只能打一次卡
);
CREATE INDEX IF NOT EXISTS idx_habit_logs_date ON habit_logs(log_date);

-- 日记
CREATE TABLE IF NOT EXISTS journals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    journal_date TEXT NOT NULL,
    mood INTEGER,                            -- 1-5 心情档位，允许为空
    weather TEXT DEFAULT '',
    title TEXT DEFAULT '',
    content TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',                  -- JSON 数组字符串
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_journals_date ON journals(journal_date) WHERE deleted_at IS NULL;

-- 随手记（便签池，可以转成日记）
CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    color TEXT DEFAULT 'yellow',             -- 便签颜色 yellow/pink/green
    pinned INTEGER NOT NULL DEFAULT 0,
    became_journal_id INTEGER REFERENCES journals(id) ON DELETE SET NULL,  -- 转成日记后记录去向
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

-- 知识卡片
CREATE TABLE IF NOT EXISTS knowledge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT DEFAULT '',
    category TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',
    source TEXT DEFAULT '',                  -- 出处：书名/链接/课程等
    review_count INTEGER NOT NULL DEFAULT 0, -- 复习次数
    last_review_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

-- 成果（个人 IP 档案：作品/里程碑/证书）
CREATE TABLE IF NOT EXISTS achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ach_type TEXT NOT NULL DEFAULT 'work',   -- work 作品 / milestone 里程碑 / certificate 证书
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    ach_date TEXT DEFAULT '',
    link TEXT DEFAULT '',
    image_path TEXT DEFAULT '',              -- 上传图片的相对文件名
    tags TEXT DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

-- 技能（雷达图数据）
CREATE TABLE IF NOT EXISTS skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    level INTEGER NOT NULL DEFAULT 3,        -- 1-10 熟练度
    icon TEXT DEFAULT '🌟',
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

-- 复盘（周报/月报）
CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_type TEXT NOT NULL DEFAULT 'weekly',  -- weekly/monthly/yearly
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    content TEXT DEFAULT '',                     -- 用户写的复盘正文
    draft TEXT DEFAULT '',                       -- 系统自动生成的草稿数据（JSON）
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

-- 重复任务规则（任务"模板"，每天自动生成当日实例到 tasks 表）
CREATE TABLE IF NOT EXISTS task_recurrences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    notes TEXT DEFAULT '',
    priority INTEGER NOT NULL DEFAULT 0,
    goal_id INTEGER REFERENCES goals(id) ON DELETE SET NULL,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    repeat_type TEXT NOT NULL DEFAULT 'daily',   -- daily 每天 / weekdays 工作日 / weekly 每周几
    weekdays TEXT DEFAULT '[]',                  -- weekly 时生效：[0,1,...6] 周日~周六
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

-- 设置（键值对）
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

# 未来版本升级时在这里追加迁移：(from_version, [SQL...])
# 注意：tasks 的新列只写在迁移里（全新库和旧库都统一走 ALTER，保证结构一致）
MIGRATIONS: dict[int, list[str]] = {
    2: [
        "ALTER TABLE tasks ADD COLUMN recurrence_id INTEGER REFERENCES task_recurrences(id) ON DELETE SET NULL",
        "ALTER TABLE tasks ADD COLUMN summary TEXT DEFAULT ''",
    ],
    3: [
        "ALTER TABLE tasks ADD COLUMN category TEXT DEFAULT ''",  # 任务分类标签（分组显示用）
    ],
    4: [
        "ALTER TABLE knowledge ADD COLUMN image_path TEXT DEFAULT ''",  # 知识卡片配图（随手记截图等）
    ],
    5: [
        "ALTER TABLE achievements ADD COLUMN gallery TEXT DEFAULT '[]'",  # 作品相册（多图，JSON 数组）
    ],
    6: [
        """CREATE TABLE IF NOT EXISTS books (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            author TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'reading',  -- reading 在读 / finished 读完 / wishlist 想读
            progress INTEGER NOT NULL DEFAULT 0,     -- 阅读进度 0-100
            rating INTEGER,                          -- 评分 1-5 星（读完可评）
            started_date TEXT DEFAULT '',
            finished_date TEXT DEFAULT '',
            notes TEXT DEFAULT '',                   -- 读书笔记 / 感悟（Markdown）
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        )""",
    ],
    7: [
        "ALTER TABLE books ADD COLUMN cover_path TEXT DEFAULT ''",  # 书封（网上搜索或本地上传）
    ],
    8: [
        "ALTER TABLE tasks ADD COLUMN knowledge_ids TEXT DEFAULT '[]'",  # 任务关联的知识卡片（JSON 数组）
    ],
    9: [
        "ALTER TABLE projects ADD COLUMN knowledge_ids TEXT DEFAULT '[]'",  # 项目关联的知识卡片（JSON 数组）
    ],
}


def init_db() -> None:
    """初始化数据库：建表 + 版本迁移。应用每次启动时调用，幂等安全。"""
    conn = get_conn()
    try:
        conn.executescript(SCHEMA_SQL)
        row = conn.execute("SELECT MAX(version) AS v FROM schema_version").fetchone()
        current = row["v"] if row and row["v"] else 0
        if current < SCHEMA_VERSION:
            for v in range(current + 1, SCHEMA_VERSION + 1):
                for sql in MIGRATIONS.get(v, []):
                    conn.executescript(sql)
                conn.execute(
                    "INSERT INTO schema_version (version, applied_at) VALUES (?, ?)",
                    (v, now_iso()),
                )
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------- 通用小工具
def row_to_dict(row: sqlite3.Row) -> dict:
    """sqlite3.Row -> 普通 dict，并把 tags/gallery/knowledge_ids 这类 JSON 字段解析成列表"""
    d = dict(row)
    for key in ("tags", "gallery", "knowledge_ids"):
        if key in d and isinstance(d[key], str):
            try:
                d[key] = json.loads(d[key])
            except (json.JSONDecodeError, TypeError):
                d[key] = []
    return d


def rows_to_dicts(rows: list[sqlite3.Row]) -> list[dict]:
    return [row_to_dict(r) for r in rows]
