# -*- coding: utf-8 -*-
"""复盘 API：周报/月报 + 本地规则自动草稿（不依赖任何 AI 服务）"""
import json
import sqlite3
from datetime import date, timedelta

from fastapi import APIRouter, Body, Depends

from ..crud import (create_item, get_db, list_items, new_router, ok,
                   require_item, soft_delete, update_item)

router = new_router("/api/reviews")

FIELDS = {"period_type", "period_start", "period_end", "content", "draft"}


def _week_range(ref: date | None = None) -> tuple[str, str]:
    """本周一 ~ 周日"""
    d = ref or date.today()
    monday = d - timedelta(days=d.weekday())
    return monday.isoformat(), (monday + timedelta(days=6)).isoformat()


def _month_range(ref: date | None = None) -> tuple[str, str]:
    d = ref or date.today()
    first = d.replace(day=1)
    if d.month == 12:
        nxt = first.replace(year=d.year + 1, month=1)
    else:
        nxt = first.replace(month=d.month + 1)
    return first.isoformat(), (nxt - timedelta(days=1)).isoformat()


@router.get("")
def list_reviews(period_type: str = "", conn: sqlite3.Connection = Depends(get_db)):
    where, params = ["deleted_at IS NULL"], []
    if period_type:
        where.append("period_type = ?"); params.append(period_type)
    items = list_items(conn, "reviews", " AND ".join(where), tuple(params),
                       order="period_start DESC")
    return ok(items)


@router.post("")
def create_review(data: dict = Body(...), conn: sqlite3.Connection = Depends(get_db)):
    item = create_item(conn, "reviews", data, required=["period_start", "period_end"],
                       fields=FIELDS)
    return ok(item)


@router.put("/{review_id}")
def update_review(review_id: int, data: dict = Body(...),
                  conn: sqlite3.Connection = Depends(get_db)):
    require_item(conn, "reviews", review_id)
    return ok(update_item(conn, "reviews", review_id, data, FIELDS))


@router.delete("/{review_id}")
def delete_review(review_id: int, conn: sqlite3.Connection = Depends(get_db)):
    require_item(conn, "reviews", review_id)
    soft_delete(conn, "reviews", review_id)
    return ok(message="已移入回收站")


# ---------------------------------------------------------------- 自动草稿
@router.post("/draft")
def make_draft(data: dict = Body(default={}), conn: sqlite3.Connection = Depends(get_db)):
    """
    本地规则生成复盘草稿：汇总区间内的任务/打卡/日记/知识数据，
    拼成模板文字。AI 不可用时它是纯统计；未来接 AI 也可以从这里扩展。
    """
    period_type = data.get("period_type", "weekly")
    ref = None
    if data.get("ref_date"):
        try:
            ref = date.fromisoformat(data["ref_date"])
        except ValueError:
            ref = None
    start_s, end_s = _week_range(ref) if period_type == "weekly" else _month_range(ref)
    unit = "本周" if period_type == "weekly" else "本月"

    # 1) 任务统计
    t = conn.execute(
        "SELECT COUNT(*) AS total, SUM(done) AS done_n FROM tasks "
        "WHERE deleted_at IS NULL AND task_date BETWEEN ? AND ?",
        (start_s, end_s),
    ).fetchone()
    total, done_n = t["total"] or 0, t["done_n"] or 0

    # 2) 打卡统计
    h = conn.execute(
        "SELECT COUNT(*) AS n FROM habit_logs l JOIN habits hb ON hb.id = l.habit_id "
        "WHERE l.deleted_at IS NULL AND hb.deleted_at IS NULL AND l.log_date BETWEEN ? AND ?",
        (start_s, end_s),
    ).fetchone()
    checkins = h["n"] or 0

    # 3) 日记篇数 + 平均心情
    j = conn.execute(
        "SELECT COUNT(*) AS n, AVG(mood) AS avg_mood FROM journals "
        "WHERE deleted_at IS NULL AND journal_date BETWEEN ? AND ? AND mood IS NOT NULL",
        (start_s, end_s),
    ).fetchone()
    journals_n, avg_mood = j["n"] or 0, round(j["avg_mood"], 1) if j["avg_mood"] else None

    # 4) 新增知识卡片
    k = conn.execute(
        "SELECT COUNT(*) AS n FROM knowledge "
        "WHERE deleted_at IS NULL AND created_at BETWEEN ? AND ?",
        (start_s, end_s + "T23:59:59"),
    ).fetchone()
    cards_n = k["n"] or 0

    # 5) 完成的任务标题（挑最多 8 条做亮点）
    highlights = [r["title"] for r in conn.execute(
        "SELECT title FROM tasks WHERE deleted_at IS NULL AND done = 1 "
        "AND task_date BETWEEN ? AND ? ORDER BY task_date DESC LIMIT 8",
        (start_s, end_s),
    ).fetchall()]

    mood_text = f"平均心情 {avg_mood}/5" if avg_mood else "心情记录不多"
    draft_lines = [
        f"## {unit}数据一览（{start_s} ~ {end_s}）",
        f"- ✅ 完成任务 {done_n} / {total}",
        f"- 📌 习惯打卡 {checkins} 次",
        f"- 📔 写了 {journals_n} 篇日记（{mood_text}）",
        f"- 💡 新增 {cards_n} 张知识卡片",
        "",
        "## 值得表扬的事",
        *(f"- {h_}" for h_ in highlights),
        "",
        "## 本周想改进的事",
        "- （写写哪里卡住了？）",
        "",
        "## 下周想尝试的小改变",
        "- （一件小事就好）",
    ]
    return ok({
        "period_type": period_type,
        "period_start": start_s,
        "period_end": end_s,
        "stats": {"tasks_total": total, "tasks_done": done_n, "checkins": checkins,
                  "journals": journals_n, "avg_mood": avg_mood, "cards": cards_n,
                  "highlights": highlights},
        "draft": "\n".join(draft_lines),
    })
