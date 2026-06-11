import * as os from 'os';
import * as path from 'path';

const PLAN_HEADING_PATTERNS = [
    /^#{1,3}\s*(执行计划|需求分析|实现方案|执行步骤|涉及文件|风险与对策|风险与回退|风险评估|预期结果|验证与验收|验收标准)\s*$/i,
    /^#{1,3}\s*(execution plan|requirements|analysis|implementation|plan|steps|files|risks|validation|acceptance)\s*$/i,
];

const TRAILING_CHATTER_PATTERNS = [
    /^(好的|老板|确认后|如果需要|若需要|需要我|我已经|我现在|以上|计划已出|核心思路|确认即可|随时可以|开始动手|开始执行)/,
    /^(great|ok|okay|once you confirm|if you want|let me know|i can start|the plan is ready)/i,
];

export const PLAN_MODE_ANALYSIS_GUIDANCE = `\n\n[Mode: Plan — 分析阶段]
你正在"规划模式"下工作。当前阶段只允许分析并产出计划，禁止执行任何改动。

硬性输出要求：
- 最终回复只能是计划正文本身，必须使用 markdown。
- 不要写任何开场白、结束语、寒暄、确认句、表态句、emoji，禁止出现“好的，我已经分析完了”“老板，计划已出”“确认后我就开始动手”这类与计划无关的内容。
- 第一行必须直接从 "# 执行计划" 或 "## 需求分析" 开始。
- 计划必须具备可执行性：让后续 AI 可以不依赖额外解释，按顺序直接执行。

你的任务：
1. 使用只读工具（读取文件、搜索、查看目录）了解代码库现状
2. 分析用户的真实目标、约束、风险和验收标准
3. 产出详细、可执行、按顺序推进的计划
4. 如果存在关键歧义或多种高影响方案，使用 ask_user 确认，不要靠套话填充

计划结构：
# 执行计划

## 需求分析
- 目标：
- 关键约束：
- 验收标准：

## 实现方案
1. 步骤标题
   - 目标：
   - 具体操作：
   - 涉及文件：
   - 验证方式：

## 涉及文件
- \`路径\`：改动内容

## 风险与对策
- 风险：
- 对策：

## 预期结果
- 完成后的状态：
- 如何验证：

输出计划后立即停止。不要修改任何文件，不要开始执行。
系统会自动将你的计划保存到 ~/.mimo/plans/ 目录中。`;

export const PLAN_MODE_EXECUTION_GUIDANCE = `\n\n[Mode: Plan — 执行阶段]
用户已确认计划。现在先读取已确认的计划，再严格按计划顺序执行。

执行原则：
- 先读取计划文件或当前回合提供的已确认计划，再开始动手
- 严格按步骤推进，避免临时重写计划
- 每完成一步，简要汇报进度
- 如果发现计划与代码现状不符，明确说明偏差并暂停请求确认
- 每次修改后立刻进行对应验证（语法检查、测试、构建或人工检查）`;

export function getMimoPlansDir(): string {
    return path.join(os.homedir(), '.mimo', 'plans');
}

export function isWhitelistedPlanPath(filePath: string): boolean {
    if (!filePath) return false;
    const plansDir = path.resolve(getMimoPlansDir());
    const target = path.resolve(filePath);
    const rel = path.relative(plansDir, target);
    return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function isPlanHeadingLine(line: string): boolean {
    const trimmed = line.trim();
    return PLAN_HEADING_PATTERNS.some(pattern => pattern.test(trimmed));
}

function isLikelyTrailingChatter(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (trimmed === '```') return true;
    if (/[🐱😀😄🙂👍✅]$/.test(trimmed)) return true;
    return TRAILING_CHATTER_PATTERNS.some(pattern => pattern.test(trimmed));
}

export function sanitizePlanMarkdown(response: string): string {
    const normalized = String(response || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    if (!normalized) return '';

    const lines = normalized.split('\n');
    const start = lines.findIndex(isPlanHeadingLine);
    const sliced = start >= 0 ? lines.slice(start) : lines.slice();

    let end = sliced.length - 1;
    while (end >= 0 && !sliced[end].trim()) end--;
    while (end >= 0 && isLikelyTrailingChatter(sliced[end])) {
        end--;
        while (end >= 0 && !sliced[end].trim()) end--;
    }

    const cleaned = sliced.slice(0, end + 1).join('\n').trim();
    return cleaned || normalized;
}

export function looksLikePlanResponse(response: string): boolean {
    const text = sanitizePlanMarkdown(response);
    if (text.length < 120) return false;
    const headings = text.match(/^#{1,3}\s+\S.+$/gm)?.length ?? 0;
    const checklist = text.match(/^\s*[-*]\s+\[[ xX]\]\s+\S/gm)?.length ?? 0;
    const numbered = text.match(/^\s*\d+[.)]\s+\S/gm)?.length ?? 0;
    const lower = text.toLowerCase();
    const englishHits = [
        'implementation', 'plan', 'steps', 'tasks', 'files',
        'risks', 'validation', 'acceptance', 'execute', 'todo',
    ].filter(k => lower.includes(k)).length;
    const hasChinesePlanMarker = ['计划', '步骤', '任务', '文件', '风险', '验证', '实现', '方案']
        .some(k => text.includes(k));
    return checklist >= 2
        || numbered >= 3
        || (headings >= 2 && (englishHits > 0 || hasChinesePlanMarker))
        || (headings >= 1 && englishHits >= 2);
}

export function buildPlanExecutionMessage(planPath: string): string {
    const absolutePath = path.resolve(planPath);
    const whitelistNote = isWhitelistedPlanPath(absolutePath)
        ? '该路径虽然在工作区外，但已被明确允许读取。'
        : '';
    return [
        `请先读取已确认的计划文件：${absolutePath}`,
        whitelistNote,
        '不要要求用户重新粘贴计划，不要重新生成计划。',
        '读取后严格按计划顺序执行；如果文件读取失败，再明确报告失败原因。',
    ].filter(Boolean).join('\n');
}
