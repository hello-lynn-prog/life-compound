# -*- coding: utf-8 -*-
"""
开机提醒脚本（静默运行，不弹黑窗）
==================================
逻辑：开机登录后由"启动文件夹"自动运行 → 检查今天写任务了没 →
没写就弹 Windows 原生通知"今天还没写任务哦"。
用 pythonw.exe 运行本文件（.pyw 扩展名关联的就是 pythonw）。
"""
import sqlite3
import subprocess
import sys
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "backend" / "data" / "life.db"
APP_URL = "http://127.0.0.1:8910"


def has_tasks_today() -> bool:
    """今天（自然日）是否写过任务"""
    if not DB_PATH.exists():
        return False
    try:
        import datetime
        today = datetime.date.today().isoformat()
        conn = sqlite3.connect(DB_PATH)
        try:
            row = conn.execute(
                "SELECT COUNT(*) AS n FROM tasks "
                "WHERE deleted_at IS NULL AND task_date = ?",
                (today,),
            ).fetchone()
            return (row[0] if row else 0) > 0
        finally:
            conn.close()
    except Exception:
        return False  # 出错就不打扰用户


def notify(title: str, message: str) -> None:
    """弹 Windows 原生 Toast 通知（用 PowerShell 原生 API，零第三方依赖）"""
    ps = (
        "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications,"
        " ContentType = WindowsRuntime] | Out-Null;"
        "$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe';"
        "$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent"
        "([Windows.UI.Notifications.ToastTemplateType]::ToastText02);"
        "$t = $xml.GetElementsByTagName('text');"
        "$t.Item(0).AppendChild($xml.CreateTextNode($title)) | Out-Null;"
        "$t.Item(1).AppendChild($xml.CreateTextNode($msg)) | Out-Null;"
        "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app)"
        ".Show([Windows.UI.Notifications.ToastNotification]::new($xml))"
    )
    subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         f"$title='{title}'; $msg='{message}'; " + ps],
        capture_output=True, timeout=30,
    )


def main() -> None:
    # 稍等一会儿，让桌面先就绪（通知太早弹会被系统吞掉）
    import time
    time.sleep(45)
    if not has_tasks_today():
        notify("人生复利系统", "今天还没写任务哦，点开「启动.bat」看看～")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.exit(0)  # 提醒失败静默退出，绝不能弹错误窗口吓到用户
