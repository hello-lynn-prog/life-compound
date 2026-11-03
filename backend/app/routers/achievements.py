# -*- coding: utf-8 -*-
"""个人 IP 档案 API：成果（作品/里程碑/证书）+ 技能雷达 + 图片上传"""
import re
import sqlite3
import unicodedata
from pathlib import Path

from fastapi import APIRouter, Body, Depends, UploadFile

from ..crud import (create_item, get_db, list_items, new_router, ok,
                   require_item, soft_delete, update_item)
from ..db import UPLOAD_DIR

router = new_router("/api/achievements")

ACH_FIELDS = {"ach_type", "title", "description", "ach_date", "link",
              "image_path", "tags", "gallery", "category"}


@router.get("")
def list_achievements(ach_type: str = "", conn: sqlite3.Connection = Depends(get_db)):
    where, params = ["deleted_at IS NULL"], []
    if ach_type:
        where.append("ach_type = ?"); params.append(ach_type)
    items = list_items(conn, "achievements", " AND ".join(where), tuple(params),
                       order="ach_date DESC, id DESC")
    return ok(items)


@router.post("")
def create_achievement(data: dict = Body(...), conn: sqlite3.Connection = Depends(get_db)):
    item = create_item(conn, "achievements", data, required=["title"], fields=ACH_FIELDS)
    return ok(item)


@router.put("/{ach_id}")
def update_achievement(ach_id: int, data: dict = Body(...),
                       conn: sqlite3.Connection = Depends(get_db)):
    require_item(conn, "achievements", ach_id)
    return ok(update_item(conn, "achievements", ach_id, data, ACH_FIELDS))


@router.delete("/{ach_id}")
def delete_achievement(ach_id: int, conn: sqlite3.Connection = Depends(get_db)):
    require_item(conn, "achievements", ach_id)
    soft_delete(conn, "achievements", ach_id)
    return ok(message="已移入回收站")


# ================================================================ 技能（雷达图）
skill_router = new_router("/api/skills")
SKILL_FIELDS = {"name", "level", "icon", "sort"}


@skill_router.get("")
def list_skills(conn: sqlite3.Connection = Depends(get_db)):
    return ok(list_items(conn, "skills", "deleted_at IS NULL", (), order="sort, id"))


@skill_router.post("")
def create_skill(data: dict = Body(...), conn: sqlite3.Connection = Depends(get_db)):
    item = create_item(conn, "skills", data, required=["name"], fields=SKILL_FIELDS)
    return ok(item)


@skill_router.put("/{skill_id}")
def update_skill(skill_id: int, data: dict = Body(...),
                 conn: sqlite3.Connection = Depends(get_db)):
    require_item(conn, "skills", skill_id)
    return ok(update_item(conn, "skills", skill_id, data, SKILL_FIELDS))


@skill_router.delete("/{skill_id}")
def delete_skill(skill_id: int, conn: sqlite3.Connection = Depends(get_db)):
    require_item(conn, "skills", skill_id)
    soft_delete(conn, "skills", skill_id)
    return ok(message="已移入回收站")


# ================================================================ 图片上传（作品封面等）
upload_router = new_router("/api/uploads")

# 只允许这些图片扩展名，其他一律拒绝
ALLOWED_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB


def _safe_filename(name: str) -> str:
    """把上传文件名清洗成安全的 ASCII 文件名，防止路径穿越和乱码问题"""
    name = unicodedata.normalize("NFKD", Path(name).name)
    name = re.sub(r"[^\w.\-]", "_", name)
    return name[:80] or "upload.png"


@upload_router.post("/image")
async def upload_image(file: UploadFile):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_IMAGE_EXT:
        raise ValueError(f"不支持的图片格式：{ext}")
    content = await file.read()
    if len(content) > MAX_IMAGE_SIZE:
        raise ValueError("图片超过 10MB 限制")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    import time
    # 加时间戳前缀防止重名互相覆盖
    dest = UPLOAD_DIR / f"{int(time.time())}_{_safe_filename(file.filename or '')}"
    dest.write_bytes(content)
    return ok({"url": f"/api/uploads/files/{dest.name}"})


@upload_router.get("/files/{filename}")
def get_uploaded_file(filename: str):
    """访问已上传的图片（只允许 uploads 目录内的文件名，禁止路径穿越）"""
    from fastapi.responses import FileResponse
    safe = Path(filename).name  # 去掉路径部分
    target = UPLOAD_DIR / safe
    if not target.exists() or not target.is_file():
        from .crud import fail
        raise fail("文件不存在", 404)
    return FileResponse(target)
