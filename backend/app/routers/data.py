# -*- coding: utf-8 -*-
"""数据中心 API：备份 / 恢复 / 导出 / 回收站 / 设置"""
import sqlite3

from fastapi import APIRouter, Body, Depends, UploadFile
from fastapi.responses import FileResponse

from ..backup import (backup_db, export_json, export_zip, import_zip,
                      list_backups, restore_db)
from ..crud import (RECYCLE_TABLES, fail, get_db, new_router, ok, restore_item)
from ..db import DATA_DIR

router = new_router("/api/data")


@router.get("/backups")
def get_backups():
    return ok(list_backups())


@router.post("/backups")
def make_backup():
    path = backup_db("manual")
    return ok({"file": path.name}, message="备份完成")


@router.post("/restore")
def do_restore(data: dict = Body(...)):
    """从指定备份恢复（恢复后前端应提示用户重启应用）"""
    result = restore_db(data.get("file", ""))
    return ok(result, message="恢复完成，请关闭并重新启动应用")


@router.get("/export-json")
def do_export_json():
    """全量 JSON 导出（浏览器下载）"""
    import tempfile
    path = DATA_DIR / "全量导出.json"
    path.write_text(export_json(), encoding="utf-8")
    return FileResponse(path, filename="人生复利系统_全量导出.json",
                        media_type="application/json")


@router.get("/export-zip")
def do_export_zip():
    """全量 ZIP 导出（数据库 + 附件）"""
    path = export_zip()
    return FileResponse(path, filename=path.name, media_type="application/zip")


@router.post("/import-zip")
async def do_import_zip(file: UploadFile):
    """导入之前导出的 ZIP 备份"""
    tmp = DATA_DIR / "import_tmp.zip"
    content = await file.read()
    if len(content) > 200 * 1024 * 1024:
        raise fail("导入文件超过 200MB 限制")
    tmp.write_bytes(content)
    try:
        result = import_zip(str(tmp))
    except ValueError as e:
        raise fail(str(e))
    finally:
        tmp.unlink(missing_ok=True)
    return ok(result, message="导入完成，请重启应用")


# ---------------------------------------------------------------- 回收站
@router.get("/recycle")
def recycle_list(conn: sqlite3.Connection = Depends(get_db)):
    """列出所有软删除的记录，按删除时间倒序"""
    items = []
    for table, (label, title_col) in RECYCLE_TABLES.items():
        rows = conn.execute(
            f"SELECT id, deleted_at, {title_col} AS label FROM {table} "
            f"WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 50"
        ).fetchall()
        for r in rows:
            text = (r["label"] or "").strip()
            items.append({
                "table": table, "table_label": label, "id": r["id"],
                "title": (text[:40] + "…") if len(text) > 40 else text
                         or f"{label} #{r['id']}",
                "deleted_at": r["deleted_at"],
            })
    items.sort(key=lambda x: x["deleted_at"], reverse=True)
    return ok(items)


@router.post("/recycle/restore")
def recycle_restore(data: dict = Body(...)):
    """从回收站恢复一条记录"""
    table = data.get("table", "")
    if table not in RECYCLE_TABLES:
        raise fail("未知的表")
    conn = _get_raw_conn()
    try:
        restored = restore_item(conn, table, int(data.get("id", 0)))
        conn.commit()
    finally:
        conn.close()
    if not restored:
        raise fail("恢复失败，记录可能不存在")
    return ok(message="已恢复")


@router.post("/recycle/purge")
def recycle_purge(data: dict = Body(...)):
    """彻底删除一条记录（不可恢复，前端要二次确认）"""
    table = data.get("table", "")
    if table not in RECYCLE_TABLES:
        raise fail("未知的表")
    conn = _get_raw_conn()
    cur = conn.execute(
        f"DELETE FROM {table} WHERE id = ? AND deleted_at IS NOT NULL",
        (int(data.get("id", 0)),),
    )
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        raise fail("删除失败，记录可能不存在")
    return ok(message="已彻底删除")


def _get_raw_conn():
    """回收站操作不走请求级连接（要自己管理事务）"""
    from ..db import get_conn
    return get_conn()


# ---------------------------------------------------------------- 设置
@router.get("/settings")
def get_settings(conn: sqlite3.Connection = Depends(get_db)):
    rows = conn.execute("SELECT key, value FROM settings").fetchall()
    return ok({r["key"]: r["value"] for r in rows})


@router.post("/settings")
def set_setting(data: dict = Body(...), conn: sqlite3.Connection = Depends(get_db)):
    for key, value in data.items():
        if not isinstance(key, str) or len(key) > 64:
            continue
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, str(value)),
        )
    return ok(message="设置已保存")
