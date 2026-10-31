# -*- coding: utf-8 -*-
"""读书 API：书架（在读/读完/想读）+ 进度 + 评分 + 读书笔记"""
import sqlite3

from fastapi import APIRouter, Body, Depends

from ..crud import (create_item, get_db, list_items, new_router, ok,
                    require_item, soft_delete, update_item)

router = new_router("/api/books")

FIELDS = {"title", "author", "status", "progress", "rating",
          "started_date", "finished_date", "notes"}

STATUS_LABEL = {"reading": "在读", "finished": "读完", "wishlist": "想读"}


@router.get("")
def list_books(status: str = "", conn: sqlite3.Connection = Depends(get_db)):
    """书单（在读在前、读完按读完日期倒序、想读最后）；status 可筛选"""
    where, params = ["deleted_at IS NULL"], []
    if status:
        where.append("status = ?"); params.append(status)
    items = list_items(conn, "books", " AND ".join(where), tuple(params),
                       order="CASE status WHEN 'reading' THEN 0 WHEN 'finished' THEN 1 ELSE 2 END, id DESC")
    for b in items:
        b["status_label"] = STATUS_LABEL.get(b["status"], b["status"])
    return ok(items)


@router.post("")
def create_book(data: dict = Body(...), conn: sqlite3.Connection = Depends(get_db)):
    if data.get("status") == "finished" and not data.get("progress"):
        data["progress"] = 100  # 标记读完 = 进度拉满
    item = create_item(conn, "books", data, required=["title"], fields=FIELDS)
    return ok(item)


@router.put("/{book_id}")
def update_book(book_id: int, data: dict = Body(...),
                conn: sqlite3.Connection = Depends(get_db)):
    require_item(conn, "books", book_id)
    if data.get("status") == "finished":
        data.setdefault("progress", 100)
        if data.get("progress", 0) < 100:
            data["progress"] = 100
    return ok(update_item(conn, "books", book_id, data, FIELDS))


@router.delete("/{book_id}")
def delete_book(book_id: int, conn: sqlite3.Connection = Depends(get_db)):
    require_item(conn, "books", book_id)
    soft_delete(conn, "books", book_id)
    return ok(message="已移入回收站")
