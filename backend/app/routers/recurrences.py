# -*- coding: utf-8 -*-
"""
重复任务规则 API：定义"模板"，每天自动生成当天的任务实例
======================================================
- repeat_type: daily（每天）/ weekdays（周一~周五）/ weekly（每周几，看 weekdays）
- 生成时机：查询某天的任务时（GET /api/tasks?date=）自动补齐当天该出现的实例
- 用户删除某天生成的实例后，当天不会再重新生成（软删除即视为"已处理"）
"""
import json
import sqlite3
from datetime import date

from fastapi import APIRouter, Body, Depends

from ..crud import (create_item, get_db, list_items, new_router, ok,
                    require_item, soft_delete, update_item)
from ..db import now_iso

router = new_router("/api/recurrences")

FIELDS = {"title", "notes", "priority", "goal_id", "project_id",
          "repeat_type", "weekdays", "archived"}


def _should_generate(rec: dict, day: date) -> bool:
    """规则在某天是否该出现"""
    rtype = rec["repeat_type"]
    if rtype == "daily":
        return True
    if rtype == "weekdays":
        return day.weekday() < 5          # 周一~周五
    if rtype == "weekly":
        try:
            weekdays = json.loads(rec["weekdays"] or "[]")
        except json.JSONDecodeError:
            weekdays = []
        # 存储约定 0=周一 ... 6=周日（与 Python weekday() 一致）
        return day.weekday() in weekdays
    return False


def materialize(conn: sqlite3.Connection, date_str: str) -> int:
    """
    给指定日期补齐重复任务的实例（打开今日页时由 tasks 查询触发）。
    返回新生成的数量。已存在实例（含被软删除的）不会重复生成。
    """
    try:
        day = date.fromisoformat(date_str)
    except ValueError:
        return 0
    rules = list_items(conn, "task_recurrences",
                       "deleted_at IS NULL AND archived = 0", (), order="id")
    created = 0
    for rec in rules:
        if not _should_generate(rec, day):
            continue
        row = conn.execute(
            "SELECT 1 FROM tasks WHERE recurrence_id = ? AND task_date = ? LIMIT 1",
            (rec["id"], date_str),
        ).fetchone()
        if row:  # 当天已有实例（或用户已删除过）→ 跳过
            continue
        conn.execute(
            "INSERT INTO tasks (project_id, goal_id, title, notes, task_date, "
            "priority, recurrence_id, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (rec["project_id"], rec["goal_id"], rec["title"], rec["notes"],
             date_str, rec["priority"], rec["id"], now_iso(), now_iso()),
        )
        created += 1
    return created


@router.get("")
def list_recurrences(conn: sqlite3.Connection = Depends(get_db)):
    items = list_items(conn, "task_recurrences", "deleted_at IS NULL", (), order="id")
    for r in items:
        r["weekdays"] = json.loads(r["weekdays"] or "[]")
        # 顺便带出这条规则今天有没有生成实例
        row = conn.execute(
            "SELECT id, done FROM tasks WHERE recurrence_id = ? AND task_date = ? "
            "AND deleted_at IS NULL LIMIT 1",
            (r["id"], date.today().isoformat()),
        ).fetchone()
        r["today_task_id"] = row["id"] if row else None
        r["today_done"] = bool(row["done"]) if row else False
    return ok(items)


@router.post("")
def create_recurrence(data: dict = Body(...), conn: sqlite3.Connection = Depends(get_db)):
    if data.get("repeat_type") not in ("daily", "weekdays", "weekly"):
        data["repeat_type"] = "daily"
    item = create_item(conn, "task_recurrences", data, required=["title"], fields=FIELDS)
    return ok(item)


@router.put("/{rec_id}")
def update_recurrence(rec_id: int, data: dict = Body(...),
                      conn: sqlite3.Connection = Depends(get_db)):
    require_item(conn, "task_recurrences", rec_id)
    return ok(update_item(conn, "task_recurrences", rec_id, data, FIELDS))


@router.delete("/{rec_id}")
def delete_recurrence(rec_id: int, conn: sqlite3.Connection = Depends(get_db)):
    """删除规则（已生成的历史任务不受影响）"""
    require_item(conn, "task_recurrences", rec_id)
    soft_delete(conn, "task_recurrences", rec_id)
    return ok(message="规则已删除，历史任务保留")
