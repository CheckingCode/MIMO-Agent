/**
 * Intent Router - pre-classifies user input before the main agent loop.
 */

import { MiMoAPI } from './api';

export type IntentCategory =
    | 'greeting'
    | 'question'
    | 'code_task'
    | 'explanation'
    | 'refactor'
    | 'debug'
    | 'search'
    | 'review'
    | 'config'
    | 'creative'
    | 'multi_step';

export interface IntentResult {
    needsTools: boolean;
    category: IntentCategory;
    plan: string;
    complexity?: 'simple' | 'moderate' | 'complex';
    suggestedPersona?: string | null;
    source?: 'heuristic' | 'model';
}

const ROUTER_PROMPT = `You are an intent classifier for a coding assistant.
Respond with ONLY a JSON object:
{
  "needsTools": true/false,
  "category": "greeting|question|code_task|explanation|refactor|debug|search|review|config|creative|multi_step",
  "plan": "brief description of what to do",
  "complexity": "simple|moderate|complex",
  "suggestedPersona": "programmer|pm|reviewer|architect|debugger|summarizer|analyst|null"
}

Rules:
- Greetings or acknowledgements -> greeting, needsTools=false
- Pure questions -> question, needsTools=false
- Code changes or implementation -> code_task, needsTools=true
- Explain code -> explanation, needsTools=false
- Refactor / optimization -> refactor, needsTools=true
- Bug / crash / error -> debug, needsTools=true
- Search / research / latest -> search, needsTools=true
- Review / audit / security -> review, needsTools=true
- Config / setup / environment -> config, needsTools=true
- Brainstorm / design-only -> creative, needsTools=false
- Multi-step task -> multi_step, needsTools=true

Respond with ONLY the JSON object.`;

const QUICK_GREETINGS = new Set([
    'hi', 'hello', 'hey', 'ok', 'okay', 'thanks', 'thank you', 'thx',
    '你好', '嗨', '哈喽', '好的', '收到', '谢谢',
]);

function looksLikeSimpleQuestion(text: string): boolean {
    const trimmed = text.trim();
    if (/(diff|git|staged|cached|暂存|变更|改动|文件|卡片|VS\s*Code|vscode|MIMO|MiMo|扩展|插件|\.html?|\.tsx?|\.jsx?|\.ts|\.js|\.py|\.json|\.md)/i.test(trimmed)) {
        return false;
    }
    return /^(what|why|how|can|could|is|are|do|does|will|would)\b/i.test(trimmed)
        || /^(什么是|为什么|怎么|如何|能否|可不可以|有没有|是不是|是否)/.test(trimmed)
        || (trimmed.length <= 80 && /[?？]$/.test(trimmed));
}

function includesAny(text: string, needles: string[]): boolean {
    const lower = text.toLowerCase();
    return needles.some(needle => lower.includes(needle.toLowerCase()));
}

function classifyLocalWorkspaceTask(text: string): IntentResult | null {
    const hasLocalPath = /[A-Za-z]:[\\/]|(?:^|[\s"'`])\.{1,2}[\\/]|[\\/][^\\/]+[\\/]/.test(text);
    const hasLocalTarget = hasLocalPath || includesAny(text, [
        'ppt', '.ppt', '.pptx', '.pdf', '.doc', '.docx', '.xls', '.xlsx',
        '\u76ee\u5f55', '\u6587\u4ef6\u5939', '\u6587\u4ef6', '\u9879\u76ee', '\u5f00\u9898',
    ]);
    const hasAction = includesAny(text, [
        '\u5e2e\u6211', '\u6839\u636e', '\u8bfb\u53d6', '\u67e5\u770b', '\u770b\u770b',
        '\u627e', '\u641c\u7d22', '\u5199', '\u751f\u6210', '\u6574\u7406',
        '\u521b\u5efa', '\u5236\u4f5c', '\u505a\u4e00\u4e2a', '\u6c47\u62a5\u7a3f',
        '\u62a5\u544a', '\u6587\u6863', '\u603b\u7ed3',
        'search', 'find', 'read', 'write', 'generate', 'create', 'summarize',
    ]);

    if (!hasLocalTarget || !hasAction) return null;

    return {
        needsTools: true,
        category: 'multi_step',
        plan: 'Inspect the referenced local files or directories before producing the requested output',
        complexity: 'complex',
        suggestedPersona: 'analyst',
        source: 'heuristic',
    };
}

const QUICK_DIRECT_PATTERNS: Array<{ pattern: RegExp; result: IntentResult }> = [
    {
        pattern: /(解释这段代码|这段代码什么意思|explain this code|what does this code do)/i,
        result: { needsTools: false, category: 'explanation', plan: 'Explain the referenced code or concept', complexity: 'simple', suggestedPersona: null, source: 'heuristic' },
    },
    {
        pattern: /(头脑风暴|方案设计|brainstorm|design ideas|architecture ideas)/i,
        result: { needsTools: false, category: 'creative', plan: 'Brainstorm without tools first', complexity: 'moderate', suggestedPersona: 'architect', source: 'heuristic' },
    },
];

const QUICK_TOOL_PATTERNS: Array<{ pattern: RegExp; result: IntentResult }> = [
    {
        pattern: /(修复|报错|bug|debug|crash|异常|运行不了|stack trace|error)/i,
        result: { needsTools: true, category: 'debug', plan: 'Inspect the relevant code and fix the issue', complexity: 'complex', suggestedPersona: 'debugger', source: 'heuristic' },
    },
    {
        pattern: /(重构|优化代码|refactor|cleanup|improve the code|性能优化)/i,
        result: { needsTools: true, category: 'refactor', plan: 'Inspect the code and implement a focused refactor', complexity: 'complex', suggestedPersona: 'architect', source: 'heuristic' },
    },
    {
        pattern: /(review|审查|检查代码|代码审查|audit|漏洞|安全检查)/i,
        result: { needsTools: true, category: 'review', plan: 'Inspect the codebase and produce a review', complexity: 'complex', suggestedPersona: 'reviewer', source: 'heuristic' },
    },
    {
        pattern: /(搜索|查找|找一个|帮我找|search|find|grep|rg|文献综述|论文|调研|竞品分析|最新)/i,
        result: { needsTools: true, category: 'search', plan: 'Search the workspace or external sources as needed', complexity: 'moderate', suggestedPersona: 'analyst', source: 'heuristic' },
    },
    {
        pattern: /(配置|设置|环境|config|setup|install|部署|baseurl|api key|apikey)/i,
        result: { needsTools: true, category: 'config', plan: 'Inspect the relevant configuration and update it safely', complexity: 'moderate', suggestedPersona: 'programmer', source: 'heuristic' },
    },
    {
        pattern: /(为什么|为啥|怎么|为何).{0,40}(diff|git|暂存|变更|改动|文件|卡片|VS\s*Code|vscode|MIMO|MiMo|扩展|插件)|(?:diff|git|staged|cached).{0,60}(not showing|missing|没有|不显示|看不到)/i,
        result: { needsTools: true, category: 'debug', plan: 'Inspect the extension or workspace state before explaining the UI behavior', complexity: 'moderate', suggestedPersona: 'debugger', source: 'heuristic' },
    },
    {
        pattern: /(写一个|帮我写|实现|创建文件|修改文件|增加功能|build|implement|create|edit|write file)/i,
        result: { needsTools: true, category: 'code_task', plan: 'Inspect the relevant files and implement the requested change', complexity: 'moderate', suggestedPersona: 'programmer', source: 'heuristic' },
    },
];

export function quickClassifyIntent(userInput: string): IntentResult | null {
    const trimmed = userInput.trim();
    const lower = trimmed.toLowerCase();

    const localWorkspaceTask = classifyLocalWorkspaceTask(trimmed);
    if (localWorkspaceTask) return localWorkspaceTask;

    if (!trimmed) {
        return {
            needsTools: false,
            category: 'greeting',
            plan: 'Ask the user to provide a request',
            complexity: 'simple',
            suggestedPersona: null,
            source: 'heuristic',
        };
    }

    if (userInput.startsWith('/')) {
        return {
            needsTools: true,
            category: 'code_task',
            plan: 'Execute skill command',
            complexity: 'moderate',
            suggestedPersona: null,
            source: 'heuristic',
        };
    }

    if (QUICK_GREETINGS.has(lower) || trimmed.length <= 3 || /^[!?！？。，“”，、~\-\s]+$/.test(trimmed)) {
        return {
            needsTools: false,
            category: 'greeting',
            plan: 'Respond directly',
            complexity: 'simple',
            suggestedPersona: null,
            source: 'heuristic',
        };
    }

    if (looksLikeSimpleQuestion(trimmed)) {
        return {
            needsTools: false,
            category: 'question',
            plan: 'Answer directly',
            complexity: 'simple',
            suggestedPersona: null,
            source: 'heuristic',
        };
    }

    for (const entry of QUICK_DIRECT_PATTERNS) {
        if (entry.pattern.test(trimmed)) return entry.result;
    }

    for (const entry of QUICK_TOOL_PATTERNS) {
        if (entry.pattern.test(trimmed)) return entry.result;
    }

    if (trimmed.length >= 8 && /[A-Za-z0-9_\-./\\]/.test(trimmed) && /(\.ts|\.js|\.py|\.json|\.md|\.tsx|\.jsx|\.css|\.html|bug|error|fix|refactor|review)/i.test(trimmed)) {
        return {
            needsTools: true,
            category: 'code_task',
            plan: 'Inspect the relevant files and implement the requested change',
            complexity: trimmed.length > 120 ? 'complex' : 'moderate',
            suggestedPersona: 'programmer',
            source: 'heuristic',
        };
    }

    return null;
}

export async function checkAdversarialSuitability(
    api: MiMoAPI,
    userInput: string,
    model: string,
    signal?: AbortSignal,
): Promise<{ suitable: boolean; reason: string; category: string }> {
    const trimmed = userInput.trim();
    const lower = trimmed.toLowerCase();

    if (QUICK_GREETINGS.has(lower) || trimmed.length <= 5) {
        return { suitable: false, reason: 'short greeting or acknowledgement', category: 'greeting' };
    }

    const questionPatterns = [
        /^(什么是|为什么|怎么|如何|能否|可不可以|有没有|是不是|是否)/,
        /^(what|why|how|can|could|is|are|do|does|will|would)\b/i,
        /\?|？/,
    ];
    if (questionPatterns.some((pattern) => pattern.test(trimmed)) && trimmed.length < 100) {
        return { suitable: false, reason: 'pure question without executable output', category: 'question' };
    }

    const automationKeywords = [
        '打开', '关闭', '点击', '输入', '滑动', '滚动', '截图', '录制',
        '浏览器', '网页', '自动化', '操控', '控制', '远程', '桌面',
        'open browser', 'click', 'type in', 'scroll', 'screenshot', 'automate',
        'rpa', 'gui', '鼠标', '键盘',
    ];
    if (automationKeywords.some((kw) => lower.includes(kw))) {
        return { suitable: false, reason: 'automation task is better served by direct execution', category: 'automation' };
    }

    const metaPatterns = [
        /^(你能|你有|你是|你的|帮我切换|帮我设置|帮我配置)/,
        /^(switch|set|configure|change mode|change model)/i,
        /模式|设置|配置|环境|version|版本/,
    ];
    if (metaPatterns.some((pattern) => pattern.test(trimmed)) && trimmed.length < 60) {
        return { suitable: false, reason: 'meta or configuration conversation', category: 'meta' };
    }

    try {
        const intent = await classifyIntent(api, userInput, model, signal);
        const adversarialCategories = new Set<IntentCategory>([
            'code_task', 'refactor', 'debug', 'review', 'search', 'multi_step',
        ]);

        if (!adversarialCategories.has(intent.category)) {
            return { suitable: false, reason: `classified as ${intent.category}`, category: intent.category };
        }

        if (intent.complexity === 'simple') {
            return { suitable: false, reason: 'task is too simple for adversarial review', category: intent.category };
        }

        return { suitable: true, reason: '', category: intent.category };
    } catch {
        return { suitable: true, reason: '', category: 'unknown' };
    }
}

export async function classifyIntent(
    api: MiMoAPI,
    userInput: string,
    model: string,
    signal?: AbortSignal,
): Promise<IntentResult> {
    const quick = quickClassifyIntent(userInput);
    if (quick) return quick;

    try {
        const result = await api.chatCompletion({
            model,
            messages: [
                { role: 'system', content: ROUTER_PROMPT },
                { role: 'user', content: userInput },
            ],
            max_tokens: 180,
            temperature: 0,
            stream: false,
        }, signal);

        const jsonStr = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(jsonStr);

        return {
            needsTools: parsed.needsTools ?? true,
            category: parsed.category ?? 'code_task',
            plan: parsed.plan ?? '',
            complexity: parsed.complexity ?? 'moderate',
            suggestedPersona: parsed.suggestedPersona ?? null,
            source: 'model',
        };
    } catch {
        return {
            needsTools: true,
            category: 'code_task',
            plan: 'Proceed with tools',
            complexity: 'moderate',
            suggestedPersona: null,
            source: 'heuristic',
        };
    }
}
