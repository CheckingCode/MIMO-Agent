"""AI 电脑管家 - 任务调度器"""

import threading
import time
from collections import deque
from typing import Dict, Optional
from core.base_agent import Task, TaskStatus, TaskResult, AgentStatus
from core.agent_manager import AgentManager


class TaskScheduler:
    """任务调度与执行引擎"""

    def __init__(self, agent_manager: AgentManager, max_concurrent: int = 3):
        self.agent_manager = agent_manager
        self.max_concurrent = max_concurrent
        self._tasks: Dict[str, Task] = {}
        self._queue: deque = deque()
        self._lock = threading.Lock()
        self._running = False
        self._worker_thread: Optional[threading.Thread] = None

    def start(self):
        self._running = True
        self._worker_thread = threading.Thread(target=self._worker_loop, daemon=True)
        self._worker_thread.start()

    def stop(self):
        self._running = False

    def submit_task(self, title: str, description: str = "", agent_id: str = None,
                    priority: int = 5) -> Task:
        """提交新任务"""
        task = Task(title=title, description=description, priority=priority)
        if agent_id:
            task.agent_id = agent_id
        with self._lock:
            self._tasks[task.id] = task
            self._queue.append(task.id)
            # 按优先级排序
            sorted_ids = sorted(self._queue,
                                key=lambda tid: self._tasks[tid].priority, reverse=True)
            self._queue = deque(sorted_ids)
        return task

    def cancel_task(self, task_id: str) -> bool:
        with self._lock:
            task = self._tasks.get(task_id)
            if task and task.status == TaskStatus.PENDING:
                task.status = TaskStatus.CANCELLED
                if task_id in self._queue:
                    self._queue.remove(task_id)
                return True
        return False

    def get_task(self, task_id: str) -> Optional[Task]:
        return self._tasks.get(task_id)

    def get_all_tasks(self) -> list[dict]:
        return [t.to_dict() for t in sorted(
            self._tasks.values(), key=lambda t: t.created_at, reverse=True)]

    def get_stats(self) -> dict:
        total = len(self._tasks)
        by_status = {}
        for t in self._tasks.values():
            s = t.status.value
            by_status[s] = by_status.get(s, 0) + 1
        return {
            "total": total,
            "by_status": by_status,
            "queue_length": len(self._queue),
        }

    def _worker_loop(self):
        """后台工作线程"""
        while self._running:
            task_id = None
            with self._lock:
                if self._queue:
                    # 检查并发限制
                    running_count = sum(
                        1 for t in self._tasks.values() if t.status == TaskStatus.RUNNING)
                    if running_count < self.max_concurrent:
                        task_id = self._queue.popleft()

            if task_id:
                self._execute_task(task_id)
            else:
                time.sleep(0.5)

    def _execute_task(self, task_id: str):
        task = self._tasks.get(task_id)
        if not task or task.status != TaskStatus.PENDING:
            return

        # 选择 Agent
        if task.agent_id:
            agent = self.agent_manager.get(task.agent_id)
        else:
            agent = self.agent_manager.find_best_agent(task)

        if not agent:
            task.status = TaskStatus.FAILED
            task.result = TaskResult(success=False, output="", error="没有可用的 Agent")
            return

        # 执行
        task.agent_id = agent.id
        task.status = TaskStatus.RUNNING
        task.started_at = time.time()
        agent.status = AgentStatus.BUSY
        agent.current_task = task

        try:
            result = agent.execute(task)
            task.result = result
            task.status = TaskStatus.SUCCESS if result.success else TaskStatus.FAILED
            if result.success:
                agent.stats["tasks_completed"] += 1
            else:
                agent.stats["tasks_failed"] += 1
        except Exception as e:
            task.status = TaskStatus.FAILED
            task.result = TaskResult(success=False, output="", error=str(e))
            agent.stats["tasks_failed"] += 1
        finally:
            task.finished_at = time.time()
            if task.started_at:
                agent.stats["total_time"] += task.finished_at - task.started_at
            agent.status = AgentStatus.IDLE
            agent.current_task = None
