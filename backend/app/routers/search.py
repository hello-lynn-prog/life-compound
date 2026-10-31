# -*- coding: utf-8 -*-
"""全局搜索 API：Ctrl+K 一次搜任务 / 日记 / 随手记 / 知识 / 成果"""
import sqlite3

from fastapi import APIRouter, Depends

from ..crud import get_db, new_router, ok

router = new_router("/api/search")


@router.get("")
def global_search(q: str, conn: sqlite3.Connection = Depends(get_db)):
    """关键词跨表搜索，每类最多返回 8 条"""
    q = (q or "").strip()
    if not q:
        return ok({"tasks": [], "journals": [], "notes": [],
                   "knowledge": [], "achievements": []})
    like = f"%{q}%"
    out = {"tasks": [], "journals": [], "notes": [], "knowledge": [], "achievements": []}

    out["tasks"] = [dict(r) for r in conn.execute(
        "SELECT id, title, task_date, done FROM tasks "
        "WHERE deleted_at IS NULL AND (title LIKE ? OR notes LIKE ?) "
        "ORDER BY task_date DESC LIMIT 8", (like, like))]
    out["journals"] = [dict(r) for r in conn.execute(
        "SELECT id, title, journal_date, mood FROM journals "
        "WHERE deleted_at IS NULL AND (title LIKE ? OR content LIKE ?) "
        "ORDER BY journal_date DESC LIMIT 8", (like, like))]
    out["notes"] = [dict(r) for r in conn.execute(
        "SELECT id, content, created_at FROM notes "
        "WHERE deleted_at IS NULL AND became_journal_id IS NULL AND content LIKE ? "
        "ORDER BY id DESC LIMIT 8", (like,))]
    out["knowledge"] = [dict(r) for r in conn.execute(
        "SELECT id, title, category FROM knowledge "
        "WHERE deleted_at IS NULL AND (title LIKE ? OR content LIKE ?) "
        "ORDER BY id DESC LIMIT 8", (like, like))]
    out["achievements"] = [dict(r) for r in conn.execute(
        "SELECT id, title, ach_type, ach_date FROM achievements "
        "WHERE deleted_at IS NULL AND (title LIKE ? OR description LIKE ?) "
        "ORDER BY ach_date DESC LIMIT 8", (like, like))]
    return ok(out)
