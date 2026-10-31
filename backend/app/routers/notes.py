# -*- coding: utf-8 -*-
"""随手记（便签）API"""
import sqlite3

from fastapi import APIRouter, Body, Depends

from ..crud import (create_item, get_db, list_items, new_router, ok,
                   require_item, soft_delete, update_item)
from ..db import now_iso, row_to_dict

router = new_router("/api/notes")

FIELDS = {"content", "color", "pinned"}


@router.get("")
def list_notes(conn: sqlite3.Connection = Depends(get_db)):
    """置顶的在前，新的优先"""
    items = list_items(conn, "notes", "deleted_at IS NULL AND became_journal_id IS NULL",
                       (), order="pinned DESC, id DESC")
    return ok(items)


@router.post("")
def create_note(data: dict = Body(...), conn: sqlite3.Connection = Depends(get_db)):
    item = create_item(conn, "notes", data, required=["content"], fields=FIELDS)
    return ok(item)


@router.put("/{note_id}")
def update_note(note_id: int, data: dict = Body(...),
                conn: sqlite3.Connection = Depends(get_db)):
    require_item(conn, "notes", note_id)
    return ok(update_item(conn, "notes", note_id, data, FIELDS))


@router.delete("/{note_id}")
def delete_note(note_id: int, conn: sqlite3.Connection = Depends(get_db)):
    require_item(conn, "notes", note_id)
    soft_delete(conn, "notes", note_id)
    return ok(message="已移入回收站")


@router.post("/{note_id}/to-journal")
def note_to_journal(note_id: int, conn: sqlite3.Connection = Depends(get_db)):
    """把一条随手记升级成一篇日记（内容带过去，原便签标记去向）"""
    note = require_item(conn, "notes", note_id)
    now = now_iso()
    cur = conn.execute(
        "INSERT INTO journals (journal_date, title, content, tags, created_at, updated_at) "
        "VALUES (?, '', ?, '[]', ?, ?)",
        (now[:10], note["content"], now, now),
    )
    conn.execute(
        "UPDATE notes SET became_journal_id = ?, updated_at = ? WHERE id = ?",
        (cur.lastrowid, now, note_id),
    )
    return ok({"journal_id": cur.lastrowid})
