# 🌸 人生复利系统

可爱风离线个人成长工作台：目标计划 · 每日行动 · 日记随手记 · 知识积累 · 成长图谱 · 个人 IP 档案。

**完全离线、无需账号、数据只存在本机**（React + TypeScript 前端 / Python FastAPI 本地服务 / SQLite）。

## 快速开始

| 文件 | 用途 |
|---|---|
| `首次安装.bat` | **第一天运行一次**：装依赖、可选注册开机提醒 |
| `启动.bat` | **日常双击**：启动服务并自动打开浏览器（http://127.0.0.1:8910） |

详细使用说明见 **[docs/使用手册.md](docs/使用手册.md)**。

## 技术栈与安全

- 前端资源（字体/图标/图表库）全部随程序打包，运行时零 CDN
- 本地服务只监听 `127.0.0.1`，并校验请求来源（Host/Origin 白名单），局域网与外部网页无法访问
- SQLite WAL 模式 + 启动自动备份（保留 30 份）+ 一键导出 ZIP/JSON + 全表软删除回收站
- 数据库带 `schema_version` 版本机制，未来升级不丢数据
- 智能功能（复盘草稿）为本地规则实现，不依赖任何 AI 服务

## 开发

```bash
# 后端（需 Python 3.10+）
cd backend && python -m uvicorn app.main:app --host 127.0.0.1 --port 8910

# 前端（需 Node 18+，改代码后重新构建）
cd frontend && npm install && npm run build

# 后端全流程自动化测试（37 项）
python scripts/test_api.py
```

修改入口脚本（.bat）请运行 `python scripts/make_scripts.py` 重新生成（GBK 编码，防止命令行中文乱码）。

## 🔒 开源与隐私（上传 GitHub 前必读）

本仓库已通过 `.gitignore` 阻止一切个人数据进入 Git：

| 被屏蔽的内容 | 位置 | 说明 |
|---|---|---|
| **全部个人数据** | `backend/data/` | 数据库（日记/任务/知识库）、备份、上传图片——**永远不会被提交** |
| 抠像帧缓存 | `assets/ip/anim_frames*/` | 105MB 中间产物，脚本可重新生成 |
| 依赖与构建产物 | `node_modules/` `dist/` `.venv/` | 克隆者自行安装构建 |

**上传前自查**：`git status` 里如果出现 `backend/data` 之外的未知文件，先确认再 add。
代码已扫描确认无任何硬编码的用户名/绝对路径。

**🎨 打造你自己的 IP 吉祥物**：仓库不带作者的形象（隐私）。把你的 4 个文件
（`mascot.png` / `idle.webm` / `wave.webm` / `heart.webm`）放进
`frontend/public/mascot/`，重新 `npm run build` 即可——放不放都开箱能跑，
没放时系统显示 🌸 占位头像。**从真人照片到互动吉祥物的完整教程
（含豆包提示词模板、抠像/动画脚本用法）见 [docs/打造你的IP吉祥物.md](docs/打造你的IP吉祥物.md)**。

## 🤖 AI 功能（可选，默认关闭）

系统完全离线可用；如需 AI 总结（日记回顾、智能周报、知识卡自动摘要），见
**[docs/AI功能设计.md](docs/AI功能设计.md)** 的接入方案（支持本地 Ollama 或云 API）。

## 📄 License

MIT —— 可自由使用、修改、分发，需保留版权声明。
