/* AI 电脑管家 - 前端逻辑 */

const API = "";
let currentPage = "dashboard";
let currentFilter = "all";
let refreshTimer = null;

// ==================== 初始化 ====================

document.addEventListener("DOMContentLoaded", () => {
    initNavigation();
    initFilterButtons();
    loadDashboard();
    loadQuickTasks();
    startAutoRefresh();
});

function startAutoRefresh() {
    refreshTimer = setInterval(() => {
        if (currentPage === "dashboard") loadDashboard();
        if (currentPage === "tasks") loadTasks();
        if (currentPage === "agents") loadAgents();
    }, 3000);
}

// ==================== 导航 ====================

function initNavigation() {
    document.querySelectorAll(".nav-item").forEach(item => {
        item.addEventListener("click", () => {
            const page = item.dataset.page;
            switchPage(page);
        });
    });
}

function switchPage(page) {
    currentPage = page;
    document.querySelectorAll(".nav-item").forEach(i => i.classList.remove("active"));
    document.querySelector(`.nav-item[data-page="${page}"]`).classList.add("active");
    document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
    document.getElementById(`page-${page}`).classList.add("active");

    if (page === "dashboard") loadDashboard();
    if (page === "agents") loadAgents();
    if (page === "tasks") loadTasks();
}

// ==================== 仪表盘 ====================

async function loadDashboard() {
    try {
        const res = await fetch(`${API}/api/dashboard`);
        const data = await res.json();
        renderSystemStats(data.system);
        renderAgentGrid(data.agents);
        renderRecentTasks();
    } catch (e) {
        console.error("加载仪表盘失败:", e);
    }
}

function renderSystemStats(sys) {
    document.getElementById("cpu-value").textContent = `${sys.cpu_percent}%`;
    setProgressBar("cpu-bar", sys.cpu_percent);

    document.getElementById("mem-value").textContent =
        `${sys.memory_used_mb}MB / ${sys.memory_total_mb}MB`;
    setProgressBar("mem-bar", sys.memory_percent);

    document.getElementById("disk-value").textContent =
        `${sys.disk_free_gb}GB 可用 / ${sys.disk_total_gb}GB`;
    setProgressBar("disk-bar", sys.disk_percent);
}

function setProgressBar(id, percent) {
    const bar = document.getElementById(id);
    bar.style.width = `${percent}%`;
    bar.className = "progress-fill";
    if (percent > 90) bar.classList.add("danger");
    else if (percent > 70) bar.classList.add("warn");
    else bar.classList.add("success");
}

function renderAgentGrid(agents) {
    const grid = document.getElementById("agent-status-grid");
    grid.innerHTML = agents.map(a => `
        <div class="agent-card">
            <div class="agent-card-header">
                <span class="icon">${a.icon}</span>
                <span class="name">${a.name}</span>
                <span class="status-dot ${a.status}"></span>
            </div>
            <div class="agent-card-desc">${a.description}</div>
            <div class="agent-card-stats">
                <span>✅ ${a.stats.tasks_completed}</span>
                <span>❌ ${a.stats.tasks_failed}</span>
            </div>
        </div>
    `).join("");
}

async function loadQuickTasks() {
    try {
        const res = await fetch(`${API}/api/quick-tasks`);
        const tasks = await res.json();
        const grid = document.getElementById("quick-task-grid");
        grid.innerHTML = tasks.map(t => `
            <div class="quick-task-card" onclick="quickSubmit('${t.title}', '${t.description}', '${t.agent_id}')">
                <div class="qt-icon">${t.icon}</div>
                <div class="qt-title">${t.title}</div>
                <div class="qt-desc">${t.description}</div>
            </div>
        `).join("");
    } catch (e) {
        console.error("加载快捷任务失败:", e);
    }
}

async function renderRecentTasks() {
    try {
        const res = await fetch(`${API}/api/tasks`);
        const tasks = await res.json();
        const list = document.getElementById("recent-tasks");
        const recent = tasks.slice(0, 5);

        if (recent.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📋</div>
                    <div class="empty-text">暂无任务，点击"新建任务"开始</div>
                </div>`;
            return;
        }

        list.innerHTML = recent.map(t => renderTaskItem(t)).join("");

        const stats = await (await fetch(`${API}/api/dashboard`)).json();
        document.getElementById("task-count").textContent = stats.tasks.total;
        const byStatus = stats.tasks.by_status;
        document.getElementById("task-sub").textContent =
            `运行中 ${byStatus.running || 0} · 排队 ${byStatus.pending || 0}`;
    } catch (e) {
        console.error("加载最近任务失败:", e);
    }
}

// ==================== Agent 中心 ====================

async function loadAgents() {
    try {
        const res = await fetch(`${API}/api/agents`);
        const agents = await res.json();
        const grid = document.getElementById("agent-detail-grid");
        grid.innerHTML = agents.map(a => `
            <div class="agent-detail-card">
                <div class="agent-header">
                    <span class="agent-icon">${a.icon}</span>
                    <div>
                        <div class="agent-name">${a.name}</div>
                        <div class="agent-type">${a.type} · <span class="status-dot ${a.status}"></span> ${a.status}</div>
                    </div>
                </div>
                <div class="desc">${a.description}</div>
                <div class="capabilities">
                    ${a.capabilities.map(c => `<span class="capability-tag">${c}</span>`).join("")}
                </div>
                <div class="agent-stats-row">
                    <div class="agent-stat">
                        <div class="value">${a.stats.tasks_completed}</div>
                        <div class="label">已完成</div>
                    </div>
                    <div class="agent-stat">
                        <div class="value">${a.stats.tasks_failed}</div>
                        <div class="label">失败</div>
                    </div>
                    <div class="agent-stat">
                        <div class="value">${Math.round(a.stats.total_time)}s</div>
                        <div class="label">总耗时</div>
                    </div>
                </div>
            </div>
        `).join("");
    } catch (e) {
        console.error("加载 Agent 失败:", e);
    }
}

// ==================== 任务中心 ====================

function initFilterButtons() {
    document.querySelectorAll(".filter-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentFilter = btn.dataset.filter;
            loadTasks();
        });
    });
}

async function loadTasks() {
    try {
        const res = await fetch(`${API}/api/tasks`);
        let tasks = await res.json();
        if (currentFilter !== "all") {
            tasks = tasks.filter(t => t.status === currentFilter);
        }
        const list = document.getElementById("all-tasks");
        if (tasks.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📋</div>
                    <div class="empty-text">没有符合条件的任务</div>
                </div>`;
            return;
        }
        list.innerHTML = tasks.map(t => renderTaskItem(t)).join("");
    } catch (e) {
        console.error("加载任务失败:", e);
    }
}

function renderTaskItem(task) {
    const statusIcons = {
        pending: "⏳", running: "⚡", success: "✅", failed: "❌", cancelled: "🚫"
    };
    const statusLabels = {
        pending: "等待中", running: "执行中", success: "已完成", failed: "失败", cancelled: "已取消"
    };
    const agentIcons = { code: "💻", file: "📁", system: "⚙️", browser: "🌐" };
    const time = formatTime(task.created_at);

    return `
        <div class="task-item" onclick="showTaskDetail('${task.id}')">
            <span class="task-status-icon">${statusIcons[task.status] || "❓"}</span>
            <div class="task-info">
                <div class="task-title">${task.title}</div>
                <div class="task-meta">
                    <span>${agentIcons[task.agent_id] || "🤖"} ${task.agent_id || "自动"}</span>
                    <span>🕐 ${time}</span>
                </div>
            </div>
            <span class="task-status-badge ${task.status}">${statusLabels[task.status] || task.status}</span>
        </div>
    `;
}

function formatTime(ts) {
    if (!ts) return "--";
    const d = new Date(ts * 1000);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return "刚刚";
    if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
    return d.toLocaleDateString("zh-CN");
}

// ==================== 任务操作 ====================

async function showTaskDetail(taskId) {
    try {
        const res = await fetch(`${API}/api/tasks/${taskId}`);
        const task = await res.json();
        document.getElementById("detail-title").textContent = task.title;

        const statusLabels = {
            pending: "等待中", running: "执行中", success: "已完成", failed: "失败", cancelled: "已取消"
        };

        let html = `
            <div class="detail-row">
                <span class="detail-label">状态</span>
                <span class="detail-value"><span class="task-status-badge ${task.status}">${statusLabels[task.status]}</span></span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Agent</span>
                <span class="detail-value">${task.agent_id || "未分配"}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">优先级</span>
                <span class="detail-value">${task.priority}/10</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">创建时间</span>
                <span class="detail-value">${new Date(task.created_at * 1000).toLocaleString("zh-CN")}</span>
            </div>
        `;

        if (task.description) {
            html += `
                <div class="detail-row">
                    <span class="detail-label">描述</span>
                    <span class="detail-value">${task.description}</span>
                </div>
            `;
        }

        if (task.result) {
            html += `<div class="task-output">${task.result.output || task.result.error || "无输出"}</div>`;
        }

        if (task.logs && task.logs.length > 0) {
            html += `<div class="task-logs">${task.logs.join("\n")}</div>`;
        }

        if (task.status === "pending" || task.status === "running") {
            html += `
                <div style="margin-top: 16px;">
                    <button class="btn btn-danger btn-sm" onclick="cancelTask('${task.id}')">取消任务</button>
                </div>
            `;
        }

        document.getElementById("task-detail-content").innerHTML = html;
        document.getElementById("task-detail-modal").classList.add("show");
    } catch (e) {
        console.error("加载任务详情失败:", e);
    }
}

function hideTaskDetailModal() {
    document.getElementById("task-detail-modal").classList.remove("show");
}

async function cancelTask(taskId) {
    try {
        await fetch(`${API}/api/tasks/${taskId}/cancel`, { method: "POST" });
        hideTaskDetailModal();
        if (currentPage === "tasks") loadTasks();
        if (currentPage === "dashboard") loadDashboard();
    } catch (e) {
        console.error("取消任务失败:", e);
    }
}

// ==================== 新建任务 ====================

function showNewTaskModal() {
    document.getElementById("new-task-modal").classList.add("show");
    document.getElementById("task-title").focus();
}

function hideNewTaskModal() {
    document.getElementById("new-task-modal").classList.remove("show");
    document.getElementById("new-task-form").reset();
}

async function submitNewTask(e) {
    e.preventDefault();
    const title = document.getElementById("task-title").value.trim();
    const desc = document.getElementById("task-desc").value.trim();
    const agent = document.getElementById("task-agent").value;
    const priority = document.getElementById("task-priority").value;

    if (!title) return;

    try {
        await fetch(`${API}/api/tasks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                title,
                description: desc,
                agent_id: agent || undefined,
                priority: parseInt(priority),
            }),
        });
        hideNewTaskModal();
        if (currentPage === "tasks") loadTasks();
        if (currentPage === "dashboard") loadDashboard();
    } catch (e) {
        console.error("提交任务失败:", e);
    }
}

async function quickSubmit(title, desc, agentId) {
    try {
        await fetch(`${API}/api/tasks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, description: desc, agent_id: agentId }),
        });
        switchPage("tasks");
    } catch (e) {
        console.error("提交快捷任务失败:", e);
    }
}

// 点击弹窗外部关闭
document.querySelectorAll(".modal-overlay").forEach(overlay => {
    overlay.addEventListener("click", e => {
        if (e.target === overlay) {
            overlay.classList.remove("show");
        }
    });
});
