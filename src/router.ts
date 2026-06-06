/**
 * Intent Router - pre-classifies user input before the main agent loop.
 *
 * Uses a fast local heuristic path first, then falls back to a cheap LLM call
 * only for ambiguous requests.
 */

import { MiMoAPI } from './api';

export type IntentCategory =
    'greeting'
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

const ROUTER_PROMPT = `You are an intent classifier for a coding assistant. Analyze the user's message and classify it.

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "needsTools": true/false,
  "category": "greeting|question|code_task|explanation|refactor|debug|search|review|config|creative|multi_step",
  "plan": "brief description of what to do",
  "complexity": "simple|moderate|complex",
  "suggestedPersona": "programmer|pm|reviewer|architect|debugger|summarizer|analyst|null"
}

Classification rules:
- Greetings and acknowledgements -> greeting, needsTools=false
- Pure knowledge questions -> question, needsTools=false
- Code implementation or file changes -> code_task, needsTools=true
- Code explanation requests -> explanation, needsTools=false
- Refactor or optimization requests -> refactor, needsTools=true
- Bug, crash, error, fix requests -> debug, needsTools=true
- Search, research, latest, find requests -> search, needsTools=true
- Review, audit, security inspection requests -> review, needsTools=true
- Config, setup, environment requests -> config, needsTools=true
- Brainstorm or design-only requests -> creative, needsTools=false
- Multi-step tasks with explicit ordered steps -> multi_step, needsTools=true

Suggested persona mapping:
- debug, error, crash -> debugger
- review, audit, security -> reviewer
- architecture, design, scale -> architect
- requirement, spec, planning -> pm
- summarize, document, readme -> summarizer
- data, analyze, statistics -> analyst
- code, implement, fix -> programmer

CRITICAL: do NOT use tools for:
- Questions about conversation history
- Meta questions about the assistant
- Opinions or advice without requested execution
- Simple factual or yes/no questions

Respond with ONLY the JSON object.`;

const QUICK_GREETINGS = new Set([
    'hi', 'hello', 'hey', 'ok', 'okay', 'thanks', 'thank you', 'thx',
    '你好', '嗨', '哈喽', '好的', '嗯', '收到', '谢谢',
]);

const QUICK_DIRECT_PATTERNS: Array<{ pattern: RegExp; result: IntentResult }> = [
    {
        pattern: /^(什么是|为什么|怎么|如何|请问|能否|可不可以|有没有|是不是|是否|what|why|how|can|could|is|are|do|does|will|would)\b/i,
        result: { needsTools: false, category: 'question', plan: 'Answer directly', complexity: 'simple', suggestedPersona: null, source: 'heuristic' },
    },
    {
        pattern: /(解释这段代码|这段代码什么意思|explain this code|what does this code do)/i,
        result: { needsTools: false, category: 'explanation', plan: 'Explain the referenced code or concept', complexity: 'simple', suggestedPersona: null, source: 'heuristic' },
    },
    {
        pattern: /(头脑风暴|方案设计|想一想|brainstorm|design ideas|architecture ideas)/i,
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
        pattern: /(搜索|查找|找一下|帮我搜|search|find|grep|rg|文献综述|论文|调研|竞品分析|最新)/i,
        result: { needsTools: true, category: 'search', plan: 'Search the workspace or external sources as needed', complexity: 'moderate', suggestedPersona: 'analyst', source: 'heuristic' },
    },
    {
        pattern: /(配置|设置|环境|config|setup|install|部署|baseurl|api key|apikey)/i,
        result: { needsTools: true, category: 'config', plan: 'Inspect the relevant configuration and update it safely', complexity: 'moderate', suggestedPersona: 'programmer', source: 'heuristic' },
    },
    {
        pattern: /(写一个|帮我写|实现|创建文件|修改文件|改代码|增加功能|实现功能|build|implement|create|edit|write file)/i,
        result: { needsTools: true, category: 'code_task', plan: 'Inspect the relevant files and implement the requested change', complexity: 'moderate', suggestedPersona: 'programmer', source: 'heuristic' },
    },
];

export function quickClassifyIntent(userInput: string): IntentResult | null {
    const trimmed = userInput.trim();
    const lower = trimmed.toLowerCase();

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

    if ((trimmed.includes('然后') && trimmed.includes('最后')) || /第[一二三四五六七八九十].*第[一二三四五六七八九十]/.test(trimmed)) {
        return {
            needsTools: true,
            category: 'multi_step',
            plan: 'Break the work into steps and execute them in order',
            complexity: 'complex',
            suggestedPersona: 'pm',
            source: 'heuristic',
        };
    }

    for (const entry of QUICK_DIRECT_PATTERNS) {
        if (entry.pattern.test(trimmed)) return entry.result;
    }

    for (const entry of QUICK_TOOL_PATTERNS) {
        if (entry.pattern.test(trimmed)) return entry.result;
    }

    return null;
}

/**
 * Quick suitability check for adversarial mode.
 * Returns { suitable, reason, category } - if not suitable, caller should degrade to auto mode.
 */
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
        /^(什么是|为什么|怎么|如何|请问|能否|可不可以|有没有|是不是|是否)/,
        /^(what|why|how|can|could|is|are|do|does|will|would)\b/i,
        /区别|差异|对比|推荐|建议|看法|觉得|认为/,
        /\?|？$/,
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
            return {
                suitable: false,
                reason: `classified as ${intent.category}`,
                category: intent.category,
            };
        }

        if (intent.complexity === 'simple') {
            return {
                suitable: false,
                reason: 'task is too simple for adversarial review',
                category: intent.category,
            };
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
    if (quick) {
        return quick;
    }

    try {
        let result = '';
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                result = await api.chatCompletion({
                    model,
                    messages: [
                        { role: 'system', content: ROUTER_PROMPT },
                        { role: 'user', content: userInput },
                    ],
                    max_tokens: 250,
                    temperature: 0.1,
                }, signal);
                break;
            } catch (e: any) {
                if (attempt >= 2 || signal?.aborted) throw e;
                await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
            }
        }

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
