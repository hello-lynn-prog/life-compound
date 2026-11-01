# -*- coding: utf-8 -*-
"""目标与项目 API：四级结构 方向 → 阶段目标 → 项目 → 任务"""
import sqlite3

from fastapi import APIRouter, Body, Depends

from ..crud import (create_item, get_db, list_items, new_router, ok,
                   require_item, soft_delete, update_item)

router = new_router("/api/goals")

FIELDS = {"parent_id", "type", "title", "color", "description",
          "start_date", "due_date", "status", "sort"}


def _goal_progress(conn: sqlite3.Connection, goal_id: int) -> dict:
    """
    算一个目标下的任务完成进度。
    层级是 方向 → 阶段目标 → 项目 → 任务，所以要同时算：
    直接挂在本目标下的任务/项目 + 挂在子目标（阶段目标）下的任务/项目
    """
    row = conn.execute(
        "SELECT COUNT(*) AS total, SUM(done) AS done_n FROM tasks "
        "WHERE deleted_at IS NULL AND ("
        "  goal_id = ? OR goal_id IN (SELECT id FROM goals WHERE parent_id = ? AND deleted_at IS NULL) OR "
        "  project_id IN (SELECT id FROM projects WHERE deleted_at IS NULL AND ("
        "    goal_id = ? OR goal_id IN (SELECT id FROM goals WHERE parent_id = ? AND deleted_at IS NULL))))",
        (goal_id, goal_id, goal_id, goal_id),
    ).fetchone()
    total = row["total"] or 0
    done_n = row["done_n"] or 0
    return {"total": total, "done": done_n,
            "percent": round(done_n / total * 100) if total else 0}


@router.get("")
def list_goals(type_: str = "", status: str = "",
               conn: sqlite3.Connection = Depends(get_db)):
    where, params = ["deleted_at IS NULL"], []
    if type_:
        where.append("type = ?"); params.append(type_)
    if status:
        where.append("status = ?"); params.append(status)
    items = list_items(conn, "goals", " AND ".join(where), tuple(params),
                       order="sort, id")
    for g in items:
        g["progress"] = _goal_progress(conn, g["id"])
    return ok(items)


@router.get("/tree")
def goals_tree(conn: sqlite3.Connection = Depends(get_db)):
    """树状结构：方向 → 阶段目标 → 项目（各层带进度），给目标页一次拿全"""
    directions = list_items(conn, "goals", "deleted_at IS NULL AND type = 'direction'",
                            (), order="sort, id")
    stage_goals = list_items(conn, "goals", "deleted_at IS NULL AND type = 'stage_goal'",
                             (), order="sort, id")
    projects = list_items(conn, "projects", "deleted_at IS NULL", (), order="sort, id")
    # 挂项目进度
    for p in projects:
        row = conn.execute(
            "SELECT COUNT(*) AS total, SUM(done) AS done_n FROM tasks "
            "WHERE deleted_at IS NULL AND project_id = ?",
            (p["id"],),
        ).fetchone()
        total, done_n = row["total"] or 0, row["done_n"] or 0
        p["progress"] = {"total": total, "done": done_n,
                         "percent": round(done_n / total * 100) if total else 0}
    # 目标聚合进度：自己的任务 + 项目任务
    for g in stage_goals + directions:
        g["projects"] = [p for p in projects if p["goal_id"] == g["id"]]
        g["progress"] = _goal_progress(conn, g["id"])
    for d in directions:
        d["children"] = [g for g in stage_goals if g["parent_id"] == d["id"]]
    # 没挂方向下的阶段目标也单独成组
    orphans = [g for g in stage_goals if not g["parent_id"]]
    return ok({"directions": directions, "standalone_goals": orphans})


@router.post("")
def create_goal(data: dict = Body(...), conn: sqlite3.Connection = Depends(get_db)):
    if "type" not in data:
        data["type"] = "stage_goal"
    item = create_item(conn, "goals", data, required=["title"], fields=FIELDS)
    return ok(item)


@router.put("/{goal_id}")
def update_goal(goal_id: int, data: dict = Body(...),
                conn: sqlite3.Connection = Depends(get_db)):
    require_item(conn, "goals", goal_id)
    return ok(update_item(conn, "goals", goal_id, data, FIELDS))


@router.delete("/{goal_id}")
def delete_goal(goal_id: int, conn: sqlite3.Connection = Depends(get_db)):
    require_item(conn, "goals", goal_id)
    soft_delete(conn, "goals", goal_id)
    return ok(message="已移入回收站")


# ================================================================ 项目
proj_router = new_router("/api/projects")
PROJ_FIELDS = {"goal_id", "title", "description", "color", "status",
               "start_date", "due_date", "sort", "knowledge_ids"}


@proj_router.get("")
def list_projects(goal_id: int = 0, conn: sqlite3.Connection = Depends(get_db)):
    where, params = ["deleted_at IS NULL"], []
    if goal_id:
        where.append("goal_id = ?"); params.append(goal_id)
    items = list_items(conn, "projects", " AND ".join(where), tuple(params),
                       order="sort, id")
    for p in items:
        row = conn.execute(
            "SELECT COUNT(*) AS total, SUM(done) AS done_n FROM tasks "
            "WHERE deleted_at IS NULL AND project_id = ?",
            (p["id"],),
        ).fetchone()
        total, done_n = row["total"] or 0, row["done_n"] or 0
        p["progress"] = {"total": total, "done": done_n,
                         "percent": round(done_n / total * 100) if total else 0}
    return ok(items)


@proj_router.post("")
def create_project(data: dict = Body(...), conn: sqlite3.Connection = Depends(get_db)):
    item = create_item(conn, "projects", data, required=["title"], fields=PROJ_FIELDS)
    return ok(item)


@proj_router.put("/{project_id}")
def update_project(project_id: int, data: dict = Body(...),
                   conn: sqlite3.Connection = Depends(get_db)):
    require_item(conn, "projects", project_id)
    return ok(update_item(conn, "projects", project_id, data, PROJ_FIELDS))


@proj_router.delete("/{project_id}")
def delete_project(project_id: int, conn: sqlite3.Connection = Depends(get_db)):
    require_item(conn, "projects", project_id)
    soft_delete(conn, "projects", project_id)
    return ok(message="已移入回收站")
