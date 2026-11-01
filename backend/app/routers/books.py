# -*- coding: utf-8 -*-
"""读书 API：书架（在读/读完/想读）+ 进度 + 评分 + 读书笔记 + 网上找书封"""
import re
import sqlite3
import time
import urllib.parse
import urllib.request

from fastapi import APIRouter, Body, Depends

from ..crud import (create_item, get_db, list_items, new_router, ok,
                    require_item, soft_delete, update_item)
from ..db import UPLOAD_DIR

router = new_router("/api/books")

FIELDS = {"title", "author", "status", "progress", "rating",
          "started_date", "finished_date", "notes", "cover_path"}

STATUS_LABEL = {"reading": "在读", "finished": "读完", "wishlist": "想读"}

# 豆瓣请求需要带浏览器 UA，否则会被拒绝
_DOUBAN_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

# 强制直连（不走系统代理）——代理对豆瓣图床会拦截/报 400
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

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


# ================================================================ 网上找书封（豆瓣）
@router.get("/search-cover")
def search_cover(q: str):
    """按书名（可带作者）在豆瓣搜书封，返回候选列表"""
    q = (q or "").strip()
    if not q:
        return ok({"candidates": []})
    try:
        url = ("https://www.douban.com/search?cat=1001&q="
               + urllib.parse.quote(q))
        req = urllib.request.Request(url, headers={"User-Agent": _DOUBAN_UA})
        with _OPENER.open(req, timeout=10) as r:
            html = r.read().decode("utf-8", errors="ignore")
    except Exception:
        return ok({"candidates": [], "message": "搜索服务暂时不可达，可以手动上传封面"})

    candidates = []
    for block in html.split('class="result"')[1:6]:  # 最多取前 5 条
        img = re.search(r'https://img\d\.doubanio\.com/view/subject/[^"\s]+?\.jpg', block)
        t = (re.search(r'<h3[^>]*>\s*<a[^>]*>([^<]+)</a>', block)
             or re.search(r'<span[^>]*>([^<]{2,40})</span>', block))
        if img:
            # /s/ 小图换 /m/ 中图，清晰度够用又不至于太大
            cover = img.group(0).replace("/view/subject/s/", "/view/subject/m/")
            candidates.append({
                "cover": cover,
                "title": (t.group(1).strip() if t else ""),
            })
    return ok({"candidates": candidates})


@router.post("/save-cover")
def save_cover(data: dict = Body(...)):
    """把搜索到的书封下载到本地 uploads（之后离线也能显示）"""
    url = data.get("url", "")
    host = urllib.parse.urlparse(url).hostname or ""
    if host not in ("img1.doubanio.com", "img2.doubanio.com",
                    "img3.doubanio.com", "img9.doubanio.com"):
        from ..crud import fail
        raise fail("只允许保存豆瓣书封图片")
    try:
        # 豆瓣图床有反爬：必须带 Referer（缺了返回 418）
        req = urllib.request.Request(url, headers={
            "User-Agent": _DOUBAN_UA,
            "Referer": "https://book.douban.com/",
        })
        with _OPENER.open(req, timeout=15) as r:
            data_bytes = r.read(2 * 1024 * 1024)  # 上限 2MB
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        dest = UPLOAD_DIR / f"{int(time.time())}_bookcover.jpg"
        dest.write_bytes(data_bytes)
        return ok({"url": f"/api/uploads/files/{dest.name}"})
    except Exception:
        from ..crud import fail
        raise fail("书封下载失败，可稍后再试或手动上传")
