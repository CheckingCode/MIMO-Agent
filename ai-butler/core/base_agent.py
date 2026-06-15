"""AI 电脑管家 - Agent 基类"""

import uuid
import time
from enum import Enum
from dataclasses import dataclass, field
from typing import Any, Optional


class AgentStatus(Enum):
    IDLE = "idle"
    BUSY = "busy"
    ERROR = "error"
    OFFLINE = "offline"


class TaskStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class TaskResult:
    """任务执行结果"""
    success: bool
    output: str
    artifacts: list = field(default_factory=list)
    error: Optional[str] = None


@dataclass
class Task:
    """任务定义"""
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:8])
    title: str = ""
    description: str = ""
    agent_id: Optional[str] = None
    status: TaskStatus = TaskStatus.PENDING
    priority: int = 5  # 1-10, 10 is highest
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    result: Optional[TaskResult] = None
    logs: list = field(default_factory=list)

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "agent_id": self.agent_id,
            "status": self.status.value,
            "priority": self.priority,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "result": {
                "success": self.result.success,
                "output": self.result.output,
                "error": self.result.error,
                "artifacts": self.result.artifacts
            } if self.result else None,
            "logs": self.logs[-50:],  # 最近 50 条日志
        }


class BaseAgent:
    """Agent 基类 - 所有 Agent 继承此类"""

    AGENT_TYPE = "base"
    DISPLAY_NAME = "基础 Agent"
    DESCRIPTION = "Agent 基类"
    ICON = "🤖"
    CAPABILITIES: list[str] = []

    def __init__(self, agent_id: str = None):
        self.id = agent_id or uuid.uuid4().hex[:8]
        self.status = AgentStatus.IDLE
        self.current_task: Optional[Task] = None
        self.stats = {"tasks_completed": 0, "tasks_failed": 0, "total_time": 0}

    def can_handle(self, task: Task) -> float:
        """评估此 Agent 处理任务的适合度 (0.0-1.0)"""
        return 0.1

    def execute(self, task: Task) -> TaskResult:
        """执行任务 - 子类必须实现"""
        raise NotImplementedError

    def to_dict(self):
        return {
            "id": self.id,
            "type": self.AGENT_TYPE,
            "name": self.DISPLAY_NAME,
            "description": self.DESCRIPTION,
            "icon": self.ICON,
            "status": self.status.value,
            "capabilities": self.CAPABILITIES,
            "current_task": self.current_task.id if self.current_task else None,
            "stats": self.stats,
        }
