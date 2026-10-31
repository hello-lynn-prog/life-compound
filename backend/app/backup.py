# -*- coding: utf-8 -*-
"""
备份与恢复：人生复利系统的"保命机制"
====================================
- 启动备份：应用每次启动时把数据库复制一份到 data/backups/（保留最近 30 份）
- 手动备份：数据中心页面点按钮立即备份
- 恢复：用备份文件覆盖当前数据库（恢复前会自动再备份一次当前库，防止手滑）
- 导出 ZIP：数据库 + 上传附件打包成一个文件，方便拷贝到 U 盘/网盘
"""
import json
import shutil
import zipfile
import tempfile
import sqlite3
from datetime import datetime
from pathlib import Path

from .db import BACKUP_DIR, DATA_DIR, DB_PATH, UPLOAD_DIR

MAX_BACKUPS = 30  # 保留的备份份数


def backup_db(reason: str = "manual") -> Path:
    """
    备份数据库到 data/backups/。
    reason: startup / manual / pre_restore（会写进文件名，方便识别来源）
    返回备份文件路径。
    """
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    dest = BACKUP_DIR / f"life_{reason}_{stamp}.db"
    if DB_PATH.exists():
        # WAL 模式下直接复制 .db 文件可能丢掉未 checkpoint 的数据，
        # 先用 sqlite 的 backup API 做一致性快照最稳妥
        import sqlite3

        src = sqlite3.connect(DB_PATH)
        try:
            dst = sqlite3.connect(dest)
            try:
                src.backup(dst)
            finally:
                dst.close()
        finally:
            src.close()
    _prune_old_backups()
    return dest


def _prune_old_backups() -> None:
    """只保留最近 MAX_BACKUPS 份备份，防止备份目录无限膨胀"""
    backups = sorted(BACKUP_DIR.glob("life_*.db"), key=lambda p: p.stat().st_mtime)
    for old in backups[:-MAX_BACKUPS]:
        try:
            old.unlink()
        except OSError:
            pass


def list_backups() -> list[dict]:
    """列出全部备份（按修改时间新的在前），供数据中心页面展示"""
    items = []
    files = sorted(BACKUP_DIR.glob("life_*.db"),
                   key=lambda f: f.stat().st_mtime, reverse=True)
    for f in files:
        stat = f.stat()
        items.append({
            "file": f.name,
            "size_kb": round(stat.st_size / 1024, 1),
            "created_at": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
        })
    return items


def restore_db(backup_file: str) -> dict:
    """
    用指定备份文件恢复数据库。
    - backup_file 只允许是 backups 目录里的文件名（禁止路径穿越）
    - 恢复前先把当前库备份一份（pre_restore），给用户留后悔药
    - 用 SQLite backup API 写回（Windows 下运行中的库文件被锁定，
      直接复制文件会失败，backup API 可以安全覆盖已打开的库）
    """
    import sqlite3

    name = Path(backup_file).name  # 去掉任何路径部分，只留文件名
    src_path = BACKUP_DIR / name
    if not src_path.exists():
        raise FileNotFoundError(f"备份不存在：{name}")
    backup_db("pre_restore")
    src = sqlite3.connect(src_path)
    try:
        dst = sqlite3.connect(DB_PATH)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()
    return {"restored_from": name}


def export_zip(dest_path: str | None = None) -> Path:
    """
    全量导出：数据库 + 上传附件 → 一个 ZIP。
    默认导出到 data/ 目录下，数据中心会把它再交给浏览器下载。
    """
    if dest_path is None:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        dest_path = str(DATA_DIR / f"人生复利系统_全量导出_{stamp}.zip")
    with zipfile.ZipFile(dest_path, "w", zipfile.ZIP_DEFLATED) as zf:
        if DB_PATH.exists():
            # WAL 数据必须通过 SQLite backup API 合并成一致性快照。
            with tempfile.TemporaryDirectory() as tmp:
                snapshot = Path(tmp) / "life.db"
                src = sqlite3.connect(DB_PATH)
                dst = sqlite3.connect(snapshot)
                try:
                    src.backup(dst)
                finally:
                    dst.close()
                    src.close()
                zf.write(snapshot, "life.db")
        if UPLOAD_DIR.exists():
            for f in UPLOAD_DIR.rglob("*"):
                if f.is_file():
                    zf.write(f, f.relative_to(DATA_DIR).as_posix())
    return Path(dest_path)


def import_zip(zip_path: str) -> dict:
    """
    全量导入：用导出的 ZIP 恢复整个数据目录。
    导入前自动备份当前库。ZIP 内只接受 life.db 和 uploads/ 开头的文件。
    life.db 用 SQLite backup API 写回（避免 Windows 文件锁冲突）。
    """
    import io
    import sqlite3

    # 全部校验和解压成功之后才修改正式库；临时目录与数据库句柄及时释放。
    with tempfile.TemporaryDirectory() as tmp:
        stage = Path(tmp)
        with zipfile.ZipFile(zip_path, "r") as zf:
            entries = zf.infolist()
            if sum(i.file_size for i in entries) > 500 * 1024 * 1024:
                raise ValueError("解压后超过 500MB 限制")
            names = set()
            for info in entries:
                name = info.filename
                if name in names or "\\" in name or ":" in name or name.startswith("/") or ".." in name.split("/"):
                    raise ValueError("压缩包存在重复或不安全路径")
                names.add(name)
                if info.is_dir():
                    continue
                if name != "life.db" and not name.startswith("uploads/"):
                    raise ValueError("压缩包包含不支持的文件")
                target = stage / name
                target.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info) as source, target.open("wb") as output:
                    shutil.copyfileobj(source, output)
        if not (stage / "life.db").is_file():
            raise ValueError("缺少 life.db")
        src = sqlite3.connect(stage / "life.db")
        try:
            if src.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("数据库完整性检查失败")
            tables = {r[0] for r in src.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if not {"tasks", "journals", "settings"}.issubset(tables):
                raise ValueError("不是本应用的数据库")
            backup_db("pre_restore")
            # 附件先复制，数据库最后提交；失败时原数据库保持不变。
            for attachment in (stage / "uploads").rglob("*"):
                if attachment.is_file():
                    target = UPLOAD_DIR / attachment.relative_to(stage / "uploads")
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(attachment, target)
            dst = sqlite3.connect(DB_PATH)
            try:
                src.backup(dst)
            finally:
                dst.close()
        finally:
            src.close()
    return {"imported": zip_path}



def export_json() -> str:
    """把所有表导出成一个大 JSON（人类可读的兜底格式，防止 SQLite 打不开时数据全丢）"""
    import sqlite3

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        tables = [
            "goals", "projects", "tasks", "habits", "habit_logs", "journals",
            "notes", "knowledge", "achievements", "skills", "reviews", "settings",
            "task_recurrences", "schema_version",
        ]
        data = {}
        for t in tables:
            try:
                data[t] = [dict(r) for r in conn.execute(f"SELECT * FROM {t}")]
            except sqlite3.OperationalError:
                data[t] = []
        data["_exported_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        return json.dumps(data, ensure_ascii=False, indent=2)
    finally:
        conn.close()
