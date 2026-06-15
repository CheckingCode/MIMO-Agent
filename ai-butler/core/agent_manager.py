"""AI 电脑管家 - Agent 管理器"""

from typing import Dict, Optional
from core.base_agent import BaseAgent, AgentStatus
from agents.builtin import AGENT_REGISTRY


class AgentManager:
    """管理所有 Agent 的生命周期"""

    def __init__(self):
        self._agents: Dict[str, BaseAgent] = {}

    def initialize_defaults(self):
        """初始化内置 Agent"""
        for agent_type, agent_cls in AGENT_REGISTRY.items():
            agent = agent_cls(agent_id=agent_type)
            self._agents[agent.id] = agent

    def get_all(self) -> list[dict]:
        return [a.to_dict() for a in self._agents.values()]

    def get(self, agent_id: str) -> Optional[BaseAgent]:
        return self._agents.get(agent_id)

    def get_available(self) -> list[BaseAgent]:
        return [a for a in self._agents.values() if a.status == AgentStatus.IDLE]

    def get_by_type(self, agent_type: str) -> Optional[BaseAgent]:
        for agent in self._agents.values():
            if agent.AGENT_TYPE == agent_type:
                return agent
        return None

    def find_best_agent(self, task) -> Optional[BaseAgent]:
        """找到最适合处理任务的 Agent"""
        best_agent = None
        best_score = 0.0
        for agent in self._agents.values():
            if agent.status != AgentStatus.IDLE:
                continue
            score = agent.can_handle(task)
            if score > best_score:
                best_score = score
                best_agent = agent
        return best_agent
