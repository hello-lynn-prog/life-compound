# -*- coding: utf-8 -*-
"""
「人生复利系统」后端入口
========================
- 只监听 127.0.0.1:8910（本机回环地址，局域网无法访问）
- 托管 frontend/dist 里构建好的前端页面
- 启动时自动做一次数据库备份
"""
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import backup
from .db import init_db
from .routers import (achievements, data, goals, habits, journals, knowledge,
                      notes, recurrences, reviews, search, stats, tasks)
from .security import LocalOnlyMiddleware

BASE_DIR = Path(__file__).resolve().parent.parent
DIST_DIR = BASE_DIR.parent / "frontend" / "dist"

app = FastAPI(title="人生复利系统", version="1.0.0",
              docs_url=None, redoc_url=None)  # 个人本地应用，关闭在线文档

# CORS：前端和后端同源（都由本服务托管），这里只是兜底允许本机端口
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:8910", "http://localhost:8910"],
    allow_methods=["*"], allow_headers=["*"],
)
# 本机来源校验（Host / Origin 白名单）
app.add_middleware(LocalOnlyMiddleware)

# 注册各模块路由
for r in (tasks.router, habits.router, journals.router, notes.router,
          knowledge.router, goals.router, goals.proj_router,
          achievements.router, achievements.skill_router,
          achievements.upload_router, reviews.router, stats.router,
          search.router, data.router, recurrences.router):
    app.include_router(r)


@app.get("/api/health")
def health():
    """健康检查：启动脚本用它探测服务是否就绪"""
    return {"ok": True, "app": "人生复利系统"}


@app.on_event("startup")
def on_startup():
    """启动即初始化数据库 + 自动备份（保命数据的日常快照）"""
    init_db()
    try:
        backup.backup_db("startup")
    except Exception as e:  # 备份失败不阻塞启动，但要留下记录
        print(f"[启动备份失败] {e}")


# ---- 托管前端静态文件（构建产物）。SPA 路由：所有未匹配路径回退到 index.html
if DIST_DIR.exists():
    app.mount("/assets", StaticFiles(directory=DIST_DIR / "assets"), name="assets")

    @app.get("/")
    def serve_index():
        return FileResponse(DIST_DIR / "index.html")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        # 先按静态文件找（favicon、字体等），找不到就回退到 SPA 首页
        target = (DIST_DIR / full_path).resolve()
        if (str(target).startswith(str(DIST_DIR.resolve()))
                and target.is_file()):
            return FileResponse(target)
        return FileResponse(DIST_DIR / "index.html")
else:
    @app.get("/")
    def no_frontend():
        return {"message": "前端尚未构建：请先运行 frontend 的 npm run build"}
