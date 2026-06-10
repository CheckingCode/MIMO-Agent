import * as fs from 'fs';
import * as path from 'path';
import { ContentPart, ToolCall } from './api';
import { AgentEvents, ConversationState } from './agentTypes';

const ARTIFACT_EXTENSIONS = [
    'wav', 'mp3', 'm4a', 'flac', 'aac', 'ogg', 'opus',
    'mp4', 'mov', 'webm', 'avi', 'mkv',
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg',
    'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx',
    'csv', 'vtt', 'srt',
];

const SOURCE_CODE_EXTENSIONS = new Set([
    'html', 'htm', 'css', 'scss', 'sass', 'less', 'js', 'jsx', 'ts', 'tsx', 'json', 'md', 'txt', 'xml', 'yml', 'yaml', 'py', 'java', 'c', 'cc', 'cpp', 'h', 'hpp', 'rs', 'go', 'php', 'rb', 'sh', 'ps1', 'bat'
]);

export class AgentArtifactManager {
    constructor(private readonly getWorkspace: () => string) {}

    maybeSaveLongFinalResponse(response: string, events: AgentEvents): string {
        const clean = (response || '').trim();
        if (clean.length < 3000 && !this.isSubstantialFinalReport(clean)) return response;
        if (/Saved copy:\s+.+\.md|已另存为[:：]\s+.+\.md/i.test(clean)) return response;

        try {
            const filename = this.buildSummaryFilename(clean);
            const target = path.join(this.getWorkspace(), filename);
            fs.writeFileSync(target, clean.endsWith('\n') ? clean : `${clean}\n`, 'utf-8');
            events.onReasoning(`[Summary] Long final response saved to ${filename}.`);
            return `${clean}\n\n已另存为: ${filename}`;
        } catch (e: any) {
            events.onReasoning(`[Summary] Failed to save long final response: ${String(e?.message || e).slice(0, 160)}`);
            return response;
        }
    }

    appendMissingArtifactSummary(conv: ConversationState, finalText: string): string {
        const cleanFinal = String(finalText || '');
        const artifacts = this.collectRecentArtifactPaths(conv)
            .filter(filePath => !cleanFinal.includes(filePath));
        if (artifacts.length === 0) return finalText;

        const useChinese = conv.uiLang !== 'en' || /[\u4e00-\u9fff]/.test(cleanFinal);
        const heading = useChinese ? '交付文件：' : 'Artifacts:';
        const lines = artifacts.map(filePath => `- \`${filePath}\``);
        return `${cleanFinal.trim()}\n\n${heading}\n${lines.join('\n')}`;
    }

    isSubstantialFinalReport(text: string): boolean {
        const clean = (text || '').trim();
        if (clean.length < 1800) return false;
        const headingCount = (clean.match(/^#{1,3}\s+\S+/gm) || []).length;
        const bulletCount = (clean.match(/^\s*(?:[-*]|\d+\.)\s+\S+/gm) || []).length;
        const reportMarkers = /(summary|report|audit|review|findings|conclusion|validation|next steps|总结|报告|审计|评估|结论|验证|问题|建议|修复)/i.test(clean);
        const finalMarkers = /(done|completed|fixed|implemented|saved|完成|已完成|已修复|已实现|已保存|无需继续|未修改文件)/i.test(clean);
        const looksStructured = headingCount >= 2 || bulletCount >= 6;
        return reportMarkers && looksStructured && (finalMarkers || clean.length >= 3000);
    }

    isDeliverySummary(text: string): boolean {
        const clean = (text || '').trim();
        if (clean.length < 120) return false;
        const hasDone = /(完成总结|任务已完成|任务完成|已完成|完成|done|completed|final summary)/i.test(clean);
        const hasFile = /(\.md\b|交付文件|文件已写入|已生成|已保存|saved|generated|written)/i.test(clean);
        const hasStats = /(统计|共\s*\d+|包含\s*\d+|文献|引用|验证|DOI|tokens?|lines?|words?)/i.test(clean);
        const hasRiskOrNext = /(风险|建议|注意|后续|next|risk|warning|recommend)/i.test(clean);
        return hasDone && hasFile && (hasStats || hasRiskOrNext);
    }

    private buildSummaryFilename(response: string): string {
        const firstHeading = response
            .split(/\r?\n/)
            .map(line => line.replace(/^#{1,6}\s+/, '').trim())
            .find(line => line.length >= 4 && !line.startsWith('```'));
        const base = (firstHeading || 'mimo-summary')
            .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
            .replace(/\s+/g, '-')
            .slice(0, 40)
            .replace(/^-+|-+$/g, '') || 'mimo-summary';
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        return `${base}-${stamp}.md`;
    }

    private collectStringValues(value: any): string[] {
        if (value === null || value === undefined) return [];
        if (typeof value === 'string') return [value];
        if (Array.isArray(value)) return value.flatMap(item => this.collectStringValues(item));
        if (typeof value === 'object') return Object.values(value).flatMap(item => this.collectStringValues(item));
        return [];
    }

    private cleanArtifactPath(candidate: string): string {
        return String(candidate || '')
            .trim()
            .replace(/^[`"'\u201c\u201d\u2018\u2019]+|[`"'\u201c\u201d\u2018\u2019]+$/g, '')
            .replace(/[.,，。！？、】【；;:：\]}]+$/g, '')
            .trim();
    }

    private isDeliverablePath(filePath: string): boolean {
        const normalized = String(filePath || '').trim().replace(/\\/g, '/');
        if (!normalized) return false;
        const ext = path.extname(normalized).replace(/^\./, '').toLowerCase();
        if (!ext) return false;
        return !SOURCE_CODE_EXTENSIONS.has(ext);
    }

    private extractArtifactPathsFromText(text: string): string[] {
        const raw = String(text || '');
        if (!raw) return [];
        const ext = ARTIFACT_EXTENSIONS.join('|');
        const patterns = [
            new RegExp(`['\"]([^'\"\\r\\n]+\\.(?:${ext}))['\"]`, 'gi'),
            new RegExp(`([A-Za-z]:[\\\\/][^\\r\\n'\"<>|]+?\\.(?:${ext}))`, 'gi'),
            new RegExp(`((?:/|\\.{1,2}[\\\\/])[^\\s'\"<>|]+\\.(?:${ext}))`, 'gi'),
            new RegExp(`\\b((?:output|outputs|dist|build|release|releases|tmp|temp)[\\\\/][^\\s'\"<>|]+\\.(?:${ext}))`, 'gi'),
        ];
        const found: string[] = [];
        for (const pattern of patterns) {
            for (const match of raw.matchAll(pattern)) {
                const value = this.cleanArtifactPath(match[1] || match[0] || '');
                if (value && this.isDeliverablePath(value)) found.push(value);
            }
        }
        return found;
    }

    private collectRecentArtifactPaths(conv: ConversationState, lookback = 80): string[] {
        const seen = new Set<string>();
        const artifacts: string[] = [];
        const add = (candidate: string) => {
            const clean = this.cleanArtifactPath(candidate);
            if (!clean || !this.isDeliverablePath(clean)) return;
            const key = clean.replace(/\\/g, '/').toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            artifacts.push(clean);
        };

        const recentMessages = conv.messages.slice(-lookback);
        let startIndex = 0;
        for (let i = recentMessages.length - 1; i >= 0; i--) {
            if (recentMessages[i].role === 'user') {
                startIndex = i;
                break;
            }
        }

        for (const msg of recentMessages.slice(startIndex)) {
            if (msg.role === 'assistant' && msg.tool_calls?.length) {
                for (const tc of msg.tool_calls) {
                    const args = this.parseToolArgs(tc);
                    for (const value of this.collectStringValues(args)) {
                        for (const artifact of this.extractArtifactPathsFromText(value)) add(artifact);
                    }
                }
                continue;
            }
            if (msg.role === 'tool') {
                for (const artifact of this.extractArtifactPathsFromText(this.extractMessageText(msg.content))) add(artifact);
            }
        }
        return artifacts.slice(-8);
    }

    private parseToolArgs(toolCall: ToolCall): Record<string, any> {
        try {
            return JSON.parse(toolCall.function.arguments || '{}');
        } catch {
            return {};
        }
    }

    private extractMessageText(content: string | ContentPart[] | null | undefined): string {
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
            return content
                .filter((part) => part.type === 'text')
                .map((part) => part.text || '')
                .join(' ')
                .trim();
        }
        return '';
    }
}
