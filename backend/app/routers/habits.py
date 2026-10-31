# -*- coding: utf-8 -*-
"""习惯打卡 API"""
import sqlite3

from fastapi import APIRouter, Body, Depends

from ..crud import (create_item, get_db, list_items, new_router, ok,
                   require_item, soft_delete, update_item)
from ..db import now_iso, today_str

router = new_router("/api/habits")

FIELDS = {"name", "icon", "color", "sort", "archived"}


@router.get("")
def list_habits(include_archived: int = 0, conn: sqlite3.Connection = Depends(get_db)):
    where = "deleted_at IS NULL" + ("" if include_archived else " AND archived = 0")
    items = list_items(conn, "habits", where, (), order="sort, id")
    # 顺便带上每个习惯今天的打卡状态，首页一次请求拿全
    for h in items:
        row = conn.execute(
            "SELECT 1 FROM habit_logs WHERE habit_id = ? AND log_date = ? AND deleted_at IS NULL",
            (h["id"], today_str()),
        ).fetchone()
        h["checked_today"] = bool(row)
    return ok(items)


@router.post("")
def create_habit(data: dict = Body(...), conn: sqlite3.Connection = Depends(get_db)):
    item = create_item(conn, "habits", data, required=["name"], fields=FIELDS)
    return ok(item)


@router.put("/{habit_id}")
def update_habit(habit_id: int, data: dict = Body(...),
                 conn: sqlite3.Connection = Depends(get_db)):
    require_item(conn, "habits", habit_id)
    return ok(update_item(conn, "habits", habit_id, data, FIELDS))


@router.delete("/{habit_id}")
def delete_habit(habit_id: int, conn: sqlite3.Connection = Depends(get_db)):
    require_item(conn, "habits", habit_id)
    soft_delete(conn, "habits", habit_id)
    return ok(message="已移入回收站")


# ---------------------------------------------------------------- 打卡记录
@router.post("/{habit_id}/checkin")
def checkin(habit_id: int, date: str = "", conn: sqlite3.Connection = Depends(get_db)):
    """给习惯在某天打卡/取消打卡（再点一次就是取消）"""
    require_item(conn, "habits", habit_id)
    log_date = date or today_str()
    # 查记录时包含已取消（软删除）的：同一习惯同一天只有一行记录，
    # 取消后再打卡要"复活"原记录，直接 INSERT 会撞 UNIQUE 约束
    row = conn.execute(
        "SELECT id, deleted_at FROM habit_logs WHERE habit_id = ? AND log_date = ?",
        (habit_id, log_date),
    ).fetchone()
    if row and row["deleted_at"] is None:  # 已打卡 → 取消
        conn.execute(
            "UPDATE habit_logs SET deleted_at = ? WHERE id = ?", (now_iso(), row["id"])
        )
        return ok({"checked": False})
    if row:  # 之前取消过 → 恢复这条记录
        conn.execute(
            "UPDATE habit_logs SET deleted_at = NULL WHERE id = ?", (row["id"],)
        )
        return ok({"checked": True})
    conn.execute(
        "INSERT INTO habit_logs (habit_id, log_date, created_at) VALUES (?, ?, ?)",
        (habit_id, log_date, now_iso()),
    )
    return ok({"checked": True})


@router.get("/logs")
def habit_logs(from_: str = "", to: str = "",
               conn: sqlite3.Connection = Depends(get_db)):
    """查一段时间的打卡记录（热力图/完成率用）"""
    where, params = ["h.deleted_at IS NULL", "l.deleted_at IS NULL"], []
    if from_:
        where.append("l.log_date >= ?"); params.append(from_)
    if to:
        where.append("l.log_date <= ?"); params.append(to)
    rows = conn.execute(
        f"SELECT l.habit_id, l.log_date FROM habit_logs l "
        f"JOIN habits h ON h.id = l.habit_id WHERE {' AND '.join(where)}",
        tuple(params),
    ).fetchall()
    return ok([dict(r) for r in rows])
