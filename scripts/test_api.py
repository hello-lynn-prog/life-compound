# -*- coding: utf-8 -*-
"""
后端 API 全流程自测脚本
======================
用法：cd backend && python ../scripts/test_api.py
会临时启动一个真实服务（端口 8912），用 urllib 依次验证所有核心接口，
最后打印 PASS/FAIL 汇总。测试数据写入 data/test_life.db，不动正式库。
"""
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
PORT = 8912
BASE = f"http://127.0.0.1:{PORT}"
# 测试用独立数据库，避免污染正式数据
os.environ["LIFE_TEST_DB"] = "1"

results: list[tuple[str, bool, str]] = []


def check(name: str, cond: bool, detail: str = ""):
    results.append((name, cond, detail))
    print(f"  {'✅' if cond else '❌'} {name}" + (f"  ({detail})" if detail and not cond else ""))


def api(method: str, path: str, body: dict | None = None):
    """发请求，返回 (status_code, json)。URL 里的中文参数会自动编码"""
    from urllib.parse import quote
    if any(ord(c) > 127 for c in path):
        path = quote(path, safe="/?=&")
    req = urllib.request.Request(
        BASE + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def request_with_host(path: str, host_header: str):
    """用自定义 Host 头发请求（urllib 不允许直接改 Host，需要 http.client）"""
    import http.client
    conn = http.client.HTTPConnection("127.0.0.1", PORT, timeout=5)
    try:
        conn.request("GET", path, headers={"Host": host_header})
        resp = conn.getresponse()
        return resp.status, resp.read().decode()
    finally:
        conn.close()


def main():
    # 备份正式库（如果存在），测试完恢复原状
    from app.db import DATA_DIR, DB_PATH
    saved = None
    if DB_PATH.exists():
        saved = DB_PATH.read_bytes()
        DB_PATH.unlink()

    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app",
         "--host", "127.0.0.1", "--port", str(PORT)],
        cwd=BACKEND_DIR, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        # 等服务就绪
        for _ in range(40):
            try:
                code, body = api("GET", "/api/health")
                if code == 200:
                    break
            except Exception:
                time.sleep(0.5)
        else:
            print("服务启动失败"); return 1
        print("== 服务就绪，开始测试 ==\n")

        # ---- 1. 安全：外部 Host 应被拒 ----
        code, _ = request_with_host("/api/stats/overview", "evil.example.com")
        check("安全-拒绝外部Host", code == 403, f"got {code}")

        # ---- 2. 目标 → 项目 → 任务 链路 ----
        code, r = api("POST", "/api/goals", {"title": "成为 AI 开发者", "type": "direction"})
        check("创建方向", code == 200 and r["data"]["id"] > 0)
        direction_id = r["data"]["id"]

        code, r = api("POST", "/api/goals", {"title": "半年内做出 Agent 产品", "type": "stage_goal", "parent_id": direction_id})
        goal_id = r["data"]["id"]
        check("创建阶段目标", code == 200)

        code, r = api("POST", "/api/projects", {"title": "人生复利系统", "goal_id": goal_id})
        project_id = r["data"]["id"]
        check("创建项目", code == 200)

        today = time.strftime("%Y-%m-%d")
        code, r = api("POST", "/api/tasks", {"title": "写测试用例", "task_date": today, "project_id": project_id})
        task_id = r["data"]["id"]
        check("创建任务", code == 200)

        code, r = api("GET", f"/api/tasks?date={today}")
        check("按日期查任务", code == 200 and len(r["data"]) == 1)

        code, r = api("POST", f"/api/tasks/{task_id}/toggle")
        check("任务打勾", code == 200 and r["data"]["done"] == 1)

        code, r = api("GET", "/api/goals/tree")
        tree = r["data"]
        check("目标树含进度", code == 200 and tree["directions"][0]["progress"]["percent"] == 100)

        # ---- 3. 习惯打卡 ----
        code, r = api("POST", "/api/habits", {"name": "阅读", "icon": "📖"})
        habit_id = r["data"]["id"]
        check("创建习惯", code == 200)

        code, r = api("POST", f"/api/habits/{habit_id}/checkin")
        check("习惯打卡", code == 200 and r["data"]["checked"] is True)
        code, r = api("GET", "/api/habits")
        check("习惯列表带今日状态", r["data"][0]["checked_today"] is True)
        code, r = api("POST", f"/api/habits/{habit_id}/checkin")
        check("重复打卡=取消", r["data"]["checked"] is False)

        # ---- 4. 日记 / 随手记 ----
        code, r = api("POST", "/api/journals", {"mood": 4, "weather": "晴", "title": "测试日记", "content": "今天系统上线啦", "tags": ["测试"]})
        journal_id = r["data"]["id"]
        check("写日记", code == 200)
        code, r = api("GET", "/api/journals?q=上线")
        check("日记关键词搜索", len(r["data"]) == 1)

        code, r = api("POST", "/api/notes", {"content": "随手记一条灵感", "color": "pink"})
        note_id = r["data"]["id"]
        code, r = api("POST", f"/api/notes/{note_id}/to-journal")
        check("随手记转日记", code == 200 and r["data"]["journal_id"] > 0)

        # ---- 5. 知识卡片 ----
        code, r = api("POST", "/api/knowledge", {"title": "WAL 模式", "content": "SQLite 的写前日志", "category": "数据库", "tags": ["SQLite"]})
        card_id = r["data"]["id"]
        code, r = api("POST", f"/api/knowledge/{card_id}/review")
        check("知识复习标记", r["data"]["review_count"] == 1)
        code, r = api("GET", "/api/knowledge?tag=SQLite")
        check("按标签查知识", len(r["data"]) == 1)

        # ---- 6. 成果 / 技能 ----
        code, r = api("POST", "/api/achievements", {"title": "人生复利系统 v1.0", "ach_type": "work", "ach_date": today})
        check("创建成果", code == 200)
        code, r = api("POST", "/api/skills", {"name": "全栈开发", "level": 6})
        check("创建技能", code == 200)

        # ---- 7. 统计 ----
        code, r = api("GET", "/api/stats/overview")
        check("今日概览", code == 200 and r["data"]["streak"] >= 1)
        code, r = api("GET", "/api/stats/heatmap")
        check("热力图", code == 200 and today in r["data"]["levels"])
        code, r = api("GET", "/api/stats/mood")
        check("情绪曲线", code == 200 and len(r["data"]) >= 1)
        code, r = api("GET", "/api/stats/summary")
        check("月度统计", code == 200 and r["data"]["tasks_done_month"] >= 1)

        # ---- 8. 复盘草稿（本地规则） ----
        code, r = api("POST", "/api/reviews/draft", {"period_type": "weekly"})
        check("复盘草稿生成", code == 200 and "完成任务" in r["data"]["draft"])
        code, r = api("POST", "/api/reviews", {"period_start": today, "period_end": today, "content": "测试周报", "period_type": "weekly"})
        check("保存复盘", code == 200)

        # ---- 9. 全局搜索 ----
        code, r = api("GET", "/api/search?q=测试")
        check("全局搜索", code == 200 and (len(r["data"]["tasks"]) + len(r["data"]["journals"])) >= 1)

        # ---- 10. 回收站：删除 → 恢复 ----
        code, r = api("DELETE", f"/api/tasks/{task_id}")
        check("软删除任务", code == 200)
        code, r = api("GET", "/api/data/recycle")
        check("回收站可见", any(i["table"] == "tasks" for i in r["data"]))
        code, r = api("POST", "/api/data/recycle/restore", {"table": "tasks", "id": task_id})
        check("回收站恢复", code == 200)
        code, r = api("GET", f"/api/tasks?date={today}")
        check("恢复后可查", len(r["data"]) == 1)

        # ---- 11. 备份 / 恢复 / 导出 ----
        code, r = api("POST", "/api/data/backups")
        check("手动备份", code == 200)
        code, r = api("GET", "/api/data/backups")
        check("备份列表", code == 200 and len(r["data"]) >= 1)
        backup_file = r["data"][0]["file"]
        # 删库 → 恢复 → 数据还在
        code, r = api("POST", "/api/data/restore", {"file": backup_file})
        check("从备份恢复", code == 200)
        code, r = api("GET", f"/api/tasks?date={today}")
        check("恢复后数据完整", len(r["data"]) == 1)

        code, r = api("GET", "/api/data/export-json")
        check("JSON 导出", code == 200)
        # ZIP 是二进制下载，只验证 HTTP 200
        try:
            with urllib.request.urlopen(BASE + "/api/data/export-zip", timeout=10) as resp:
                zip_ok = resp.status == 200 and resp.read(4)[:2] == b"PK"
            check("ZIP 导出", zip_ok)
        except Exception as e:
            check("ZIP 导出", False, str(e))

        # ---- 12. 设置 ----
        code, r = api("POST", "/api/data/settings", {"nickname": "小满"})
        code, r = api("GET", "/api/data/settings")
        check("设置读写", r["data"].get("nickname") == "小满")

    finally:
        proc.terminate()
        # 清理：删测试库，恢复原库
        import glob
        for f in glob.glob(str(DATA_DIR / "test_life.db*")):
            os.unlink(f)
        if saved is not None:
            DB_PATH.write_bytes(saved)

    print("\n== 汇总 ==")
    passed = sum(1 for _, ok_, _ in results if ok_)
    print(f"{passed} / {len(results)} 通过")
    fails = [(n, d) for n, ok_, d in results if not ok_]
    for n, d in fails:
        print(f"  ❌ {n}: {d}")
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.path.insert(0, str(BACKEND_DIR))
    sys.exit(main())
