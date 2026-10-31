# -*- coding: utf-8 -*-
"""知识卡片 API"""
import sqlite3

from fastapi import APIRouter, Body, Depends

from ..crud import (create_item, get_db, list_items, new_router, ok,
                   require_item, soft_delete, update_item)
from ..db import now_iso

router = new_router("/api/knowledge")

FIELDS = {"title", "content", "category", "tags", "source",
          "review_count", "last_review_at", "image_path"}


@router.get("")
def list_knowledge(q: str = "", category: str = "", tag: str = "",
                   limit: int = 200, conn: sqlite3.Connection = Depends(get_db)):
    """支持关键词 / 分类 / 标签筛选"""
    where, params = ["deleted_at IS NULL"], []
    if q:
        where.append("(title LIKE ? OR content LIKE ? OR source LIKE ?)")
        params += [f"%{q}%"] * 3
    if category:
        where.append("category = ?"); params.append(category)
    if tag:  # tags 存 JSON 数组文本，直接 LIKE 匹配标签名
        where.append("tags LIKE ?"); params.append(f'%"{tag}"%')
    items = list_items(conn, "knowledge", " AND ".join(where), tuple(params),
                       order="id DESC", limit=limit)
    return ok(items)


@router.post("")
def create_card(data: dict = Body(...), conn: sqlite3.Connection = Depends(get_db)):
    item = create_item(conn, "knowledge", data, required=["title"], fields=FIELDS)
    return ok(item)


@router.put("/{card_id}")
def update_card(card_id: int, data: dict = Body(...),
                conn: sqlite3.Connection = Depends(get_db)):
    require_item(conn, "knowledge", card_id)
    return ok(update_item(conn, "knowledge", card_id, data, FIELDS))


@router.post("/{card_id}/review")
def review_card(card_id: int, conn: sqlite3.Connection = Depends(get_db)):
    """点"再复习一遍"：复习次数 +1，记录时间"""
    card = require_item(conn, "knowledge", card_id)
    conn.execute(
        "UPDATE knowledge SET review_count = ?, last_review_at = ?, updated_at = ? WHERE id = ?",
        (card["review_count"] + 1, now_iso(), now_iso(), card_id),
    )
    return ok({"review_count": card["review_count"] + 1})


@router.delete("/{card_id}")
def delete_card(card_id: int, conn: sqlite3.Connection = Depends(get_db)):
    require_item(conn, "knowledge", card_id)
    soft_delete(conn, "knowledge", card_id)
    return ok(message="已移入回收站")
