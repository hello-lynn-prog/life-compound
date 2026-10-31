# -*- coding: utf-8 -*-
"""
通用 CRUD 工具：供各模块路由复用
================================
约定：
- 表名一律来自代码内白名单（路由函数里写死），不接受用户传入 → 无 SQL 注入风险
- 删除一律是软删除（写 deleted_at），进回收站
- 每个表都有 created_at / updated_at，由这里统一维护
"""
import sqlite3
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .db import get_conn, now_iso, row_to_dict, rows_to_dicts


def get_db():
    """FastAPI 依赖：每个请求一个独立连接，请求结束自动关闭"""
    conn = get_conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


class Resp(BaseModel):
    """统一响应格式"""
    ok: bool = True
    data: Any = None
    message: str = ""


def ok(data: Any = None, message: str = "") -> Resp:
    return Resp(ok=True, data=data, message=message)


def fail(message: str, status: int = 400) -> HTTPException:
    return HTTPException(status_code=status, detail=message)


# ---------------------------------------------------------------- 查询
def list_items(conn: sqlite3.Connection, table: str,
               where: str = "deleted_at IS NULL", params: tuple = (),
               order: str = "id DESC", limit: int = 0) -> list[dict]:
    sql = f"SELECT * FROM {table} WHERE {where} ORDER BY {order}"
    if limit:
        sql += f" LIMIT {limit}"
    return rows_to_dicts(conn.execute(sql, params).fetchall())


def get_item(conn: sqlite3.Connection, table: str, item_id: int,
             include_deleted: bool = False) -> dict | None:
    sql = f"SELECT * FROM {table} WHERE id = ?"
    if not include_deleted:
        sql += " AND deleted_at IS NULL"
    row = conn.execute(sql, (item_id,)).fetchone()
    return row_to_dict(row) if row else None


def require_item(conn, table: str, item_id: int) -> dict:
    """取不到就抛 404"""
    item = get_item(conn, table, item_id)
    if not item:
        raise fail(f"记录不存在：{table} #{item_id}", 404)
    return item


# ---------------------------------------------------------------- 写入
def create_item(conn: sqlite3.Connection, table: str, data: dict,
                required: list[str], fields: set[str]) -> dict:
    """插入一条记录；required 必填，fields 是允许写入的列白名单"""
    for key in required:
        if not data.get(key):
            raise fail(f"缺少必填字段：{key}")
    now = now_iso()
    cols, vals = [], []
    for key in fields:
        if key in data and data[key] is not None:
            cols.append(key)
            vals.append(_to_storable(data[key]))
    cols += ["created_at", "updated_at"]
    vals += [now, now]
    sql = f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})"
    cur = conn.execute(sql, vals)
    return get_item(conn, table, cur.lastrowid, include_deleted=True)


def update_item(conn: sqlite3.Connection, table: str, item_id: int,
                data: dict, fields: set[str]) -> dict | None:
    """只更新 data 里出现且在 fields 白名单里的列"""
    cols, vals = [], []
    for key in fields:
        if key in data:
            cols.append(f"{key} = ?")
            vals.append(_to_storable(data[key]))
    if not cols:
        return get_item(conn, table, item_id)
    cols.append("updated_at = ?")
    vals.append(now_iso())
    vals.append(item_id)
    conn.execute(f"UPDATE {table} SET {', '.join(cols)} WHERE id = ?", vals)
    return get_item(conn, table, item_id)


def soft_delete(conn: sqlite3.Connection, table: str, item_id: int) -> bool:
    """软删除：进回收站"""
    cur = conn.execute(
        f"UPDATE {table} SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
        (now_iso(), now_iso(), item_id),
    )
    return cur.rowcount > 0


def restore_item(conn: sqlite3.Connection, table: str, item_id: int) -> bool:
    """从回收站恢复"""
    cur = conn.execute(
        f"UPDATE {table} SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL",
        (now_iso(), item_id),
    )
    return cur.rowcount > 0


def _to_storable(value):
    """list/dict → JSON 字符串（对应表里的 tags 等列），其余原样"""
    if isinstance(value, (list, dict)):
        import json
        return json.dumps(value, ensure_ascii=False)
    return value


# ---------------------------------------------------------------- 回收站（全部表通用）
# 表名 -> (中文名, 用于展示的标题列名)
RECYCLE_TABLES = {
    "goals": ("目标", "title"), "projects": ("项目", "title"),
    "tasks": ("任务", "title"), "habits": ("习惯", "name"),
    "journals": ("日记", "title"), "notes": ("随手记", "content"),
    "knowledge": ("知识卡片", "title"), "achievements": ("成果", "title"),
    "skills": ("技能", "name"), "reviews": ("复盘", "content"),
}


def new_router(prefix: str) -> APIRouter:
    return APIRouter(prefix=prefix, tags=[prefix.strip("/")])
