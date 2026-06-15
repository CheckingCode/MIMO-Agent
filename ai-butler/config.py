"""AI 电脑管家 - 配置"""

import os

class Config:
    """应用配置"""
    # Flask
    HOST = os.getenv("AI_BUTLER_HOST", "127.0.0.1")
    PORT = int(os.getenv("AI_BUTLER_PORT", "5800"))
    DEBUG = os.getenv("AI_BUTLER_DEBUG", "true").lower() == "true"
    
    # AI Provider
    AI_PROVIDER = os.getenv("AI_PROVIDER", "openai")  # openai / ollama / custom
    AI_API_KEY = os.getenv("AI_API_KEY", "")
    AI_BASE_URL = os.getenv("AI_BASE_URL", "https://api.openai.com/v1")
    AI_MODEL = os.getenv("AI_MODEL", "gpt-4o-mini")
    
    # Task
    MAX_CONCURRENT_TASKS = int(os.getenv("MAX_CONCURRENT_TASKS", "3"))
    TASK_TIMEOUT = int(os.getenv("TASK_TIMEOUT", "300"))  # seconds
    
    # Workspace
    WORKSPACE = os.getenv("AI_BUTLER_WORKSPACE", os.path.expanduser("~"))
