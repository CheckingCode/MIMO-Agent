"""AI 电脑管家 - Flask 主服务"""

import json
import platform
import psutil
from flask import Flask, send_from_directory, request, jsonify
from flask_cors import CORS

from config import Config
from core.agent_manager import AgentManager
from core.task_scheduler import TaskScheduler

app = Flask(__name__, static_folder="static")
CORS(app)

# 初始化核心模块
agent_manager = AgentManager()
agent_manager.initialize_defaults()
task_scheduler = TaskScheduler(agent_manager, max_concurrent=Config.MAX_CONCURRENT_TASKS)
task_scheduler.start()


# ==================== 页面路由 ====================

@app.route("/")
def index():
    return send_from_directory("static", "index.html")


# ==================== API 路由 ====================

@app.route("/api/dashboard")
def api_dashboard():
    """仪表盘数据"""
    cpu = psutil.cpu_percent(interval=0.5)
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage("C:\\" if platform.system() == "Windows" else "/")

    return jsonify({
        "system": {
            "cpu_percent": cpu,
            "memory_percent": mem.percent,
            "memory_used_mb": mem.used // (1024 ** 2),
            "memory_total_mb": mem.total // (1024 ** 2),
            "disk_percent": disk.percent,
            "disk_free_gb": round(disk.free / (1024 ** 3), 1),
            "disk_total_gb": round(disk.total / (1024 ** 3), 1),
            "platform": platform.system(),
            "hostname": platform.node(),
        },
        "agents": agent_manager.get_all(),
        "tasks": task_scheduler.get_stats(),
    })


# ---------- Agent API ----------

@app.route("/api/agents")
def api_agents():
    return jsonify(agent_manager.get_all())


# ---------- Task API ----------

@app.route("/api/tasks", methods=["GET"])
def api_tasks():
    return jsonify(task_scheduler.get_all_tasks())


@app.route("/api/tasks", methods=["POST"])
def api_create_task():
    data = request.json or {}
    title = data.get("title", "").strip()
    if not title:
        return jsonify({"error": "任务标题不能为空"}), 400

    task = task_scheduler.submit_task(
        title=title,
        description=data.get("description", ""),
        agent_id=data.get("agent_id"),
        priority=int(data.get("priority", 5)),
    )
    return jsonify(task.to_dict()), 201


@app.route("/api/tasks/<task_id>")
def api_task_detail(task_id):
    task = task_scheduler.get_task(task_id)
    if not task:
        return jsonify({"error": "任务不存在"}), 404
    return jsonify(task.to_dict())


@app.route("/api/tasks/<task_id>/cancel", methods=["POST"])
def api_cancel_task(task_id):
    if task_scheduler.cancel_task(task_id):
        return jsonify({"success": True})
    return jsonify({"error": "无法取消该任务"}), 400


# ---------- 快速任务 ----------

@app.route("/api/quick-tasks")
def api_quick_tasks():
    """预设的快捷任务模板"""
    return jsonify([
        {"title": "查看系统状态", "description": "获取 CPU、内存、磁盘使用情况", "agent_id": "system", "icon": "🖥️"},
        {"title": "整理下载文件夹", "description": "按文件类型整理下载目录", "agent_id": "file", "icon": "📂"},
        {"title": "搜索最新技术资讯", "description": "搜索 AI 和编程领域的最新动态", "agent_id": "browser", "icon": "🔍"},
        {"title": "编写 Python 脚本", "description": "根据需求编写 Python 自动化脚本", "agent_id": "code", "icon": "🐍"},
        {"title": "分析大文件", "description": "查找占用空间最大的文件", "agent_id": "file", "icon": "📊"},
        {"title": "代码审查", "description": "审查代码质量和潜在问题", "agent_id": "code", "icon": "🔎"},
    ])


if __name__ == "__main__":
    print(f"""
╔══════════════════════════════════════════╗
║         🤖 AI 电脑管家 已启动             ║
║                                          ║
║   控制台: http://{Config.HOST}:{Config.PORT}          ║
║   按 Ctrl+C 停止                         ║
╚══════════════════════════════════════════╝
""")
    app.run(host=Config.HOST, port=Config.PORT, debug=Config.DEBUG)
