# -*- coding: utf-8 -*-
"""任务（每日行动）API"""
from fastapi import APIRouter, Body, Depends
import sqlite3

from ..crud import (create_item, get_db, list_items, new_router, ok,
                   require_item, soft_delete, update_item)
from ..db import now_iso
from .recurrences import materialize

router = new_router("/api/tasks")

# 允许前端提交/修改的字段白名单（recurrence_id 由后端生成实例时写入，
# summary 是"今日总结"，category 是分类标签，都开放给通用更新）
FIELDS = {"title", "notes", "task_date", "done", "priority", "goal_id",
          "project_id", "estimate_min", "done_at", "summary", "category",
          "knowledge_ids"}


@router.get("")
def list_tasks(date: str = "", from_: str = "", to: str = "",
               goal_id: int = 0, project_id: int = 0, include_done: int = 1,
               conn: sqlite3.Connection = Depends(get_db)):
    """按日期/范围/关联查任务；include_done=0 时只看未完成。
    指定单日查询时，先自动补齐当天的重复任务实例（打开今日页即生成）。"""
    if date:
        materialize(conn, date)
    where, params = ["deleted_at IS NULL"], []
    if date:
        where.append("task_date = ?"); params.append(date)
    if from_:
        where.append("task_date >= ?"); params.append(from_)
    if to:
        where.append("task_date <= ?"); params.append(to)
    if goal_id:
        where.append("goal_id = ?"); params.append(goal_id)
    if project_id:
        where.append("project_id = ?"); params.append(project_id)
    if not include_done:
        where.append("done = 0")
    params = tuple(params)
    items = list_items(conn, "tasks", " AND ".join(where), params,
                       order="priority DESC, id DESC")
    return ok(items)


@router.post("")
def create_task(data: dict = Body(...), conn: sqlite3.Connection = Depends(get_db)):
    item = create_item(conn, "tasks", data, required=["title", "task_date"], fields=FIELDS)
    return ok(item)


@router.post("/{task_id}/toggle")
def toggle_task(task_id: int, conn: sqlite3.Connection = Depends(get_db)):
    """一键打勾 / 取消打勾"""
    task = require_item(conn, "tasks", task_id)
    new_done = 0 if task["done"] else 1
    conn.execute(
        "UPDATE tasks SET done = ?, done_at = ?, updated_at = ? WHERE id = ?",
        (new_done, now_iso() if new_done else None, now_iso(), task_id),
    )
    return ok({**task, "done": new_done})


@router.put("/{task_id}")
def update_task(task_id: int, data: dict = Body(...),
                conn: sqlite3.Connection = Depends(get_db)):
    require_item(conn, "tasks", task_id)
    return ok(update_item(conn, "tasks", task_id, data, FIELDS))


@router.delete("/{task_id}")
def delete_task(task_id: int, conn: sqlite3.Connection = Depends(get_db)):
    require_item(conn, "tasks", task_id)
    soft_delete(conn, "tasks", task_id)
    return ok(message="已移入回收站")
