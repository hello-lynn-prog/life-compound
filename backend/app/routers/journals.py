# -*- coding: utf-8 -*-
"""日记 API"""
import sqlite3

from fastapi import APIRouter, Body, Depends

from ..crud import (create_item, get_db, list_items, new_router, ok,
                   require_item, soft_delete, update_item)
from ..db import today_str

router = new_router("/api/journals")

FIELDS = {"journal_date", "mood", "weather", "title", "content", "tags"}


@router.get("")
def list_journals(from_: str = "", to: str = "", date: str = "", q: str = "",
                  limit: int = 100, conn: sqlite3.Connection = Depends(get_db)):
    """按日期范围 / 关键词查日记（新的在前）"""
    where, params = ["deleted_at IS NULL"], []
    if date:
        where.append("journal_date = ?"); params.append(date)
    else:
        if from_:
            where.append("journal_date >= ?"); params.append(from_)
        if to:
            where.append("journal_date <= ?"); params.append(to)
    if q:  # 关键词同时搜标题和正文
        where.append("(title LIKE ? OR content LIKE ?)")
        params += [f"%{q}%", f"%{q}%"]
    items = list_items(conn, "journals", " AND ".join(where), tuple(params),
                       order="journal_date DESC, id DESC", limit=limit)
    return ok(items)


@router.post("")
def create_journal(data: dict = Body(...), conn: sqlite3.Connection = Depends(get_db)):
    if not data.get("journal_date"):
        data["journal_date"] = today_str()
    item = create_item(conn, "journals", data, required=["journal_date"], fields=FIELDS)
    return ok(item)


@router.put("/{journal_id}")
def update_journal(journal_id: int, data: dict = Body(...),
                   conn: sqlite3.Connection = Depends(get_db)):
    require_item(conn, "journals", journal_id)
    return ok(update_item(conn, "journals", journal_id, data, FIELDS))


@router.delete("/{journal_id}")
def delete_journal(journal_id: int, conn: sqlite3.Connection = Depends(get_db)):
    require_item(conn, "journals", journal_id)
    soft_delete(conn, "journals", journal_id)
    return ok(message="已移入回收站")
