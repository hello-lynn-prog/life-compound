# -*- coding: utf-8 -*-
"""统计 API：今日概览 / 年度热力图 / 情绪曲线 / 习惯完成率"""
import sqlite3
from datetime import date, timedelta

from fastapi import APIRouter, Depends

from ..crud import get_db, new_router, ok
from ..db import today_str

router = new_router("/api/stats")


def _streak(conn: sqlite3.Connection) -> int:
    """
    连续打卡天数：从今天（或昨天）往前数，只要当天"有任务且全做完"
    或"有习惯打卡"就算连续。今天还没动不算断（从昨天起算）。
    """
    days_with_action = set()
    for r in conn.execute(
        "SELECT DISTINCT task_date FROM tasks WHERE deleted_at IS NULL AND done = 1"
    ):
        days_with_action.add(r["task_date"])
    for r in conn.execute(
        "SELECT DISTINCT log_date FROM habit_logs WHERE deleted_at IS NULL"
    ):
        days_with_action.add(r["log_date"])
    streak = 0
    d = date.today()
    if today_str() not in days_with_action:  # 今天还没动，从昨天开始数
        d -= timedelta(days=1)
    while d.isoformat() in days_with_action:
        streak += 1
        d -= timedelta(days=1)
    return streak


@router.get("/overview")
def overview(conn: sqlite3.Connection = Depends(get_db)):
    """今日工作台顶部要用的所有数字，一次拿全"""
    today = today_str()
    t = conn.execute(
        "SELECT COUNT(*) AS total, SUM(done) AS done_n FROM tasks "
        "WHERE deleted_at IS NULL AND task_date = ?",
        (today,),
    ).fetchone()
    tasks_total, tasks_done = t["total"] or 0, t["done_n"] or 0
    habit_n = conn.execute(
        "SELECT COUNT(*) AS n FROM habits WHERE deleted_at IS NULL AND archived = 0"
    ).fetchone()["n"]
    checked = conn.execute(
        "SELECT COUNT(*) AS n FROM habit_logs l JOIN habits h ON h.id = l.habit_id "
        "WHERE l.deleted_at IS NULL AND h.deleted_at IS NULL AND h.archived = 0 "
        "AND l.log_date = ?",
        (today,),
    ).fetchone()["n"]
    journal = conn.execute(
        "SELECT mood FROM journals WHERE deleted_at IS NULL AND journal_date = ? LIMIT 1",
        (today,),
    ).fetchone()
    return ok({
        "date": today,
        "tasks_total": tasks_total,
        "tasks_done": tasks_done,
        "habits_total": habit_n,
        "habits_checked": checked,
        "today_mood": journal["mood"] if journal else None,
        "streak": _streak(conn),
    })


@router.get("/heatmap")
def heatmap(year: int = 0, conn: sqlite3.Connection = Depends(get_db)):
    """
    年度热力图：返回 {日期: 活跃度0-4}。
    活跃度 = 当天完成任务数 + 打卡数（0无、1轻、2中、3-4重，分档产生）
    """
    year = year or date.today().year
    start, end = f"{year}-01-01", f"{year}-12-31"
    counts: dict[str, int] = {}
    for r in conn.execute(
        "SELECT task_date AS d, COUNT(*) AS n FROM tasks "
        "WHERE deleted_at IS NULL AND done = 1 AND task_date BETWEEN ? AND ? "
        "GROUP BY task_date",
        (start, end),
    ):
        counts[r["d"]] = counts.get(r["d"], 0) + r["n"]
    for r in conn.execute(
        "SELECT log_date AS d, COUNT(*) AS n FROM habit_logs "
        "WHERE deleted_at IS NULL AND log_date BETWEEN ? AND ? GROUP BY log_date",
        (start, end),
    ):
        counts[r["d"]] = counts.get(r["d"], 0) + r["n"]
    # 分成 0-4 档（阈值：1/2/4），前端按档位上色
    levels = {d: (0 if n == 0 else 1 if n == 1 else 2 if n == 2 else 3 if n <= 4 else 4)
              for d, n in counts.items()}
    return ok({"year": year, "levels": levels})


@router.get("/mood")
def mood_series(days: int = 30, conn: sqlite3.Connection = Depends(get_db)):
    """最近 N 天情绪曲线"""
    start = (date.today() - timedelta(days=days - 1)).isoformat()
    rows = conn.execute(
        "SELECT journal_date AS d, AVG(mood) AS m FROM journals "
        "WHERE deleted_at IS NULL AND mood IS NOT NULL AND journal_date >= ? "
        "GROUP BY journal_date ORDER BY journal_date",
        (start,),
    ).fetchall()
    return ok([{"date": r["d"], "mood": round(r["m"], 2)} for r in rows])


@router.get("/export-csv")
def export_csv(from_: str = "", to: str = "", conn=Depends(get_db)):
    """
    任务明细 CSV 导出（日期、标题、完成状态、优先级、关联、总结）。
    用 utf-8-sig 编码，Excel 双击打开中文不乱码。
    """
    import csv
    import io

    from fastapi.responses import StreamingResponse

    where, params = ["t.deleted_at IS NULL"], []
    if from_:
        where.append("t.task_date >= ?"); params.append(from_)
    if to:
        where.append("t.task_date <= ?"); params.append(to)
    rows = conn.execute(
        f"""SELECT t.task_date, t.title,
               CASE t.done WHEN 1 THEN '已完成' ELSE '未完成' END,
               CASE t.priority WHEN 1 THEN '重要' ELSE '普通' END,
               COALESCE(g.title, ''), COALESCE(p.title, ''),
               COALESCE(t.summary, ''), COALESCE(t.done_at, '')
            FROM tasks t
            LEFT JOIN goals g ON g.id = t.goal_id
            LEFT JOIN projects p ON p.id = t.project_id
            WHERE {' AND '.join(where)} ORDER BY t.task_date DESC, t.id DESC""",
        tuple(params),
    ).fetchall()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["日期", "标题", "状态", "优先级", "关联目标", "关联项目", "今日总结", "完成时间"])
    for r in rows:
        writer.writerow(list(r))
    return StreamingResponse(
        iter(["\ufeff" + buf.getvalue()]),  # BOM 头：Excel 识别 UTF-8
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition":
                 "attachment; filename=tasks_detail.csv"},
    )


@router.get("/summary")
def summary(conn: sqlite3.Connection = Depends(get_db)):
    """图谱页四张统计卡：连续天数 / 本月完成任务 / 打卡率 / 本月日记"""
    today = date.today()
    month_start = today.replace(day=1).isoformat()
    month_end = today.isoformat()
    done_month = conn.execute(
        "SELECT COUNT(*) AS n FROM tasks WHERE deleted_at IS NULL AND done = 1 "
        "AND task_date BETWEEN ? AND ?",
        (month_start, month_end),
    ).fetchone()["n"]
    # 打卡率 = 本月打卡次数 / (活跃习惯数 × 本月天数)
    active_habits = conn.execute(
        "SELECT COUNT(*) AS n FROM habits WHERE deleted_at IS NULL AND archived = 0"
    ).fetchone()["n"]
    day_count = today.day
    checkins = conn.execute(
        "SELECT COUNT(*) AS n FROM habit_logs l JOIN habits h ON h.id = l.habit_id "
        "WHERE l.deleted_at IS NULL AND h.deleted_at IS NULL AND h.archived = 0 "
        "AND l.log_date BETWEEN ? AND ?",
        (month_start, month_end),
    ).fetchone()["n"]
    rate = round(checkins / (active_habits * day_count) * 100) if active_habits else 0
    journals_n = conn.execute(
        "SELECT COUNT(*) AS n FROM journals WHERE deleted_at IS NULL "
        "AND journal_date BETWEEN ? AND ?",
        (month_start, month_end),
    ).fetchone()["n"]
    return ok({
        "streak": _streak(conn),
        "tasks_done_month": done_month,
        "habit_rate": rate,
        "journals_month": journals_n,
    })
