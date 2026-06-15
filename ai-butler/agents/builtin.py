"""AI 电脑管家 - 内置 Agent 实现"""

import os
import subprocess
import platform
from core.base_agent import BaseAgent, Task, TaskResult


class CodeAgent(BaseAgent):
    """代码 Agent - 代码编写、调试、重构"""

    AGENT_TYPE = "code"
    DISPLAY_NAME = "代码 Agent"
    DESCRIPTION = "编写、调试、重构代码，支持多种编程语言"
    ICON = "💻"
    CAPABILITIES = ["code_write", "code_debug", "code_refactor", "code_review"]

    def can_handle(self, task: Task) -> float:
        keywords = ["代码", "编写", "调试", "bug", "函数", "类", "code", "debug", "refactor",
                     "写一个", "实现", "修复", "优化", "脚本", "程序", "接口", "api"]
        text = f"{task.title} {task.description}".lower()
        matches = sum(1 for kw in keywords if kw in text)
        return min(0.9, 0.3 + matches * 0.15)

    def execute(self, task: Task) -> TaskResult:
        try:
            task.logs.append("[CodeAgent] 分析代码任务...")
            # 模拟代码生成/调试过程
            analysis = self._analyze_task(task)
            task.logs.append(f"[CodeAgent] 任务类型: {analysis['type']}")
            task.logs.append(f"[CodeAgent] 涉及语言: {analysis['language']}")

            if analysis["type"] == "write":
                output = self._generate_code(task, analysis)
            elif analysis["type"] == "debug":
                output = self._debug_code(task, analysis)
            else:
                output = self._general_code_task(task, analysis)

            task.logs.append("[CodeAgent] ✅ 任务完成")
            return TaskResult(success=True, output=output)

        except Exception as e:
            task.logs.append(f"[CodeAgent] ❌ 执行失败: {str(e)}")
            return TaskResult(success=False, output="", error=str(e))

    def _analyze_task(self, task: Task):
        text = f"{task.title} {task.description}".lower()
        task_type = "write"
        if any(kw in text for kw in ["debug", "调试", "bug", "修复", "fix"]):
            task_type = "debug"
        elif any(kw in text for kw in ["review", "审查", "优化"]):
            task_type = "review"

        language = "python"
        for lang in ["javascript", "typescript", "java", "go", "rust", "c++", "html", "css"]:
            if lang in text:
                language = lang
                break
        if any(kw in text for kw in ["js", "前端"]):
            language = "javascript"
        elif any(kw in text for kw in ["py", "python"]):
            language = "python"

        return {"type": task_type, "language": language}

    def _generate_code(self, task, analysis):
        lang = analysis["language"]
        return f"""📝 代码生成任务已接收

任务: {task.title}
语言: {lang}

[CodeAgent 说明]
本 Agent 已准备好生成 {lang} 代码。
在完整版本中，此功能将调用 AI 模型生成代码并写入文件。

当前为演示模式 - 实际使用时请配置 AI API Key。
"""

    def _debug_code(self, task, analysis):
        return f"""🔍 调试任务已接收

任务: {task.title}

[CodeAgent 说明]
调试流程:
1. 分析错误信息和堆栈
2. 定位问题代码
3. 提出修复方案
4. 验证修复

当前为演示模式。
"""

    def _general_code_task(self, task, analysis):
        return f"""⚙️ 代码任务已接收

任务: {task.title}
类型: {analysis['type']}

[CodeAgent 说明]
已准备处理此代码任务。
"""


class FileAgent(BaseAgent):
    """文件 Agent - 文件操作、整理、搜索"""

    AGENT_TYPE = "file"
    DISPLAY_NAME = "文件 Agent"
    DESCRIPTION = "文件管理、搜索、整理、批量操作"
    ICON = "📁"
    CAPABILITIES = ["file_search", "file_organize", "file_copy", "file_rename", "file_analysis"]

    def can_handle(self, task: Task) -> float:
        keywords = ["文件", "整理", "搜索", "查找", "移动", "复制", "删除", "重命名",
                     "file", "folder", "目录", "清理", "备份", "压缩"]
        text = f"{task.title} {task.description}".lower()
        matches = sum(1 for kw in keywords if kw in text)
        return min(0.9, 0.3 + matches * 0.15)

    def execute(self, task: Task) -> TaskResult:
        try:
            task.logs.append("[FileAgent] 分析文件任务...")
            output = f"""📂 文件任务已接收

任务: {task.title}
描述: {task.description}

[FileAgent 功能]
• 文件搜索: 按名称、类型、内容搜索
• 文件整理: 按规则分类、归档
• 批量操作: 重命名、移动、复制
• 磁盘分析: 大文件查找、重复文件检测

当前为演示模式。
"""
            task.logs.append("[FileAgent] ✅ 任务完成")
            return TaskResult(success=True, output=output)
        except Exception as e:
            task.logs.append(f"[FileAgent] ❌ 执行失败: {str(e)}")
            return TaskResult(success=False, output="", error=str(e))


class SystemAgent(BaseAgent):
    """系统 Agent - 系统监控、进程管理、环境配置"""

    AGENT_TYPE = "system"
    DISPLAY_NAME = "系统 Agent"
    DESCRIPTION = "系统监控、进程管理、环境配置、性能优化"
    ICON = "⚙️"
    CAPABILITIES = ["system_monitor", "process_manage", "env_config", "performance"]

    def can_handle(self, task: Task) -> float:
        keywords = ["系统", "进程", "内存", "CPU", "磁盘", "监控", "服务", "环境",
                     "system", "process", "memory", "性能", "重启", "安装", "配置"]
        text = f"{task.title} {task.description}".lower()
        matches = sum(1 for kw in keywords if kw in text)
        return min(0.9, 0.3 + matches * 0.15)

    def execute(self, task: Task) -> TaskResult:
        try:
            task.logs.append("[SystemAgent] 分析系统任务...")

            # 实际获取系统信息
            import psutil
            cpu = psutil.cpu_percent(interval=1)
            mem = psutil.virtual_memory()
            disk = psutil.disk_usage("/" if platform.system() != "Windows" else "C:\\")

            output = f"""🖥️ 系统任务已接收

任务: {task.title}

[当前系统状态]
• CPU 使用率: {cpu}%
• 内存: {mem.percent}% ({mem.used // (1024**2)}MB / {mem.total // (1024**2)}MB)
• 磁盘: {disk.percent}% ({disk.free // (1024**3)}GB 可用)

[SystemAgent 功能]
• 进程管理: 查看/终止进程
• 环境配置: PATH、环境变量
• 性能监控: CPU、内存、磁盘实时监控
• 服务管理: 启动/停止系统服务

当前为演示模式。
"""
            task.logs.append("[SystemAgent] ✅ 任务完成")
            return TaskResult(success=True, output=output)
        except Exception as e:
            task.logs.append(f"[SystemAgent] ❌ 执行失败: {str(e)}")
            return TaskResult(success=False, output="", error=str(e))


class BrowserAgent(BaseAgent):
    """浏览器 Agent - 网页浏览、信息抓取、自动化"""

    AGENT_TYPE = "browser"
    DISPLAY_NAME = "浏览器 Agent"
    DESCRIPTION = "网页浏览、信息搜索、数据抓取、自动化操作"
    ICON = "🌐"
    CAPABILITIES = ["web_search", "web_scrape", "web_automate", "web_monitor"]

    def can_handle(self, task: Task) -> float:
        keywords = ["搜索", "网页", "浏览器", "爬虫", "抓取", "网站", "url", "http",
                     "browse", "search", "scrape", "下载", "监控", "自动化"]
        text = f"{task.title} {task.description}".lower()
        matches = sum(1 for kw in keywords if kw in text)
        return min(0.9, 0.3 + matches * 0.15)

    def execute(self, task: Task) -> TaskResult:
        try:
            task.logs.append("[BrowserAgent] 分析网页任务...")
            output = f"""🌐 网页任务已接收

任务: {task.title}
描述: {task.description}

[BrowserAgent 功能]
• 信息搜索: 多引擎搜索、结果聚合
• 数据抓取: 结构化数据提取
• 网页自动化: 表单填写、按钮点击
• 页面监控: 内容变化检测

当前为演示模式。
"""
            task.logs.append("[BrowserAgent] ✅ 任务完成")
            return TaskResult(success=True, output=output)
        except Exception as e:
            task.logs.append(f"[BrowserAgent] ❌ 执行失败: {str(e)}")
            return TaskResult(success=False, output="", error=str(e))


# Agent 注册表
AGENT_REGISTRY = {
    "code": CodeAgent,
    "file": FileAgent,
    "system": SystemAgent,
    "browser": BrowserAgent,
}
