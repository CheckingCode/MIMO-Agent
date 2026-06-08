/**
 * MCP (Model Context Protocol) Client
 *
 * Connects to MCP servers via stdio JSON-RPC 2.0.
 * Discovers tools and executes them on behalf of the AI agent.
 *
 * Protocol flow:
 *   1. Spawn server process
 *   2. Send `initialize` → receive capabilities
 *   3. Send `initialized` notification
 *   4. Send `tools/list` → receive available tools
 *   5. Send `tools/call` → execute a tool
 */

import { spawn, ChildProcess } from 'child_process';
import { ToolDefinition } from './api';

// ── Types ──

export interface McpServerConfig {
    /** Server name (for display) */
    name: string;
    /** Command to run (e.g. "npx", "node", "python") */
    command: string;
    /** Command arguments */
    args: string[];
    /** Environment variables */
    env?: Record<string, string>;
    /** Request/call timeout in milliseconds */
    timeoutMs?: number;
}

export interface McpTool {
    name: string;
    description: string;
    inputSchema: Record<string, any>;
}

export interface McpResource {
    uri: string;
    name: string;
    mimeType?: string;
}

interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: number;
    method: string;
    params?: Record<string, any>;
}

interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: number;
    result?: any;
    error?: { code: number; message: string; data?: any };
}

// ── MCP Client ──

export class McpClient {
    private process: ChildProcess | null = null;
    private requestId = 0;
    private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    private buffer = '';
    private tools: McpTool[] = [];
    private connected = false;

    constructor(private config: McpServerConfig) {}

    /**
     * Connect to the MCP server and initialize.
     */
    async connect(): Promise<McpTool[]> {
        return new Promise((resolve, reject) => {
            const env = { ...process.env, ...this.config.env };
            this.process = spawn(this.config.command, this.config.args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                env,
                windowsHide: true,
            });

            this.process.on('error', (err) => {
                this.connected = false;
                reject(new Error(`MCP server "${this.config.name}" failed to start: ${err.message}`));
            });

            this.process.on('exit', (code) => {
                this.connected = false;
                if (code !== 0 && code !== null) {
                    reject(new Error(`MCP server "${this.config.name}" exited with code ${code}`));
                }
            });

            // Handle stdout (JSON-RPC responses)
            this.process.stdout!.on('data', (chunk: Buffer) => {
                this.handleData(chunk.toString());
            });

            // Handle stderr (logs, ignore)
            this.process.stderr!.on('data', () => {
                // MCP servers may log to stderr, ignore it
            });

            // Initialize handshake
            this.sendRequest('initialize', {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'mimo-agent', version: '1.3.0' },
            }).then((result: any) => {
                this.connected = true;

                // Send initialized notification
                this.sendNotification('notifications/initialized', {});

                // List available tools
                return this.sendRequest('tools/list', {});
            }).then((result: any) => {
                this.tools = (result?.tools || []).map((t: any) => ({
                    name: t.name,
                    description: t.description || '',
                    inputSchema: t.inputSchema || { type: 'object', properties: {} },
                }));
                resolve(this.tools);
            }).catch(reject);
        });
    }

    /**
     * Call an MCP tool.
     */
    async callTool(name: string, args: Record<string, any>): Promise<string> {
        if (!this.connected) {
            return `MCP error: not connected to server "${this.config.name}"`;
        }

        try {
            const result = await this.sendRequest('tools/call', {
                name,
                arguments: args,
            });

            // Extract text content from result
            if (result?.content) {
                if (Array.isArray(result.content)) {
                    return result.content
                        .filter((c: any) => c.type === 'text')
                        .map((c: any) => c.text)
                        .join('\n');
                }
                return String(result.content);
            }
            return JSON.stringify(result || {});
        } catch (e: any) {
            return `MCP tool error (${name}): ${e.message}`;
        }
    }

    /**
     * Disconnect from the server.
     */
    disconnect(): void {
        this.connected = false;
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
        // Reject all pending requests
        for (const [id, p] of this.pending) {
            p.reject(new Error('Disconnected'));
        }
        this.pending.clear();
    }

    /**
     * Check if the client is currently connected.
     */
    isConnected(): boolean {
        return this.connected;
    }

    /**
     * Get request timeout for this MCP server.
     */
    getTimeoutMs(): number {
        const configured = Number(this.config.timeoutMs || (this.config as any).timeout_ms);
        return Number.isFinite(configured) && configured > 0 ? configured : 30_000;
    }

    /**
     * Get discovered tools as OpenAI tool definitions.
     */
    getToolDefinitions(): ToolDefinition[] {
        return this.tools.map(t => ({
            type: 'function' as const,
            function: {
                name: `mcp_${this.config.name}_${t.name}`,
                description: `[MCP:${this.config.name}] ${t.description}`,
                parameters: t.inputSchema,
            },
        }));
    }

    /**
     * Check if a tool name belongs to this MCP server.
     */
    isMcpTool(toolName: string): boolean {
        const prefix = `mcp_${this.config.name}_`;
        return toolName.startsWith(prefix);
    }

    /**
     * Extract the original MCP tool name from a prefixed name.
     */
    stripPrefix(toolName: string): string {
        const prefix = `mcp_${this.config.name}_`;
        return toolName.startsWith(prefix) ? toolName.slice(prefix.length) : toolName;
    }

    // ── JSON-RPC communication ──

    private sendRequest(method: string, params: Record<string, any>): Promise<any> {
        return new Promise((resolve, reject) => {
            const id = ++this.requestId;
            const request: JsonRpcRequest = {
                jsonrpc: '2.0',
                id,
                method,
                params,
            };

            this.pending.set(id, { resolve, reject });

            // Timeout after configured request limit
            setTimeout(() => {
                if (this.pending.has(id)) {
                    this.pending.delete(id);
                    reject(new Error(`MCP request timeout: ${method}`));
                }
            }, this.getTimeoutMs());

            const data = JSON.stringify(request) + '\n';
            try {
                this.process!.stdin!.write(data);
            } catch (e: any) {
                this.pending.delete(id);
                reject(new Error(`MCP write failed: ${e.message}`));
            }
        });
    }

    private sendNotification(method: string, params: Record<string, any>): void {
        const notification = {
            jsonrpc: '2.0',
            method,
            params,
        };
        const data = JSON.stringify(notification) + '\n';
        try {
            this.process?.stdin?.write(data);
        } catch (e) {
            console.error('[MiMo MCP] Failed to send notification:', e);
        }
    }

    private handleData(chunk: string): void {
        this.buffer += chunk;

        // Process complete lines
        let nlIdx: number;
        while ((nlIdx = this.buffer.indexOf('\n')) !== -1) {
            const line = this.buffer.slice(0, nlIdx).trim();
            this.buffer = this.buffer.slice(nlIdx + 1);

            if (!line) continue;

            try {
                const msg = JSON.parse(line);

                // Response to a request
                if (msg.id !== undefined && this.pending.has(msg.id)) {
                    const p = this.pending.get(msg.id)!;
                    this.pending.delete(msg.id);

                    if (msg.error) {
                        p.reject(new Error(msg.error.message || 'MCP error'));
                    } else {
                        p.resolve(msg.result);
                    }
                }
                // Notification from server (ignore for now)
            } catch {
                // Ignore parse errors
            }
        }
    }
}

// ── MCP Manager ──

export interface McpManagerConfig {
    servers: McpServerConfig[];
}

/**
 * MCP tool risk level.
 */
export type McpToolRiskLevel = 'low' | 'medium' | 'high';

/**
 * MCP tool security audit result.
 */
export interface McpToolRisk {
    name: string;
    risk: McpToolRiskLevel;
    reason: string;
}

/**
 * Audit an MCP tool for potential security risks.
 * Checks tool name and parameters for dangerous patterns.
 */
export function auditMcpTool(toolName: string, toolSchema: any): McpToolRisk {
    const name = toolName.toLowerCase();
    const desc = (toolSchema.description || '').toLowerCase();

    // High risk patterns
    if (/(exec|eval|spawn|shell|command|system|run)/i.test(name)) {
        return { name: toolName, risk: 'high', reason: '工具名称暗示命令执行能力' };
    }

    if (/(delete|remove|drop|destroy|purge|wipe|erase)/i.test(name)) {
        return { name: toolName, risk: 'high', reason: '工具名称暗示删除能力' };
    }

    if (/(send|post|upload|transmit|exfiltrate)/i.test(name)) {
        return { name: toolName, risk: 'medium', reason: '工具名称暗示数据外发能力' };
    }

    if (/(read|write|file|path|directory|fs)/i.test(name)) {
        return { name: toolName, risk: 'medium', reason: '工具具有文件系统访问能力' };
    }

    // Check parameters for path/command fields
    const params = toolSchema.parameters?.properties || {};
    for (const [key, val] of Object.entries(params)) {
        if (/(path|file|dir|command|cmd|exec)/i.test(key)) {
            return { name: toolName, risk: 'medium', reason: `参数 "${key}" 可能接受路径或命令` };
        }
    }

    return { name: toolName, risk: 'low', reason: '未检测到明显风险' };
}

export class McpManager {
    private clients = new Map<string, McpClient>();
    private allTools: ToolDefinition[] = [];

    /**
     * Connect to all configured MCP servers.
     * Audits each tool for security risks and logs warnings.
     */
    async connectAll(configs: McpServerConfig[]): Promise<ToolDefinition[]> {
        this.allTools = [];

        for (const config of configs) {
            try {
                const client = new McpClient(config);
                const tools = await client.connect();
                this.clients.set(config.name, client);
                this.allTools.push(...client.getToolDefinitions());
                console.log(`[MiMo] MCP server "${config.name}" connected: ${tools.length} tools`);

                // Audit each tool for security risks
                for (const tool of tools) {
                    const risk = auditMcpTool(tool.name, tool);
                    if (risk.risk === 'high') {
                        console.warn(`[MiMo MCP] ⚠️ 高风险工具已加载: ${tool.name} — ${risk.reason}`);
                    } else if (risk.risk === 'medium') {
                        console.log(`[MiMo MCP] 中风险工具: ${tool.name} — ${risk.reason}`);
                    }
                }
            } catch (e: any) {
                console.error(`[MiMo] MCP server "${config.name}" failed: ${e.message}`);
            }
        }

        return this.allTools;
    }

    /**
     * Call an MCP tool by its prefixed name.
     * Returns error if the owning server is disconnected.
     * Includes connection health check and call timeout.
     */
    async callTool(toolName: string, args: Record<string, any>): Promise<string> {
        for (const [name, client] of this.clients) {
            if (client.isMcpTool(toolName)) {
                if (!client.isConnected()) {
                    this.rebuildTools();
                    return `MCP error: server "${name}" is disconnected. Tool "${toolName}" unavailable.`;
                }
                const originalName = client.stripPrefix(toolName);

                const timeout = client.getTimeoutMs();
                return await Promise.race([
                    client.callTool(originalName, args),
                    new Promise<string>((_, reject) =>
                        setTimeout(() => reject(new Error(`MCP 工具 "${toolName}" 调用超时（${timeout / 1000}秒）`)), timeout)
                    ),
                ]).catch(e => `MCP tool error (${toolName}): ${e.message}`);
            }
        }
        return `MCP error: unknown tool "${toolName}"`;
    }

    /**
     * Rebuild allTools from currently connected clients.
     * Called after a server disconnects to remove stale tool definitions.
     */
    private rebuildTools(): void {
        this.allTools = [];
        for (const [, client] of this.clients) {
            if (client.isConnected()) {
                this.allTools.push(...client.getToolDefinitions());
            }
        }
    }

    /**
     * Check if a tool name is an MCP tool.
     */
    isMcpTool(toolName: string): boolean {
        return toolName.startsWith('mcp_');
    }

    /**
     * Get all MCP tool definitions.
     */
    getAllToolDefinitions(): ToolDefinition[] {
        return this.allTools;
    }

    /**
     * Disconnect all servers.
     */
    disconnectAll(): void {
        for (const [, client] of this.clients) {
            client.disconnect();
        }
        this.clients.clear();
        this.allTools = [];
    }
}
