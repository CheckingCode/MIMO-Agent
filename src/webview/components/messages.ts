/**
 * Messages component — chat messages, streaming, tool cards, diff view, thinking blocks.
 */
import { store, ImageData } from '../core/store';
import { bus } from '../core/bus';
import { vscode } from '../core/vscode';
import { escapeHtml, createElement } from '../utils/dom';
import { parseTodoItems, renderTaskChecklist } from './taskChecklist';
import { getWelcomePair, t } from '../core/i18n';

// ── Helpers ──

function formatTokenCount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
}

/**
 * Smart auto-scroll: only scroll to bottom if user is already near the bottom.
 * If user has scrolled up to read earlier content, leave their position alone.
 */
function isNearBottom(el: HTMLElement, threshold = 120): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
}
function smartScroll(el: HTMLElement): void {
    if (isNearBottom(el)) {
        el.scrollTop = el.scrollHeight;
    }
}

interface EditedFileInfo {
    path: string;
    action: string;
    added: number;
    removed: number;
}

// Tool card helpers

const TOOL_ICONS: Record<string, string> = {
    read_file: 'R', write_file: 'W', edit_file: 'E', list_directory: 'L',
    search_files: 'S', execute_command: '$', fetch_url: 'U', glob_files: 'G',
    delete_file: 'D', move_file: 'M', copy_file: 'C', get_file_info: 'I',
    git_status: 'GS', git_diff: 'GD', git_log: 'GL', git_commit: 'GC',
    git_push: 'GP', git_pull: 'GU', web_search: 'WS',
    browser_open: 'BO', browser_click: 'BC', browser_type: 'BT',
    browser_screenshot: 'BS', browser_get_content: 'BG', browser_close: 'BX',
    spawn_subagent: 'SA', git_worktree_add: 'WA', git_worktree_list: 'WL',
    git_worktree_remove: 'WR', read_notebook: 'NR', edit_notebook_cell: 'NE',
    insert_notebook_cell: 'NI', delete_notebook_cell: 'ND',
    desktop_screenshot: 'DS', desktop_windows: 'DW', desktop_focus: 'DF',
    desktop_type: 'DT', desktop_key: 'DK', desktop_click: 'DC',
    desktop_mouse_move: 'DM', desktop_drag: 'DD', desktop_launch: 'DL',
};

const READONLY_TOOLS = new Set([
    'read_file', 'list_directory', 'glob_files', 'search_files',
    'get_file_info', 'git_status', 'git_diff', 'git_log', 'web_search',
    'git_worktree_list', 'read_notebook',
]);

function toolIcon(name: string): string {
    if (name.startsWith('mcp_')) return 'MCP';
    return TOOL_ICONS[name] || '?';
}

function toolSummary(name: string, args: any): string {
    if (!args || typeof args !== 'object') return '';
    // MCP tools: show server name + tool name
    if (name.startsWith('mcp_')) {
        const parts = name.split('_');
        const server = parts[1] || 'unknown';
        const tool = parts.slice(2).join('_');
        return `[${server}] ${tool}`;
    }
    switch (name) {
        case 'read_file': {
            let summary = args.path || '';
            if (args.offset || args.limit) {
                const start = (args.offset || 0) + 1;
                const end = args.limit ? start + args.limit - 1 : '...';
                summary += ` [L${start}-${end}]`;
            }
            return summary;
        }
        case 'write_file': return (args.path || '') + (args.content ? ` (${args.content.length} chars)` : '');
        case 'edit_file': return args.path || '';
        case 'list_directory': return args.path || '.';
        case 'search_files': return `"${args.pattern || ''}" in ${args.path || '.'}`;
        case 'execute_command': return args.command || '';
        case 'fetch_url': return args.url || '';
        case 'glob_files': return `${args.pattern || ''} in ${args.path || '.'}`;
        case 'delete_file': return args.path || '';
        case 'move_file': return `${args.source || ''} -> ${args.destination || ''}`;
        case 'copy_file': return `${args.source || ''} -> ${args.destination || ''}`;
        case 'get_file_info': return args.path || '';
        case 'git_status': return args.path || 'workspace';
        case 'git_diff': return (args.staged ? 'staged' : 'unstaged') + (args.file ? ` ${args.file}` : '');
        case 'git_log': return `${args.count || 10} commits`;
        case 'git_commit': return `"${(args.message || '').substring(0, 40)}"`;
        case 'git_push': return (args.remote || 'origin') + (args.branch ? ` ${args.branch}` : '');
        case 'git_pull': return (args.remote || 'origin') + (args.branch ? ` ${args.branch}` : '');
        case 'web_search': return args.query || '';
        case 'browser_open': return args.url || '';
        case 'browser_click': return args.selector || '';
        case 'browser_type': return `${args.selector || ''} -> "${(args.text || '').substring(0, 30)}"`;
        case 'browser_screenshot': return args.path || 'page';
        case 'browser_get_content': return 'page content';
        case 'browser_close': return '';
        case 'spawn_subagent': return `${args.type || 'general'}: ${(args.task || '').substring(0, 50)}`;
        case 'git_worktree_add': return args.branch || '';
        case 'git_worktree_list': return 'all worktrees';
        case 'git_worktree_remove': return args.path || '';
        case 'read_notebook': return args.path || '';
        case 'edit_notebook_cell': return `${args.path || ''} cell ${args.index}`;
        case 'insert_notebook_cell': return `${args.path || ''} at ${args.index ?? 'end'}`;
        case 'delete_notebook_cell': return `${args.path || ''} cell ${args.index}`;
        case 'desktop_screenshot': return args.windowTitle || 'full screen';
        case 'desktop_windows': return 'list all windows';
        case 'desktop_focus': return args.windowTitle || '';
        case 'desktop_type': return (args.text || '').substring(0, 30);
        case 'desktop_key': return args.key || '';
        case 'desktop_click': return `(${args.x}, ${args.y})`;
        case 'desktop_mouse_move': return `(${args.x}, ${args.y})`;
        case 'desktop_drag': return `(${args.x1},${args.y1}) -> (${args.x2},${args.y2})`;
        case 'desktop_launch': return args.appName || '';
        default: return JSON.stringify(args).substring(0, 60);
    }
}

export const Messages = {
    mount(): void {
        const messagesDiv = document.getElementById('messages');
        if (!messagesDiv) return;

        // Single sticky prompt bar. User cards stay in normal flow; only a cloned
        // preview sticks to the top, which avoids stacked cards and leakage.
        const stickyPrompt = createElement('div', 'sticky-user-preview hidden');
        stickyPrompt.setAttribute('aria-hidden', 'true');
        messagesDiv.prepend(stickyPrompt);
        let lastStickySource: HTMLElement | null = null;
        let stickyFrame = 0;
        let stickyResizeObserver: ResizeObserver | null = null;

        const setStickySource = (source: HTMLElement | null) => {
            if (source === lastStickySource) return;
            lastStickySource?.classList.remove('is-sticky-source');
            lastStickySource = source;

            if (!source) {
                stickyPrompt.classList.add('hidden');
                stickyPrompt.replaceChildren();
                messagesDiv.style.removeProperty('--sticky-user-height');
                stickyResizeObserver?.disconnect();
                stickyResizeObserver = null;
                return;
            }

            source.classList.add('is-sticky-source');
            const clone = source.cloneNode(true) as HTMLElement;
            clone.className = 'msg msg-user sticky-user-clone';
            clone.querySelectorAll('button').forEach(btn => btn.remove());
            stickyPrompt.replaceChildren(clone);
            stickyPrompt.classList.remove('hidden');
            const syncHeight = () => {
                const height = clone.offsetHeight || stickyPrompt.scrollHeight || stickyPrompt.offsetHeight;
                messagesDiv.style.setProperty('--sticky-user-height', `${Math.ceil(height)}px`);
            };
            requestAnimationFrame(syncHeight);
            stickyResizeObserver?.disconnect();
            if (typeof ResizeObserver !== 'undefined') {
                stickyResizeObserver = new ResizeObserver(syncHeight);
                stickyResizeObserver.observe(stickyPrompt);
            }
        };

        const updateStickyPrompt = () => {
            stickyFrame = 0;
            const userMsgs = Array.from(messagesDiv.querySelectorAll('.msg-user:not(.sticky-user-clone)')) as HTMLElement[];
            if (userMsgs.length === 0) {
                setStickySource(null);
                return;
            }

            const containerTop = messagesDiv.getBoundingClientRect().top;
            let active: HTMLElement | null = null;
            for (const msg of userMsgs) {
                const rect = msg.getBoundingClientRect();
                if (rect.top <= containerTop + 2) active = msg;
                if (rect.top > containerTop + 2) break;
            }

            const last = userMsgs[userMsgs.length - 1];
            if (active && active === last && last.getBoundingClientRect().top > containerTop - 2) {
                active = null;
            }
            setStickySource(active);
        };

        const scheduleStickyPromptUpdate = () => {
            if (stickyFrame) return;
            stickyFrame = requestAnimationFrame(updateStickyPrompt);
        };

        messagesDiv.addEventListener('scroll', scheduleStickyPromptUpdate, { passive: true });
        new MutationObserver(scheduleStickyPromptUpdate).observe(messagesDiv, { childList: true });
        requestAnimationFrame(updateStickyPrompt);

        // Code block copy (event delegation)
        messagesDiv.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest('.copy-btn') as HTMLElement | null;
            if (!btn) return;
            const block = btn.closest('.code-block');
            if (!block) return;
            const code = block.querySelector('code');
            if (!code) return;
            const text = code.textContent || '';
            navigator.clipboard.writeText(text).then(() => {
                btn.textContent = 'Copied!';
                btn.classList.add('copied');
                setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
            }).catch(() => {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.cssText = 'position:fixed;opacity:0';
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand('copy'); } catch { /* ignore */ }
                document.body.removeChild(ta);
            });
        });

        // Tool card expand/collapse (event delegation)
        messagesDiv.addEventListener('click', (e) => {
            const header = (e.target as HTMLElement).closest('.tool-header');
            if (header) {
                const card = header.closest('.tool-card');
                if (card) card.classList.toggle('expanded');
            }

            // URL link click → open in browser
            const link = (e.target as HTMLElement).closest('a.url-link') as HTMLAnchorElement | null;
            if (link && link.href) {
                e.preventDefault();
                e.stopPropagation();
                vscode.post({ type: 'openUrl', url: link.href });
            }
        });

        // Listen for messages from host
        bus.on('userMessage', (text: string, images?: ImageData[] | null) => this.addUserMessage(text, images));
        bus.on('streamHtml', (html: string) => this.handleStream(html));
        bus.on('reasoning', (token: string) => this.handleReasoning(token));
        bus.on('toolCallStart', (name: string, args: any) => this.addToolCard(name, args));
        bus.on('toolCallEnd', (name: string, result: string, isError: boolean, elapsed: number) => this.handleToolCallEnd(name, result, isError, elapsed));
        bus.on('roundStart', (round: number) => this.handleRoundStart(round));
        bus.on('done', () => this.handleDone());
        bus.on('error', (error: string) => this.handleError(error));
        bus.on('system', (text: string) => this.addSystemMessage(text));
        bus.on('clearMessages', () => this.clearMessages());
        bus.on('welcomeUpdate', (desc: string, hint: string) => this.updateWelcome(desc, hint));
        bus.on('tokenUsage', (usage: { promptTokens: number; completionTokens: number; totalTokens: number }) => this.handleTokenUsage(usage));
        bus.on('conversationUsage', (usage: { totalTokens: number; callCount: number }) => this.handleConversationUsage(usage));
        bus.on('editPreview', (previewId: string, path: string, oldText: string, newText: string, matchCount: number) => this.renderEditPreviewCard(previewId, path, oldText, newText, matchCount));
        bus.on('writePreview', (previewId: string, filePath: string, content: string, isCreate: boolean) => this.renderWritePreviewCard(previewId, filePath, content, isCreate));
        // Workflow events
        bus.on('workflowStart', (totalPhases: number, totalTasks: number) => this.handleWorkflowStart(totalPhases, totalTasks));
        bus.on('workflowPhaseStart', (pi: number, title: string, mode: string, tc: number) => this.handleWorkflowPhaseStart(pi, title, mode, tc));
        bus.on('workflowTaskStart', (pi: number, ti: number, label: string) => this.handleWorkflowTaskStart(pi, ti, label));
        bus.on('workflowTaskEnd', (pi: number, ti: number, result: any) => this.handleWorkflowTaskEnd(pi, ti, result));
        bus.on('workflowPhaseEnd', (pi: number, result: any) => this.handleWorkflowPhaseEnd(pi, result));
        bus.on('workflowEnd', (result: any) => this.handleWorkflowEnd(result));
        // Adversarial mode events
        bus.on('adversarialTurn', (persona: string, name: string, icon: string, phase: string, content: string, iteration: number) => this.handleAdversarialTurn(persona, name, icon, phase, content, iteration));
        bus.on('adversarialToolStart', (persona: string, toolName: string, args: any) => this.handleAdversarialToolStart(persona, toolName, args));
        bus.on('adversarialToolEnd', (persona: string, toolName: string, result: string, isError: boolean, elapsed: number) => this.handleAdversarialToolEnd(persona, toolName, result, isError, elapsed));
        // Plan mode
        bus.on('planReady', (planContent?: string, planPath?: string) => this.showPlanConfirm(planContent, planPath));
        // Ask user interactive dialog
        bus.on('askUser', (previewId: string, question: string, options: string[]) => this.renderAskUserCard(previewId, question, options));
        // Message queue
        bus.on('messageQueued', (text: string, queueLength: number) => this.showQueuedMessage(text, queueLength));
        bus.on('queueProcessed', (remaining: number) => this.updateQueueDisplay(remaining));
        bus.on('clearQueue', () => this.clearQueueDisplay());
    },

    // ── User message ──
    addUserMessage(text: string, images?: ImageData[] | null): void {
        const messagesDiv = document.getElementById('messages')!;
        store.set('lastUserMsg', { text, images: images || null });

        const u = createElement('div', 'msg msg-user');
        // Add spacing before user message if there are previous messages
        const hasVisibleMessages = Array.from(messagesDiv.children)
            .some(child => !(child as HTMLElement).classList.contains('sticky-user-preview'));
        if (hasVisibleMessages) {
            u.style.marginTop = '20px';
        }
        if (images && images.length > 0) {
            const imgRow = createElement('div');
            imgRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:2px';
            for (let i = 0; i < images.length; i++) {
                const img = createElement('img', 'msg-img') as HTMLImageElement;
                img.src = images[i].dataUrl;
                img.title = `#${i + 1} ${images[i].name}`;
                img.style.cssText = 'height:40px;width:auto;border-radius:4px;cursor:pointer;vertical-align:middle';
                img.addEventListener('click', (e) => { e.stopPropagation(); bus.emit('showOverlay', images[i].dataUrl); });
                imgRow.appendChild(img);
            }
            u.appendChild(imgRow);
        }
        // Wrap text in a div for line-clamp to work
        if (text) {
            const textDiv = createElement('div', 'text-content');
            textDiv.textContent = text;
            u.appendChild(textDiv);
        }

        // Copy button (appears on hover)
        const copyBtn = createElement('button', 'msg-copy');
        copyBtn.textContent = 'Copy';
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Copy text
            const textToCopy = text || '';
            // Also include image data URLs if present
            let fullText = textToCopy;
            if (images && images.length > 0) {
                fullText += (textToCopy ? '\n' : '') + images.map(img => `[Image: ${img.name}]`).join('\n');
            }
            navigator.clipboard.writeText(fullText).then(() => {
                copyBtn.textContent = 'Copied!';
                copyBtn.classList.add('copied');
                setTimeout(() => { copyBtn.textContent = 'Copy'; copyBtn.classList.remove('copied'); }, 2000);
            }).catch(() => {});
        });
        u.appendChild(copyBtn);

        messagesDiv.appendChild(u);
        smartScroll(messagesDiv);

        // Collapse toggle for long messages — must check AFTER append so scrollHeight is accurate
        requestAnimationFrame(() => {
            const textDiv = u.querySelector('.text-content');
            const lineHeight = 1.5 * 13; // line-height * font-size
            const maxHeight = lineHeight * 3 + 16; // 3 lines + padding
            const shouldCollapse = textDiv && (textDiv.scrollHeight > maxHeight + 10 || (images && images.length > 0 && text));

            if (shouldCollapse) {
                const expandBtn = createElement('button', 'expand-toggle');
                expandBtn.textContent = '展开 ▼';
                expandBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    u.classList.toggle('expanded');
                    expandBtn.textContent = u.classList.contains('expanded') ? '收起 ▲' : '展开 ▼';
                });
                u.appendChild(expandBtn);
                u.classList.add('collapsible');
            }
        });

        store.set('streamingMsg', null);
        store.set('rawHtml', '');
    },

    // ── Thinking block lifecycle ──
    /** Mark all active (not done) thinking dots as completed. */
    _markThinkingDone(): void {
        const dots = document.querySelectorAll('.thinking-dot:not(.done)');
        for (let i = 0; i < dots.length; i++) {
            dots[i].classList.add('done');
            const lbl = dots[i].parentElement?.querySelector('span:nth-child(2)') as HTMLElement | null;
            if (lbl) lbl.textContent = 'Thought';
            // Show the toggle when thinking is finalized
            const toggle = dots[i].parentElement as HTMLElement | null;
            if (toggle) toggle.style.display = '';
        }
    },

    // ── Streaming ──
    handleStream(html: string): void {
        const messagesDiv = document.getElementById('messages')!;
        let streamingMsg = store.get('streamingMsg');

        if (!streamingMsg) {
            streamingMsg = this.createAssistantMsg();
            const mc = createElement('div', 'md-content');
            streamingMsg.appendChild(mc);
            store.set('streamingMsg', streamingMsg);
            store.set('rawHtml', '');
        }

        // Remove spinner
        const sp = streamingMsg.querySelector('.spinner');
        if (sp) sp.remove();

        // NOTE: Do NOT mark thinking as done here.
        // Thinking blocks should only be finalized when:
        //   1. A tool call starts (addToolCard)
        //   2. The response is done (handleDone)
        //   3. An error occurs (handleError)
        // Marking thinking done in handleStream causes a single continuous
        // thought to be split into multiple blocks when content tokens arrive
        // before the next round's reasoning tokens.

        store.set('rawHtml', html);
        const el = streamingMsg.querySelector('.md-content') || streamingMsg;
        // Post-process: replace task-checklist blocks with enhanced component
        el.innerHTML = this.enhanceTaskChecklists(this.stripRawToolCalls(html));
        smartScroll(messagesDiv);
    },

    // ── Enhance task checklists ──
    enhanceTaskChecklists(html: string): string {
        // Replace <div class="task-checklist">...</div> blocks with enhanced component
        return html.replace(
            /<div class="task-checklist">([\s\S]*?)<\/div>\s*<\/div>/g,
            (_: string, inner: string) => {
                const items = parseTodoItems(inner);
                if (items.length === 0) return '';
                return renderTaskChecklist(items);
            }
        );
    },

    /**
     * Strip raw tool_call XML that the model leaked into its text response.
     * Defense-in-depth: the system prompt already forbids this, but models
     * sometimes output <tool_call> tags anyway when tool calling fails.
     */
    stripRawToolCalls(html: string): string {
        return html.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
            .replace(/<tool_call>[\s\S]*$/gi, '');
    },

    // ── Reasoning/thinking ──
    handleReasoning(token: string): void {
        const messagesDiv = document.getElementById('messages')!;
        let streamingMsg = store.get('streamingMsg');

        if (!streamingMsg) {
            streamingMsg = this.createAssistantMsg();
            const mc = createElement('div', 'md-content');
            streamingMsg.appendChild(mc);
            store.set('streamingMsg', streamingMsg);
            store.set('rawHtml', '');
        }

        // Remove spinner
        const oldSpinner = streamingMsg.querySelector('.spinner');
        if (oldSpinner) oldSpinner.remove();

        // Find the LAST thinking block that is NOT marked as done.
        // If none exists (first round, or previous round was completed),
        // create a new block for this round's reasoning.
        // NOTE: We do NOT mark dots as done here — that happens when
        // a tool call starts, response text arrives, or done is received.
        const existingBlocks = streamingMsg.querySelectorAll('.thinking-block');
        let thinkBlock: HTMLElement | null = null;
        for (let i = existingBlocks.length - 1; i >= 0; i--) {
            const block = existingBlocks[i];
            const dot = block.previousElementSibling?.querySelector('.thinking-dot');
            if (dot && !dot.classList.contains('done')) {
                // Found an active (not done) thinking block — continue accumulating
                thinkBlock = block;
                break;
            }
        }

        if (!thinkBlock) {
            thinkBlock = createElement('div', 'thinking-block');
            (thinkBlock as any)._reasoningText = '';

            const toggle = createElement('div', 'thinking-toggle');
            const dot = createElement('span', 'thinking-dot');
            toggle.appendChild(dot);
            const lbl = createElement('span');
            lbl.textContent = 'Thinking...';
            toggle.appendChild(lbl);
            const arrow = createElement('span', 'arrow');
            arrow.innerHTML = '▸';
            toggle.appendChild(arrow);
            toggle.addEventListener('click', function (this: HTMLElement) {
                thinkBlock!.classList.toggle('show');
                this.classList.toggle('open');
            });

            // Append at the end of the message, then keep .md-content at the bottom.
            // This creates the natural interleaving:
            //   Round 1: [thinking-1] → [tool-1] [tool-2] → [md-content]
            //   Round 2: [thinking-1] → [tool-1] [tool-2] → [thinking-2] → [tool-3] → [md-content]
            streamingMsg.appendChild(toggle);
            streamingMsg.appendChild(thinkBlock);
            const mdContent = streamingMsg.querySelector('.md-content');
            if (mdContent) streamingMsg.appendChild(mdContent); // keep md-content at the bottom
        }

        (thinkBlock as any)._reasoningText += token;

        // Dedup: collapse repeated short phrases (e.g. model stuck in a loop)
        let displayText = (thinkBlock as any)._reasoningText;
        displayText = this._dedupReasoning(displayText);

        // Detect loop warning from agent and add visual indicator
        if (displayText.includes('⚠️ 检测到推理循环')) {
            thinkBlock.classList.add('reasoning-loop-warn');
        }

        if (displayText.length > 30) {
            thinkBlock.textContent = displayText;
            const prevToggle = thinkBlock.previousElementSibling as HTMLElement;
            prevToggle.style.display = '';
            // During replay, full reasoning arrives at once — auto-expand the block
            // (during live streaming, it stays expanded naturally as tokens stream in)
            if (token.length > 100 && !thinkBlock.classList.contains('show')) {
                thinkBlock.classList.add('show');
                prevToggle.classList.add('open');
            }
        } else {
            (thinkBlock.previousElementSibling as HTMLElement).style.display = 'none';
        }
    },

    /**
     * Deduplicate repeated phrases in reasoning text.
     * Detects when the same phrase repeats 3+ times consecutively
     * and collapses it to "×N" notation.
     */
    _dedupReasoning(text: string): string {
        // Pass 1: Match 3+ consecutive identical multi-line blocks (each line ≤ 200 chars)
        let result = text.replace(
            /((?:[^\n]{1,200}\n?){1,3})\1{2,}/g,
            (_match: string, phrase: string) => {
                const trimmed = phrase.replace(/\n+$/, '');
                const count = Math.ceil(_match.length / phrase.length);
                return trimmed + ` ×${count}\n`;
            }
        );
        // Skip expensive passes for very long text (performance guard)
        if (result.length < 3000) {
            // Pass 2: Fixed-size sliding-window dedup for aligned single-line repeats
            for (let size = 100; size >= 20; size -= 10) {
                const regex = new RegExp(`(.{${size}})\\1{2,}`, 'g');
                const newResult = result.replace(regex, (match: string, phrase: string) => {
                    const count = Math.round(match.length / phrase.length);
                    return phrase + ` ×${count}`;
                });
                if (newResult !== result) { result = newResult; break; }
            }
            // Pass 3: Flexible-length consecutive repeats (catches non-aligned patterns)
            // e.g. "思考思考思考..." or "Let me think.Let me think.Let me think."
            result = result.replace(/(.{20,}?)\1{2,}/g, (match: string, phrase: string) => {
                const count = Math.round(match.length / phrase.length);
                return phrase + ` ×${count}`;
            });
        }
        return result;
    },

    // ── Tool cards ──
    addToolCard(name: string, args: any): void {
        // Mark thinking as done — tool execution means reasoning for this round is complete
        this._markThinkingDone();

        // Append to the current streaming assistant message so tool cards
        // interleave with thinking blocks (not floating at #messages level)
        const streamingMsg = store.get('streamingMsg');
        const messagesDiv = document.getElementById('messages')!;
        const targetDiv = streamingMsg || messagesDiv;

        // execute_command → card-style layout with IN/OUT
        if (name === 'execute_command') {
            const card = createElement('div', 'tool-card');
            card.setAttribute('data-status', 'running');
            card.setAttribute('data-tool', name);
            (card as any)._toolName = name;
            (card as any)._toolArgs = args;

            const command = args.command || '';
            card.innerHTML =
                `<div class="tool-card-header">` +
                    `<span class="tool-card-dot"></span>` +
                    `<span class="tool-card-title">Bash</span>` +
                    `<span class="tool-card-desc">${escapeHtml(command.length > 60 ? command.substring(0, 60) + '...' : command)}</span>` +
                    `<span class="tool-card-time"></span>` +
                `</div>` +
                `<div class="tool-card-body">` +
                    `<div class="tool-card-section">` +
                        `<span class="tool-card-section-label">IN</span>` +
                        `<span class="tool-card-section-content">${escapeHtml(command)}</span>` +
                    `</div>` +
                `</div>`;

            targetDiv.appendChild(card);
            smartScroll(messagesDiv);
            return;
        }

        const card = createElement('div', 'tool-line');
        card.setAttribute('data-status', 'running');
        card.setAttribute('data-tool', name);
        (card as any)._toolName = name;
        (card as any)._toolArgs = args;

        const label = this.getToolLabel(name);
        const color = this.getToolColor(name);
        const summary = toolSummary(name, args);

        // Build clickable file link
        const filePath = this.getFilePath(args);
        const lineInfo = this.getLineInfo(name, args);
        const displayPath = filePath ? (lineInfo ? `${filePath} ${lineInfo}` : filePath) : summary;

        card.innerHTML = `<span class="tool-label" style="color:${color}">${label}</span>` +
            `<span class="tool-path"><a class="tool-link" href="#">${escapeHtml(displayPath)}</a></span>` +
            `<span class="tool-time"></span>`;

        // Click link to open file in VSCode
        const link = card.querySelector('.tool-link');
        if (!link) return;
        link.addEventListener('click', (e) => {
            e.stopPropagation();
            if (filePath) {
                vscode.post({ type: 'openFile', path: filePath, line: args.offset ? args.offset + 1 : undefined });
            }
        });

        targetDiv.appendChild(card);
        smartScroll(messagesDiv);
    },

    getToolLabel(name: string): string {
        const labels: Record<string, string> = {
            read_file: 'Read', write_file: 'Write', edit_file: 'Edit',
            list_directory: 'List', search_files: 'Search', glob_files: 'Glob',
            execute_command: 'Bash', fetch_url: 'Fetch', web_search: 'Search',
            git_status: 'Git', git_diff: 'Diff', git_log: 'Log',
            git_commit: 'Commit', git_push: 'Push', git_pull: 'Pull',
            delete_file: 'Delete', move_file: 'Move', copy_file: 'Copy',
            get_file_info: 'Info',
            browser_open: 'Open', browser_click: 'Click', browser_type: 'Type',
            browser_screenshot: 'Screenshot', browser_get_content: 'Read', browser_close: 'Close',
        };
        if (name.startsWith('mcp_')) return 'MCP';
        return labels[name] || name;
    },

    getToolColor(name: string): string {
        if (name.startsWith('git_')) return '#F05032';
        if (name.startsWith('browser_')) return '#2196F3';
        if (name.startsWith('mcp_')) return '#9C27B0';
        const colors: Record<string, string> = {
            read_file: '#4EC9B0', write_file: '#CE9178', edit_file: '#DCDCAA',
            search_files: '#569CD6', glob_files: '#569CD6', list_directory: '#569CD6',
            execute_command: '#DCDCAA', fetch_url: '#CE9178', web_search: '#569CD6',
            delete_file: '#F44336', move_file: '#FF9800', copy_file: '#9C27B0',
        };
        return colors[name] || 'var(--vscode-descriptionForeground)';
    },

    getFilePath(args: any): string {
        return args.path || args.source || args.file || '';
    },

    getLineInfo(name: string, args: any): string {
        if (name === 'read_file' && (args.offset || args.limit)) {
            const start = (args.offset || 0) + 1;
            const end = args.limit ? start + args.limit - 1 : '...';
            return `[L${start}-${end}]`;
        }
        return '';
    },

    getFileLink(name: string, args: any): string {
        const pathFields = ['path', 'source', 'file'];
        for (const field of pathFields) {
            if (args[field]) return args[field];
        }
        if (args.command) return args.command;
        if (args.url) return args.url;
        if (args.query) return args.query;
        return '';
    },

    handleToolCallEnd(name: string, result: string, isError: boolean, elapsed: number): void {
        const messagesDiv = document.getElementById('messages')!;
        const streamingMsg = store.get('streamingMsg');
        // Search in streamingMsg first (tool cards are now inside it), fallback to #messages
        const searchRoot = streamingMsg || messagesDiv;
        const allTools = searchRoot.querySelectorAll('.tool-line, .tool-card');
        const last = allTools[allTools.length - 1] as HTMLElement | null;
        if (!last) return;

        last.setAttribute('data-status', isError ? 'error' : 'success');

        // Update elapsed time
        const timeEl = last.querySelector('.tool-time') as HTMLElement | null;
        if (timeEl) timeEl.textContent = elapsed.toFixed(1) + 's';

        // Get tool info
        const toolName = (last as any)._toolName as string;
        const toolArgs = (last as any)._toolArgs as any;

        // edit_file → compact diff card
        if (toolName === 'edit_file' && toolArgs && (toolArgs.old_text || toolArgs.new_text)) {
            const diffCard = this.createDiffCard(toolArgs);
            if (diffCard) {
                last.after(diffCard);
                return;
            }
        }

        // git_diff → compact diff card
        if (toolName === 'git_diff' && result && result !== 'No changes') {
            const diffCard = createElement('div', 'diff-card');
            this.renderGitDiff(diffCard, result);
            if (diffCard.innerHTML) {
                last.after(diffCard);
                return;
            }
        }

        // execute_command → card-style: add OUT section
        if (toolName === 'execute_command') {
            last.setAttribute('data-status', isError ? 'error' : 'success');
            const body = last.querySelector('.tool-card-body');
            if (body) {
                const outSection = createElement('div', 'tool-card-section');
                const outLabel = createElement('span', 'tool-card-section-label');
                outLabel.textContent = 'OUT';
                const outContent = createElement('span', 'tool-card-section-content');
                outContent.textContent = result || '(no output)';
                outSection.appendChild(outLabel);
                outSection.appendChild(outContent);
                body.appendChild(outSection);
            }
            const timeEl = last.querySelector('.tool-card-time') as HTMLElement | null;
            if (timeEl) timeEl.textContent = elapsed.toFixed(1) + 's';
            // Don't clear streamingMsg - allow thinking to continue
            return;
        }

        // Don't clear streamingMsg - allow thinking to continue across tool calls
    },

    createDiffCard(args: any): HTMLElement | null {
        const oldText = args.old_text || '';
        const newText = args.new_text || '';
        if (!oldText && !newText) return null;

        const card = createElement('div', 'diff-card expanded');
        const oldLines = oldText.split('\n');
        const newLines = newText.split('\n');
        const filePath = args.path || 'file';

        // Compute diff using LCS
        const diff = this.computeDiff(oldLines, newLines);
        const added = diff.filter(d => d.type === 'add').length;
        const removed = diff.filter(d => d.type === 'del').length;
        card.setAttribute('data-file', filePath);
        card.setAttribute('data-action', 'edit');
        card.setAttribute('data-added', String(added));
        card.setAttribute('data-removed', String(removed));

        // Header
        card.innerHTML = `<div class="diff-card-header">` +
            `<span class="diff-file">${escapeHtml(filePath)}</span>` +
            `<span class="diff-stats">${added} added, ${removed} removed</span>` +
            `<span class="diff-chevron">▸</span>` +
            `</div><div class="diff-card-body"></div>`;

        const body = card.querySelector('.diff-card-body') as HTMLElement;

        // Render diff with context (show unchanged lines grayed out)
        const maxShow = Math.min(diff.length, 15);
        let oldLineNum = 0;
        let newLineNum = 0;
        for (let i = 0; i < maxShow; i++) {
            const d = diff[i];
            const div = createElement('div', `diff-card-line ${d.type === 'add' ? 'add' : d.type === 'del' ? 'del' : 'ctx'}`);
            if (d.type === 'del') {
                oldLineNum++;
                div.innerHTML = `<span class="diff-ln">${oldLineNum}</span><span class="diff-text">${escapeHtml(d.text).substring(0, 120)}</span>`;
            } else if (d.type === 'add') {
                newLineNum++;
                div.innerHTML = `<span class="diff-ln">${newLineNum}</span><span class="diff-text">${escapeHtml(d.text).substring(0, 120)}</span>`;
            } else {
                oldLineNum++;
                newLineNum++;
                div.innerHTML = `<span class="diff-ln">${newLineNum}</span><span class="diff-text" style="opacity:.4">${escapeHtml(d.text).substring(0, 120)}</span>`;
            }
            body.appendChild(div);
        }
        if (diff.length > maxShow) {
            const more = createElement('div', 'diff-card-line ctx');
            more.innerHTML = `<span class="diff-ln"></span><span class="diff-text" style="opacity:.4">... ${diff.length - maxShow} more lines</span>`;
            body.appendChild(more);
        }

        // Toggle expand on header click
        const diffHeader = card.querySelector('.diff-card-header');
        if (diffHeader) diffHeader.addEventListener('click', () => {
            card.classList.toggle('expanded');
        });

        return card;
    },

    /**
     * Simple LCS-based diff algorithm.
     * Returns array of {type: 'ctx'|'add'|'del', text: string}
     */
    computeDiff(oldLines: string[], newLines: string[]): Array<{type: string; text: string}> {
        const m = oldLines.length;
        const n = newLines.length;

        // Guard: skip LCS for very large inputs to avoid O(m*n) memory blowup
        if (m * n > 250_000) {
            // Fallback: show all old as del, all new as add (no context)
            const result: Array<{type: string; text: string}> = [];
            for (const line of oldLines) result.push({ type: 'del', text: line });
            for (const line of newLines) result.push({ type: 'add', text: line });
            return result;
        }

        // Build LCS table
        const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (oldLines[i - 1] === newLines[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }

        // Backtrack to find diff (push + reverse instead of unshift for O(n) total)
        const result: Array<{type: string; text: string}> = [];
        let i = m, j = n;
        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
                result.push({ type: 'ctx', text: oldLines[i - 1] });
                i--; j--;
            } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
                result.push({ type: 'add', text: newLines[j - 1] });
                j--;
            } else {
                result.push({ type: 'del', text: oldLines[i - 1] });
                i--;
            }
        }

        result.reverse();
        return result;
    },

    renderEditDiff(res: HTMLElement, args: any, txt: string): void {
        const oldLines = (args.old_text || '').split('\n');
        const newLines = (args.new_text || '').split('\n');
        let html = `<div class="diff-header-line"><span class="diff-stats">-${oldLines.length} +${newLines.length}</span></div>`;
        const maxShow = Math.max(oldLines.length, newLines.length, 8);
        const showOld = oldLines.slice(0, maxShow);
        const showNew = newLines.slice(0, maxShow);
        for (const line of showOld) {
            html += `<div class="diff-line"><span class="diff-ln">-</span><span class="diff-del">- ${escapeHtml(line).substring(0, 120)}</span></div>`;
        }
        if (oldLines.length > maxShow) html += `<div class="diff-line"><span class="diff-ln">...</span><span class="diff-info">+${oldLines.length - maxShow} more lines</span></div>`;
        for (const line of showNew) {
            html += `<div class="diff-line"><span class="diff-ln">+</span><span class="diff-add">+ ${escapeHtml(line).substring(0, 120)}</span></div>`;
        }
        if (newLines.length > maxShow) html += `<div class="diff-line"><span class="diff-ln">...</span><span class="diff-info">+${newLines.length - maxShow} more lines</span></div>`;
        html += `<div class="diff-info">${escapeHtml(txt)}</div>`;
        res.innerHTML = html;
    },

    renderGitDiff(res: HTMLElement, txt: string): void {
        const maxChars = 8000;
        const truncated = txt.length > maxChars;
        const lines = (truncated ? txt.substring(0, maxChars) : txt).split('\n');
        const CONTEXT_LINES = 2; // lines of context around each change

        // ── Phase 1: Parse into structured hunks per file ──
        interface DiffLine { type: 'add' | 'del' | 'ctx' | 'hunk' | 'file'; text: string; oldLn?: number; newLn?: number; label?: string; skipped?: number; }
        const files: { name: string; hunks: DiffLine[][]; added: number; removed: number }[] = [];
        let curFile = { name: '', hunks: [] as DiffLine[][], added: 0, removed: 0 };
        let curHunk: DiffLine[] = [];
        let oldLn = 0, newLn = 0;

        for (const line of lines) {
            if (line.startsWith('diff --git')) {
                if (curFile.name) { files.push(curFile); }
                const m = line.match(/b\/(.+)$/);
                curFile = { name: m ? m[1] : '', hunks: [], added: 0, removed: 0 };
                curHunk = [];
                oldLn = 0; newLn = 0;
                continue;
            }
            if (line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) continue;
            if (line.startsWith('@@')) {
                const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
                if (m) { oldLn = parseInt(m[1]) - 1; newLn = parseInt(m[2]) - 1; }
                if (curHunk.length > 0) curFile.hunks.push(curHunk);
                curHunk = [{ type: 'hunk', text: m ? m[0] : line, label: m?.[3]?.trim() }];
                continue;
            }
            if (line.startsWith('+') && !line.startsWith('+++')) {
                newLn++; curFile.added++; curHunk.push({ type: 'add', text: line.substring(1), newLn });
            } else if (line.startsWith('-') && !line.startsWith('---')) {
                oldLn++; curFile.removed++; curHunk.push({ type: 'del', text: line.substring(1), oldLn });
            } else if (line.startsWith(' ')) {
                oldLn++; newLn++; curHunk.push({ type: 'ctx', text: line.substring(1), oldLn, newLn });
            }
        }
        if (curHunk.length > 0) curFile.hunks.push(curHunk);
        if (curFile.name) files.push(curFile);

        // ── Phase 2: Render with collapsed context ──
        let html = '';
        let totalAdded = 0, totalRemoved = 0;

        for (const file of files) {
            totalAdded += file.added;
            totalRemoved += file.removed;
            if (file.added === 0 && file.removed === 0) continue;

            html += `<div class="diff-file-header">📄 ${escapeHtml(file.name)}</div>`;

            for (const hunk of file.hunks) {
                // Find hunk header line
                const hunkLine = hunk.find(l => l.type === 'hunk');
                if (hunkLine) {
                    const m = (hunkLine.text || '').match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
                    if (m) {
                        html += `<div class="diff-hunk"><span class="diff-hunk-marker">@@</span><span class="diff-hunk-loc">${escapeHtml(m[0].replace(/@@.*@@/, '').trim())}</span>${hunkLine.label ? `<span class="diff-hunk-fn">${escapeHtml(hunkLine.label)}</span>` : ''}</div>`;
                    } else {
                        html += `<div class="diff-hunk"><span class="diff-hunk-marker">@@</span>${escapeHtml(hunkLine.text)}</div>`;
                    }
                }

                // Build index of changed positions within this hunk
                const changed = new Set<number>();
                hunk.forEach((l, i) => { if (l.type === 'add' || l.type === 'del') changed.add(i); });

                let lastShown = -1;
                for (let i = 0; i < hunk.length; i++) {
                    const l = hunk[i];
                    if (l.type === 'hunk') continue;

                    const isNearChange = [...changed].some(ci => Math.abs(ci - i) <= CONTEXT_LINES);
                    if (!isNearChange && l.type === 'ctx') {
                        continue; // skip distant context
                    }

                    // Insert "..." gap if we skipped lines
                    if (l.type === 'ctx' && lastShown >= 0 && i - lastShown > 1) {
                        const skipped = i - lastShown - 1;
                        html += `<div class="diff-skip">··· ${skipped} unchanged line${skipped > 1 ? 's' : ''} ···</div>`;
                    }
                    lastShown = i;

                    const esc = escapeHtml(l.text);
                    if (l.type === 'add') {
                        html += `<div class="diff-line diff-add"><span class="diff-ln new">${l.newLn}</span><span class="diff-sign">+</span><span class="diff-text">${esc}</span></div>`;
                    } else if (l.type === 'del') {
                        html += `<div class="diff-line diff-del"><span class="diff-ln old">${l.oldLn}</span><span class="diff-sign">−</span><span class="diff-text">${esc}</span></div>`;
                    } else {
                        html += `<div class="diff-line diff-ctx"><span class="diff-ln old">${l.oldLn}</span><span class="diff-ln new">${l.newLn}</span><span class="diff-sign"> </span><span class="diff-text">${esc}</span></div>`;
                    }
                }
            }

            // Per-file summary
            html += `<div class="diff-file-summary"><span class="diff-stats-add">+${file.added}</span><span class="diff-stats-del">−${file.removed}</span></div>`;
        }

        // Total summary bar at top
        if (totalAdded > 0 || totalRemoved > 0) {
            const label = files.length > 1 ? `${files.length} files` : (files[0]?.name || 'changes');
            html = `<div class="diff-summary"><span class="diff-file-name">${escapeHtml(label)}</span><span class="diff-stats-add">+${totalAdded}</span><span class="diff-stats-del">−${totalRemoved}</span></div>` + html;
        }

        if (truncated) html += `<div class="diff-info">... (truncated, ${txt.length} chars total)</div>`;
        res.innerHTML = html || '<div class="diff-info">No changes</div>';
    },

    // ── Round / Done / Error ──
    handleRoundStart(round: number): void {
        if (round <= 1) return;
        const messagesDiv = document.getElementById('messages')!;
        const mk = createElement('div', 'round-marker');
        mk.innerHTML = `<span>Round ${round}</span>`;
        messagesDiv.appendChild(mk);
    },

    handleDone(): void {
        // Mark all thinking dots as done
        this._markThinkingDone();

        // Collapse all execution details into a drawer, leaving final answer visible below.
        this.compactExecutionDetails();

        store.set('streamingMsg', null);
        store.set('rawHtml', '');
        const messagesDiv = document.getElementById('messages')!;
        smartScroll(messagesDiv);
    },

    compactExecutionDetails(): void {
        const streamingMsg = store.get('streamingMsg');
        if (!streamingMsg || streamingMsg.classList.contains('execution-compacted')) return;

        const detailNodes = Array.from(streamingMsg.children).filter((node) => {
            const el = node as HTMLElement;
            return el.classList.contains('thinking-toggle') ||
                el.classList.contains('thinking-block') ||
                el.classList.contains('tool-line') ||
                el.classList.contains('tool-card') ||
                el.classList.contains('diff-card') ||
                el.classList.contains('workflow-card') ||
                el.classList.contains('round-marker');
        }) as HTMLElement[];

        const finalContent = streamingMsg.querySelector('.md-content') as HTMLElement | null;
        if (detailNodes.length === 0) return;

        const editedFiles = this.collectEditedFiles(streamingMsg);
        const toolCards = detailNodes.filter(el => el.classList.contains('tool-line') || el.classList.contains('tool-card'));
        const thinkingBlocks = detailNodes.filter(el => el.classList.contains('thinking-block'));
        const workflowCards = detailNodes.filter(el => el.classList.contains('workflow-card'));
        const usage = store.get('tokenUsage');
        const totalElapsed = toolCards.reduce((sum, card) => {
            const el = card.querySelector('.tool-time, .tool-card-time, .tool-elapsed');
            const sec = parseFloat(el?.textContent || '0');
            return sum + (isNaN(sec) ? 0 : sec);
        }, 0);

        const drawer = createElement('div', 'execution-drawer');
        const header = createElement('button', 'execution-drawer-header');
        header.type = 'button';
        header.innerHTML =
            `<span class="execution-title">Processed ${this.formatDuration(totalElapsed)}</span>` +
            `<span class="execution-meta">${toolCards.length} tools</span>` +
            (thinkingBlocks.length > 0 ? `<span class="execution-meta">${thinkingBlocks.length} thoughts</span>` : '') +
            (workflowCards.length > 0 ? `<span class="execution-meta">${workflowCards.length} workflows</span>` : '') +
            (usage.calls > 0 ? `<span class="execution-meta">${formatTokenCount(usage.total)} tokens</span>` : '') +
            `<span class="execution-chevron">&rsaquo;</span>`;

        const body = createElement('div', 'execution-drawer-body');
        const details = createElement('div', 'execution-details');
        for (const node of detailNodes) {
            details.appendChild(node);
        }
        body.appendChild(details);
        drawer.appendChild(header);
        drawer.appendChild(body);

        header.addEventListener('click', () => {
            drawer.classList.toggle('open');
        });

        if (finalContent) {
            streamingMsg.insertBefore(drawer, finalContent);
        } else {
            streamingMsg.appendChild(drawer);
        }
        if (editedFiles.length > 0) {
            streamingMsg.appendChild(this.renderEditedFilesSummary(editedFiles));
        }
        streamingMsg.classList.add('execution-compacted');
    },

    formatDuration(seconds: number): string {
        if (!seconds || seconds <= 0) return '';
        if (seconds < 60) return `${seconds.toFixed(1)}s`;
        const m = Math.floor(seconds / 60);
        const s = Math.round(seconds % 60);
        return `${m}m ${s}s`;
    },

    collectEditedFiles(root: HTMLElement): EditedFileInfo[] {
        const map = new Map<string, EditedFileInfo>();
        const nodes = root.querySelectorAll<HTMLElement>('[data-file][data-action]');
        nodes.forEach((node) => {
            const file = node.getAttribute('data-file') || '';
            const action = node.getAttribute('data-action') || 'edit';
            if (!file) return;
            const added = parseInt(node.getAttribute('data-added') || '0', 10) || 0;
            const removed = parseInt(node.getAttribute('data-removed') || '0', 10) || 0;
            const existing = map.get(file);
            if (existing) {
                existing.added += added;
                existing.removed += removed;
                if (existing.action !== action) existing.action = 'edit';
            } else {
                map.set(file, { path: file, action, added, removed });
            }
        });
        return Array.from(map.values()).sort((a, b) => a.path.localeCompare(b.path));
    },

    renderEditedFilesSummary(files: EditedFileInfo[]): HTMLElement {
        const totalAdded = files.reduce((sum, f) => sum + f.added, 0);
        const totalRemoved = files.reduce((sum, f) => sum + f.removed, 0);
        const box = createElement('div', 'edited-files-summary');
        const rows = files.map(f =>
            `<div class="edited-file-row">` +
            `<span class="edited-file-action">${escapeHtml(f.action)}</span>` +
            `<span class="edited-file-path">${escapeHtml(f.path)}</span>` +
            `<span class="edited-file-stats"><span class="diff-stats-add">+${f.added}</span> <span class="diff-stats-del">-${f.removed}</span></span>` +
            `</div>`
        ).join('');
        box.innerHTML =
            `<div class="edited-files-header">Changed Files <span>${files.length} files</span> <span class="diff-stats-add">+${totalAdded}</span> <span class="diff-stats-del">-${totalRemoved}</span></div>` +
            `<div class="edited-files-list">${rows}</div>`;
        return box;
    },

    handleError(error: string): void {
        // Mark thinking as done on error too
        this._markThinkingDone();

        const messagesDiv = document.getElementById('messages')!;
        const err = createElement('div', 'msg-error');
        const errText = createElement('span', 'error-text');
        errText.textContent = error;
        err.appendChild(errText);

        const lastUserMsg = store.get('lastUserMsg');
        if (lastUserMsg) {
            const retryBtn = createElement('button', 'retry-btn');
            retryBtn.textContent = '↻ Retry';
            retryBtn.addEventListener('click', () => {
                const { text, images } = lastUserMsg;
                store.set('lastUserMsg', null);
                vscode.send(text, images);
            });
            err.appendChild(retryBtn);
        }

        messagesDiv.appendChild(err);
        smartScroll(messagesDiv);
        store.set('streamingMsg', null);
        store.set('rawHtml', '');
    },

    // ── Token usage per call ──
    handleTokenUsage(usage: { promptTokens: number; completionTokens: number; totalTokens: number }): void {
        // Update store
        const prev = store.get('tokenUsage');
        store.set('tokenUsage', {
            prompt: prev.prompt + usage.promptTokens,
            completion: prev.completion + usage.completionTokens,
            total: prev.total + usage.totalTokens,
            calls: prev.calls + 1,
        });

        // Update status bar with running total
        const total = store.get('tokenUsage').total;
        const statusEl = document.getElementById('token-counter');
        if (statusEl) {
            statusEl.textContent = formatTokenCount(total);
            statusEl.style.display = '';
        }
    },

    // ── Conversation usage summary ──
    handleConversationUsage(usage: { totalTokens: number; callCount: number }): void {
        // Update the token counter with final conversation total
        const statusEl = document.getElementById('token-counter');
        if (statusEl) {
            statusEl.textContent = formatTokenCount(usage.totalTokens);
            statusEl.style.display = '';
        }
    },

    // ── Workflow rendering ──
    handleWorkflowStart(totalPhases: number, totalTasks: number): void {
        const messagesDiv = document.getElementById('messages')!;
        const card = createElement('div', 'workflow-card');
        card.setAttribute('data-phase-count', String(totalPhases));
        card.innerHTML = `<div class="workflow-header">` +
            `<div class="workflow-title">⚡ Workflow <span class="workflow-progress">0/${totalTasks} tasks</span></div>` +
            `</div><div class="workflow-phases"></div>`;
        messagesDiv.appendChild(card);
        this.makeCardCollapsible(card, '.tool-header', false);
        smartScroll(messagesDiv);
    },

    handleWorkflowPhaseStart(phaseIndex: number, title: string, mode: string, taskCount: number): void {
        const card = document.querySelector('.workflow-card:last-of-type');
        if (!card) return;
        const phasesDiv = card.querySelector('.workflow-phases');
        if (!phasesDiv) return;

        const modeIcon = mode === 'parallel' ? '⚡' : '➡';
        const phaseDiv = createElement('div', 'workflow-phase');
        phaseDiv.setAttribute('data-phase', String(phaseIndex));
        phaseDiv.innerHTML = `<div class="workflow-phase-header">` +
            `<span class="workflow-phase-icon">${modeIcon}</span>` +
            `<span class="workflow-phase-title">Phase ${phaseIndex + 1}: ${escapeHtml(title)}</span>` +
            `<span class="workflow-phase-mode">${mode}</span>` +
            `<span class="workflow-phase-status">running...</span>` +
            `</div><div class="workflow-tasks"></div>`;
        phasesDiv.appendChild(phaseDiv);
        card.classList.add('expanded');
        const messagesDiv = document.getElementById('messages')!;
        smartScroll(messagesDiv);
    },

    handleWorkflowTaskStart(phaseIndex: number, taskIndex: number, label: string): void {
        const phaseDiv = document.querySelector(`.workflow-phase[data-phase="${phaseIndex}"]`);
        if (!phaseDiv) return;
        const tasksDiv = phaseDiv.querySelector('.workflow-tasks');
        if (!tasksDiv) return;

        const taskDiv = createElement('div', 'workflow-task');
        taskDiv.setAttribute('data-task', `${phaseIndex}-${taskIndex}`);
        taskDiv.innerHTML = `<span class="workflow-task-status">⏳</span>` +
            `<span class="workflow-task-label">${escapeHtml(label)}</span>` +
            `<span class="workflow-task-time"></span>`;
        tasksDiv.appendChild(taskDiv);
        const messagesDiv = document.getElementById('messages')!;
        smartScroll(messagesDiv);
    },

    handleWorkflowTaskEnd(phaseIndex: number, taskIndex: number, result: any): void {
        const taskDiv = document.querySelector(`.workflow-task[data-task="${phaseIndex}-${taskIndex}"]`);
        if (!taskDiv) return;

        const status = result.error ? '❌' : '✅';
        const statusEl = taskDiv.querySelector('.workflow-task-status');
        if (statusEl) statusEl.textContent = status;
        const timeEl = taskDiv.querySelector('.workflow-task-time');
        if (timeEl) timeEl.textContent = `${(result.elapsed / 1000).toFixed(1)}s · ${result.toolCalls} tools`;

        if (result.error) taskDiv.classList.add('task-error');

        // Update global progress counter
        const card = document.querySelector('.workflow-card:last-of-type');
        if (card) {
            const done = card.querySelectorAll('.workflow-task .workflow-task-status').length;
            const total = parseInt(card.getAttribute('data-task-count') || '0');
            if (total > 0) {
                const progressEl = card.querySelector('.workflow-progress');
                if (progressEl) progressEl.textContent = `${done}/${total} tasks`;
            }
        }

        const messagesDiv = document.getElementById('messages')!;
        smartScroll(messagesDiv);
    },

    handleWorkflowPhaseEnd(phaseIndex: number, _result: any): void {
        const phaseDiv = document.querySelector(`.workflow-phase[data-phase="${phaseIndex}"]`);
        if (!phaseDiv) return;
        const statusEl = phaseDiv.querySelector('.workflow-phase-status');
        if (statusEl) statusEl.textContent = '✅ done';
        phaseDiv.classList.add('phase-done');
    },

    handleWorkflowEnd(result: any): void {
        const card = document.querySelector('.workflow-card:last-of-type');
        if (!card) return;

        const totalTasks = result.phases.reduce((s: number, p: any) => s + p.results.length, 0);
        card.setAttribute('data-task-count', String(totalTasks));

        const progressEl = card.querySelector('.workflow-progress');
        if (progressEl) progressEl.textContent = `${totalTasks} tasks · ${result.totalToolCalls} tools · ${(result.elapsed / 1000).toFixed(1)}s`;

        card.classList.add('expanded');
        const messagesDiv = document.getElementById('messages')!;
        smartScroll(messagesDiv);
    },

    // ── Edit preview with Accept/Reject ──
    renderEditPreviewCard(previewId: string, filePath: string, oldText: string, newText: string, matchCount: number): void {
        const messagesDiv = document.getElementById('messages')!;
        const card = createElement('div', 'tool-card edit-preview-card expanded');
        card.setAttribute('data-status', 'running');
        card.setAttribute('data-tool', 'edit_file');
        card.setAttribute('data-file', filePath);
        card.setAttribute('data-action', 'edit');

        // Build diff HTML
        const oldLines = oldText.split('\n');
        const newLines = newText.split('\n');
        card.setAttribute('data-added', String(newLines.length));
        card.setAttribute('data-removed', String(oldLines.length));
        let diffHtml = `<div class="diff-header-line"><span class="diff-stats">-${oldLines.length} +${newLines.length}</span><span class="diff-match">${matchCount} match(es)</span></div>`;
        const maxShow = Math.max(oldLines.length, newLines.length, 8);
        for (const line of oldLines.slice(0, maxShow)) {
            diffHtml += `<div class="diff-line"><span class="diff-ln">-</span><span class="diff-del">- ${escapeHtml(line).substring(0, 120)}</span></div>`;
        }
        if (oldLines.length > maxShow) diffHtml += `<div class="diff-line"><span class="diff-ln">...</span><span class="diff-info">+${oldLines.length - maxShow} more lines</span></div>`;
        for (const line of newLines.slice(0, maxShow)) {
            diffHtml += `<div class="diff-line"><span class="diff-ln">+</span><span class="diff-add">+ ${escapeHtml(line).substring(0, 120)}</span></div>`;
        }
        if (newLines.length > maxShow) diffHtml += `<div class="diff-line"><span class="diff-ln">...</span><span class="diff-info">+${newLines.length - maxShow} more lines</span></div>`;

        card.innerHTML = `<div class="tool-header">` +
            `<div class="tool-icon-wrapper"><div class="tool-icon">E</div><div class="tool-status-dot"></div></div>` +
            `<div class="tool-info"><span class="tool-name">edit_file</span><span class="tool-args">${escapeHtml(filePath)}</span></div>` +
            `<div class="tool-meta"><span class="tool-elapsed">⏳</span><span class="tool-chevron">▸</span></div>` +
            `</div><div class="tool-body"><div class="tool-result">${diffHtml}</div>` +
            `<div class="edit-preview-actions"><button class="edit-accept-btn">✓ Accept</button><button class="edit-reject-btn">✗ Reject</button></div></div>`;

        // Button handlers
        const acceptBtn = card.querySelector('.edit-accept-btn');
        if (acceptBtn) acceptBtn.addEventListener('click', () => {
            vscode.editConfirm(previewId);
            card.setAttribute('data-status', 'success');
            const dot = card.querySelector('.tool-status-dot') as HTMLElement;
            if (dot) dot.style.background = 'var(--vscode-testing-iconPassed, #4ec9b0)';
            const elapsed = card.querySelector('.tool-elapsed') as HTMLElement;
            if (elapsed) elapsed.textContent = '✓ Applied';
            const actions = card.querySelector('.edit-preview-actions') as HTMLElement;
            if (actions) actions.remove();
            card.classList.add('collapsed');
        });

        const rejectBtn = card.querySelector('.edit-reject-btn');
        if (rejectBtn) rejectBtn.addEventListener('click', () => {
            vscode.editReject(previewId);
            card.setAttribute('data-status', 'error');
            card.classList.add('tool-error');
            const dot = card.querySelector('.tool-status-dot') as HTMLElement;
            if (dot) dot.style.background = 'var(--vscode-testing-iconFailed, #f44747)';
            const elapsed = card.querySelector('.tool-elapsed') as HTMLElement;
            if (elapsed) elapsed.textContent = '✗ Rejected';
            const actions = card.querySelector('.edit-preview-actions') as HTMLElement;
            if (actions) actions.remove();
            card.classList.add('collapsed');
        });

        messagesDiv.appendChild(card);
        this.makeCardCollapsible(card, '.tool-header', false);
        smartScroll(messagesDiv);
    },

    renderWritePreviewCard(previewId: string, filePath: string, content: string, isCreate: boolean): void {
        const messagesDiv = document.getElementById('messages')!;
        const card = createElement('div', 'tool-card write-preview-card expanded');
        card.setAttribute('data-status', 'running');
        card.setAttribute('data-tool', 'write_file');
        card.setAttribute('data-file', filePath);
        card.setAttribute('data-action', isCreate ? 'create' : 'write');

        // Build content preview
        const lines = content.split('\n');
        card.setAttribute('data-added', String(lines.length));
        card.setAttribute('data-removed', '0');
        const maxShow = Math.min(lines.length, 15);
        let contentHtml = '';
        for (const line of lines.slice(0, maxShow)) {
            contentHtml += `<div class="diff-line"><span class="diff-add">${escapeHtml(line).substring(0, 120)}</span></div>`;
        }
        if (lines.length > maxShow) {
            contentHtml += `<div class="diff-line"><span class="diff-info">... +${lines.length - maxShow} more lines</span></div>`;
        }

        const actionLabel = isCreate ? '创建文件' : '覆盖文件';
        const icon = isCreate ? '📄' : '⚠️';

        card.innerHTML = `<div class="tool-header">` +
            `<div class="tool-icon-wrapper"><div class="tool-icon">W</div><div class="tool-status-dot"></div></div>` +
            `<div class="tool-info"><span class="tool-name">${icon} write_file — ${actionLabel}</span><span class="tool-args">${escapeHtml(filePath)} (${lines.length} lines)</span></div>` +
            `<div class="tool-meta"><span class="tool-elapsed">⏳</span><span class="tool-chevron">▸</span></div>` +
            `</div><div class="tool-body"><div class="tool-result">${contentHtml}</div>` +
            `<div class="edit-preview-actions">` +
            `<button class="edit-accept-btn">✓ 确认写入</button>` +
            `<button class="edit-reject-btn">✗ 拒绝</button>` +
            `</div></div>`;

        // Button handlers
        const writeAcceptBtn = card.querySelector('.edit-accept-btn');
        if (writeAcceptBtn) writeAcceptBtn.addEventListener('click', () => {
            vscode.writeConfirm(previewId);
            card.setAttribute('data-status', 'success');
            const dot = card.querySelector('.tool-status-dot') as HTMLElement;
            if (dot) dot.style.background = 'var(--vscode-testing-iconPassed, #4ec9b0)';
            const elapsed = card.querySelector('.tool-elapsed') as HTMLElement;
            if (elapsed) elapsed.textContent = '✓ 已写入';
            const actions = card.querySelector('.edit-preview-actions') as HTMLElement;
            if (actions) actions.remove();
            card.classList.add('collapsed');
        });

        const writeRejectBtn = card.querySelector('.edit-reject-btn');
        if (writeRejectBtn) writeRejectBtn.addEventListener('click', () => {
            vscode.writeReject(previewId);
            card.setAttribute('data-status', 'error');
            card.classList.add('tool-error');
            const dot = card.querySelector('.tool-status-dot') as HTMLElement;
            if (dot) dot.style.background = 'var(--vscode-testing-iconFailed, #f44747)';
            const elapsed = card.querySelector('.tool-elapsed') as HTMLElement;
            if (elapsed) elapsed.textContent = '✗ 已拒绝';
            const actions = card.querySelector('.edit-preview-actions') as HTMLElement;
            if (actions) actions.remove();
            card.classList.add('collapsed');
        });

        messagesDiv.appendChild(card);
        smartScroll(messagesDiv);
    },

    // ── System message ──
    addSystemMessage(text: string): void {
        const messagesDiv = document.getElementById('messages')!;
        const sys = createElement('div', 'msg msg-system');
        sys.textContent = text;
        messagesDiv.appendChild(sys);
        smartScroll(messagesDiv);
    },

    // ── Welcome screen i18n update ──
    updateWelcome(descOrSeed: string, hint?: string): void {
        const welcomeDesc = document.querySelector('.welcome-desc');
        const welcomeHint = document.querySelector('.welcome-hint');
        if (!hint && welcomeDesc) {
            // Seed-based: pick variant from i18n
            const { desc, hint: h } = getWelcomePair(descOrSeed);
            if (welcomeDesc) welcomeDesc.innerHTML = desc;
            if (welcomeHint) welcomeHint.innerHTML = h;
        } else if (welcomeDesc && hint) {
            welcomeDesc.innerHTML = descOrSeed;
            if (welcomeHint) welcomeHint.innerHTML = hint;
        }
    },

    // ── Plan Mode: Confirm/Reject ──

    makeCardCollapsible(card: HTMLElement, headerSelector: string, collapsed = false): void {
        const header = card.querySelector(headerSelector) as HTMLElement | null;
        if (!header) return;
        header.setAttribute('role', 'button');
        header.setAttribute('tabindex', '0');
        header.classList.add('collapsible-card-header');
        const toggle = createElement('button', 'inline-collapse-toggle');
        toggle.type = 'button';
        toggle.textContent = collapsed ? 'Show' : 'Hide';
        header.appendChild(toggle);

        const setCollapsed = (value: boolean) => {
            card.classList.toggle('collapsed', value);
            toggle.textContent = value ? 'Show' : 'Hide';
        };
        setCollapsed(collapsed);

        const onToggle = (e: Event) => {
            e.preventDefault();
            e.stopPropagation();
            setCollapsed(!card.classList.contains('collapsed'));
        };
        toggle.addEventListener('click', onToggle);
        header.addEventListener('dblclick', onToggle);
        header.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') onToggle(e);
        });
    },

    showPlanConfirm(planContent?: string, planPath?: string): void {
        const messagesDiv = document.getElementById('messages')!;
        const card = createElement('div', 'plan-confirm-card');

        card.innerHTML = `
            <div class="plan-confirm-header">📋 计划已就绪</div>
            <div class="plan-confirm-desc">计划已生成，请在右侧编辑器中阅读后确认。</div>
            <div class="plan-confirm-actions-row">
                <button class="plan-confirm-btn plan-open-btn" id="plan-open-btn">📄 在编辑器中打开</button>
            </div>
            <div class="plan-confirm-modify">
                <input type="text" class="plan-modify-input" id="plan-modify-input" placeholder="修改建议（可选）：如'增加测试步骤'、'简化方案'" />
            </div>
            <div class="plan-confirm-actions">
                <button class="plan-confirm-btn plan-accept-btn" id="plan-accept-btn">✅ 确认执行</button>
                <button class="plan-confirm-btn plan-modify-btn" id="plan-modify-btn">📝 修改后执行</button>
                <button class="plan-confirm-btn plan-reject-btn" id="plan-reject-btn">❌ 重新规划</button>
            </div>
        `;
        messagesDiv.appendChild(card);
        this.makeCardCollapsible(card, '.plan-confirm-header', false);
        smartScroll(messagesDiv);

        // Wire up buttons
        const openBtn = card.querySelector('#plan-open-btn') as HTMLButtonElement;
        const acceptBtn = card.querySelector('#plan-accept-btn') as HTMLButtonElement;
        const rejectBtn = card.querySelector('#plan-reject-btn') as HTMLButtonElement;
        const modifyBtn = card.querySelector('#plan-modify-btn') as HTMLButtonElement;
        const modifyInput = card.querySelector('#plan-modify-input') as HTMLInputElement;

        // Open plan in split editor
        if (planPath) {
            openBtn.addEventListener('click', () => {
                vscode.openFileBeside(planPath);
                openBtn.textContent = '📄 已打开';
                openBtn.disabled = true;
            });
            // Auto-open on first show
            vscode.openFileBeside(planPath);
            openBtn.textContent = '📄 已打开';
            openBtn.disabled = true;
        } else {
            openBtn.style.display = 'none';
        }

        const disableAll = () => {
            acceptBtn.disabled = true;
            rejectBtn.disabled = true;
            modifyBtn.disabled = true;
            modifyInput.disabled = true;
            card.classList.add('plan-decided');
            card.classList.add('collapsed');
        };

        acceptBtn.addEventListener('click', () => {
            disableAll();
            acceptBtn.textContent = '✅ 已确认，执行中...';
            vscode.post({ type: 'planConfirm' });
        });

        rejectBtn.addEventListener('click', () => {
            disableAll();
            rejectBtn.textContent = '❌ 已拒绝';
            vscode.post({ type: 'planReject' });
        });

        modifyBtn.addEventListener('click', () => {
            const feedback = modifyInput.value.trim();
            if (!feedback) {
                modifyInput.focus();
                modifyInput.placeholder = '请输入修改建议后点击此按钮';
                return;
            }
            disableAll();
            modifyBtn.textContent = '📝 修改中...';
            vscode.post({ type: 'planModify', feedback });
        });

        // Allow Enter key to submit modification
        modifyInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !modifyBtn.disabled) {
                modifyBtn.click();
            }
        });
    },

    // ── Ask User: Interactive Dialog ──

    renderAskUserCard(previewId: string, question: string, options: string[]): void {
        const messagesDiv = document.getElementById('messages')!;
        const card = createElement('div', 'ask-user-card');

        card.innerHTML = `
            <div class="ask-user-header">❓ 需要你的确认</div>
            <div class="ask-user-question">${escapeHtml(question)}</div>
            <div class="ask-user-options">${options.map(opt =>
                `<button class="ask-user-option-btn" data-answer="${escapeHtml(opt)}">${escapeHtml(opt)}</button>`
            ).join('')}<button class="ask-user-option-btn ask-user-other-btn" data-other="true">${t('ask.other')}</button></div>
            <div class="ask-user-other-input" id="ask-user-other-${previewId}" style="display:none">
                <input type="text" class="ask-user-input" id="ask-user-input-${previewId}" placeholder="请输入你的回答..." />
                <button class="ask-user-submit-btn" id="ask-user-submit-${previewId}">✓</button>
            </div>
            <div class="ask-user-status" id="ask-user-status-${previewId}"></div>
        `;
        messagesDiv.appendChild(card);
        smartScroll(messagesDiv);

        this.makeCardCollapsible(card, '.ask-user-header', false);
        const statusEl = card.querySelector(`#ask-user-status-${previewId}`) as HTMLElement;
        const otherInput = card.querySelector(`#ask-user-other-${previewId}`) as HTMLElement;
        const input = card.querySelector(`#ask-user-input-${previewId}`) as HTMLInputElement;
        const submitBtn = card.querySelector(`#ask-user-submit-${previewId}`) as HTMLButtonElement;

        const submitAnswer = (answer: string) => {
            if (!answer.trim()) return;
            card.querySelectorAll('button').forEach(b => (b as HTMLButtonElement).disabled = true);
            if (input) input.disabled = true;
            statusEl.textContent = `✅ 你的回答：${answer}`;
            card.classList.add('ask-user-answered');
            card.classList.add('collapsed');
            vscode.askUserConfirm(previewId, answer);
        };

        // Wire up option buttons
        card.querySelectorAll('.ask-user-option-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.getAttribute('data-other') === 'true') {
                    // Show inline input for "其他"
                    otherInput.style.display = 'flex';
                    input.focus();
                } else {
                    submitAnswer(btn.getAttribute('data-answer') || '');
                }
            });
        });

        // Wire up submit button + Enter key
        submitBtn.addEventListener('click', () => submitAnswer(input.value));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submitAnswer(input.value);
        });
    },

    // ── Adversarial Mode: 疯狂程序猿 vs 超级产品经理 ──

    _currentAdversarialPersona: null as string | null,
    _currentAdversarialBlock: null as HTMLElement | null,
    _currentAdversarialContent: null as HTMLElement | null,
    _adversarialAccumText: '' as string,

    handleAdversarialTurn(persona: string, name: string, icon: string, phase: string, content: string, iteration: number): void {
        const messagesDiv = document.getElementById('messages')!;

        // If persona changed, create a new turn block
        if (this._currentAdversarialPersona !== persona) {
            // Finalize previous block's markdown render
            if (this._currentAdversarialContent && this._adversarialAccumText) {
                this._currentAdversarialContent.innerHTML = this._renderAdversarialMarkdown(this._adversarialAccumText);
            }
            if (this._currentAdversarialBlock) {
                this._currentAdversarialBlock.classList.add('collapsed');
            }

            this._currentAdversarialPersona = persona;
            this._adversarialAccumText = '';

            // Create adversarial turn container
            const turn = createElement('div', `adversarial-turn persona-${persona}`);
            turn.setAttribute('data-persona', persona);
            turn.setAttribute('data-iteration', String(iteration));

            // Header with avatar, name, and phase
            const header = createElement('div', 'adversarial-header');
            const avatar = createElement('span', 'adversarial-avatar');
            avatar.textContent = icon;
            avatar.style.cssText = persona === 'programmer'
                ? 'background:rgba(255,105,0,.15);color:#FF6900'
                : 'background:rgba(33,150,243,.15);color:#2196F3';
            const nameEl = createElement('span', 'adversarial-name');
            nameEl.textContent = name;
            nameEl.style.color = persona === 'programmer' ? '#FF6900' : '#2196F3';
            const phaseEl = createElement('span', 'adversarial-phase');
            phaseEl.textContent = phase === 'speak' ? '正在编码...' : phase === 'review' ? '正在审查...' : phase === 'verdict' ? '裁决' : '';
            header.appendChild(avatar);
            header.appendChild(nameEl);
            const roundEl = createElement('span', 'adversarial-round');
            roundEl.textContent = `#${iteration}`;
            header.appendChild(roundEl);
            header.appendChild(phaseEl);

            // Body for content
            const body = createElement('div', 'adversarial-body md-content');

            turn.appendChild(header);
            turn.appendChild(body);
            messagesDiv.appendChild(turn);
            this.makeCardCollapsible(turn, '.adversarial-header', false);

            this._currentAdversarialBlock = turn;
            this._currentAdversarialContent = body;

            // Remove spinner from any existing assistant message
            const spinners = messagesDiv.querySelectorAll('.spinner');
            spinners.forEach(s => s.remove());
        }

        // Accumulate text and render
        this._adversarialAccumText += content;

        // Update phase text if it changed
        const phaseEl = this._currentAdversarialBlock?.querySelector('.adversarial-phase');
        if (phaseEl) {
            const phaseText = phase === 'speak' ? '正在编码...' : phase === 'review' ? '正在审查...' : phase === 'verdict' ? '裁决' : '';
            (phaseEl as HTMLElement).textContent = phaseText;
        }

        // For verdict phase, render the full content as markdown
        if (phase === 'verdict' && this._currentAdversarialContent) {
            this._currentAdversarialContent.innerHTML = this._renderAdversarialMarkdown(this._adversarialAccumText);
            // Reset for next round
            this._currentAdversarialPersona = null;
            this._currentAdversarialContent = null;
            this._currentAdversarialBlock = null;
            this._adversarialAccumText = '';
        }

        smartScroll(messagesDiv);
    },

    handleAdversarialToolStart(persona: string, toolName: string, args: any): void {
        // Add tool card inside the current adversarial block
        const block = this._currentAdversarialBlock;
        if (!block) return;

        let toolsContainer = block.querySelector('.adversarial-tools') as HTMLElement;
        if (!toolsContainer) {
            toolsContainer = createElement('div', `adversarial-tools persona-${persona}`);
            block.appendChild(toolsContainer);
        }

        const summary = toolSummary(toolName, args);
        const icon = toolIcon(toolName);
        const line = createElement('div', 'tool-line');
        line.setAttribute('data-status', 'running');
        line.setAttribute('data-tool', toolName);

        const label = createElement('span', 'tool-label');
        label.textContent = icon;
        label.style.color = persona === 'programmer' ? '#FF6900' : '#2196F3';
        const pathEl = createElement('span', 'tool-path');
        pathEl.textContent = summary;
        const time = createElement('span', 'tool-time');
        time.textContent = '...';

        line.appendChild(label);
        line.appendChild(pathEl);
        line.appendChild(time);
        toolsContainer.appendChild(line);

        const messagesDiv = document.getElementById('messages')!;
        smartScroll(messagesDiv);
    },

    handleAdversarialToolEnd(persona: string, toolName: string, result: string, isError: boolean, elapsed: number): void {
        const block = this._currentAdversarialBlock;
        if (!block) return;

        const toolsContainer = block.querySelector('.adversarial-tools');
        if (!toolsContainer) return;

        // Find the last running tool-line for this tool
        const lines = toolsContainer.querySelectorAll('.tool-line[data-status="running"]');
        const line = lines[lines.length - 1] as HTMLElement;
        if (!line) return;

        line.setAttribute('data-status', isError ? 'error' : 'success');
        const timeEl = line.querySelector('.tool-time');
        if (timeEl) timeEl.textContent = elapsed < 1 ? `${(elapsed * 1000).toFixed(0)}ms` : `${elapsed.toFixed(1)}s`;

        // Show brief output for commands
        if (toolName === 'execute_command' && result && !isError) {
            const output = createElement('div', 'tool-output');
            output.textContent = result.length > 200 ? result.substring(0, 200) + '...' : result;
            line.appendChild(output);
        }
    },

    /** Improved markdown rendering for adversarial content */
    _renderAdversarialMarkdown(text: string): string {
        if (!text) return '';
        let html = escapeHtml(text);

        // Code blocks (preserve first, before other rules)
        const codeBlocks: string[] = [];
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
            const idx = codeBlocks.length;
            codeBlocks.push(`<div class="code-block"><div class="code-header"><span>${lang || 'code'}</span><button class="copy-btn">Copy</button></div><pre><code>${code}</code></pre></div>`);
            return `\n__CODE_${idx}__\n`;
        });

        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Headers
        html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
        html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
        html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');

        // Bold
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

        // Tables: lines starting with |
        html = html.replace(/((?:^\|.+\|?\n?)+)/gm, (_m: string, block: string) => {
            const lines = block.trim().split('\n');
            if (lines.length < 2) return block;
            const rows: string[][] = [];
            for (const line of lines) {
                const cells = line.split('|').map((c: string) => c.trim()).filter((c: string) => c !== '');
                if (cells.length > 0) rows.push(cells);
            }
            if (rows.length < 2) return block;
            const header = rows[0];
            let table = '<table><thead><tr>';
            for (const h of header) table += `<th>${h}</th>`;
            table += '</tr></thead><tbody>';
            for (let i = 1; i < rows.length; i++) {
                if (rows[i].every((c: string) => /^[-:\s|]+$/.test(c))) continue;
                table += '<tr>';
                for (let j = 0; j < header.length; j++) {
                    table += `<td>${rows[i][j] || ''}</td>`;
                }
                table += '</tr>';
            }
            table += '</tbody></table>';
            return '\n' + table + '\n';
        });

        // Unordered list items
        html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
        html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

        // Ordered list items
        html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
        html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, (match) => {
            // Only wrap in <ol> if not already wrapped in <ul> (avoid double-wrapping)
            if (match.includes('<ul>')) return match;
            return `<ol>${match}</ol>`;
        });

        // Line breaks — collapse 3+ consecutive newlines into a single <br> to reduce excessive blank lines
        html = html.replace(/\n{3,}/g, '\n\n');
        html = html.replace(/\n/g, '<br>');

        // Restore code blocks
        codeBlocks.forEach((block, i) => {
            html = html.replace(`__CODE_${i}__`, block);
        });

        return html;
    },

    // ── Message Queue ──

    showQueuedMessage(text: string, queueLength: number): void {
        const messagesDiv = document.getElementById('messages')!;
        let container = messagesDiv.querySelector('.msg-queue-container') as HTMLElement;

        // Create container if not exists
        if (!container) {
            container = createElement('div', 'msg msg-queue-container');
            const header = createElement('div', 'msg-queue-header');
            header.innerHTML = `<span class="queue-icon">⏳</span><span class="queue-title">排队中</span>`;
            container.appendChild(header);
            const list = createElement('div', 'msg-queue-list');
            container.appendChild(list);
            messagesDiv.appendChild(container);
        }

        // Add item to list
        const list = container.querySelector('.msg-queue-list')!;
        const idx = list.children.length;
        const item = createElement('div', 'msg-queue-item');
        item.innerHTML = `<span class="queue-item-num">#${idx + 1}</span>` +
            `<span class="queue-item-text">${escapeHtml(text.length > 80 ? text.substring(0, 80) + '...' : text)}</span>` +
            `<button class="queue-item-del" title="移除">✕</button>`;
        // Delete button handler
        item.querySelector('.queue-item-del')!.addEventListener('click', () => {
            // Remove from store
            const queued = store.get('queuedMsgs');
            if (idx < queued.length) {
                store.set('queuedMsgs', queued.filter((_: any, i: number) => i !== idx));
            }
            item.remove();
            // Re-number remaining items
            const items = list.querySelectorAll('.msg-queue-item');
            for (let i = 0; i < items.length; i++) {
                const num = items[i].querySelector('.queue-item-num');
                if (num) num.textContent = `#${i + 1}`;
            }
            // Remove container if empty
            if (items.length === 0) container.remove();
        });
        list.appendChild(item);
        smartScroll(messagesDiv);
    },

    updateQueueDisplay(remaining: number): void {
        const messagesDiv = document.getElementById('messages')!;
        const container = messagesDiv.querySelector('.msg-queue-container');
        if (!container) return;
        if (remaining === 0) {
            container.remove();
        } else {
            const title = container.querySelector('.queue-title');
            if (title) title.textContent = `排队中 (${remaining})`;
            // Remove first item (it was just processed)
            const list = container.querySelector('.msg-queue-list');
            if (list && list.children.length > 0) {
                list.children[0].remove();
                // Re-number
                const items = list.querySelectorAll('.msg-queue-item');
                for (let i = 0; i < items.length; i++) {
                    const num = items[i].querySelector('.queue-item-num');
                    if (num) num.textContent = `#${i + 1}`;
                }
            }
            if (remaining === 0) container.remove();
        }
    },

    clearQueueDisplay(): void {
        const messagesDiv = document.getElementById('messages')!;
        const container = messagesDiv.querySelector('.msg-queue-container');
        if (container) container.remove();
    },

    // ── Clear ──
    clearMessages(): void {
        const messagesDiv = document.getElementById('messages')!;
        Array.from(messagesDiv.children).forEach(child => {
            if (!(child as HTMLElement).classList.contains('sticky-user-preview')) child.remove();
        });
        const stickyPrompt = messagesDiv.querySelector('.sticky-user-preview') as HTMLElement | null;
        if (stickyPrompt) {
            stickyPrompt.classList.add('hidden');
            stickyPrompt.replaceChildren();
        }
        messagesDiv.style.removeProperty('--sticky-user-height');
        store.set('tokenUsage', { prompt: 0, completion: 0, total: 0, calls: 0 });
        const statusEl = document.getElementById('token-counter');
        if (statusEl) { statusEl.textContent = ''; statusEl.style.display = 'none'; }
    },

    // ── Helpers ──
    createAssistantMsg(): HTMLElement {
        const messagesDiv = document.getElementById('messages')!;
        const div = createElement('div', 'msg msg-assistant');
        const sp = createElement('span', 'spinner');
        div.appendChild(sp);
        messagesDiv.appendChild(div);
        smartScroll(messagesDiv);
        return div;
    },
};
