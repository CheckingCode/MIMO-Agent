import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from './test-runner';
import {
    buildPlanExecutionMessage,
    getMimoPlansDir,
    isWhitelistedPlanPath,
    looksLikePlanResponse,
    sanitizePlanMarkdown,
} from '../planMode';

describe('plan mode helpers', () => {
    it('strips conversational wrappers when saving a plan file', () => {
        const raw = [
            '好的，我已经掌握了足够的信息。我现在来制定详细的优化计划。',
            '',
            '## 需求分析',
            '- 目标：优化 cat/index.html',
            '',
            '## 实现方案',
            '1. 重构结构',
            '2. 校验效果',
            '',
            '## 涉及文件',
            '- `cat/index.html`：调整 CSS 结构',
            '',
            '## 风险与对策',
            '- 风险：样式回归',
            '',
            '## 预期结果',
            '- 浏览器中效果更自然',
            '',
            '老板，计划已出。确认后我就开始动手 🐱',
        ].join('\n');

        expect(sanitizePlanMarkdown(raw)).toBe([
            '## 需求分析',
            '- 目标：优化 cat/index.html',
            '',
            '## 实现方案',
            '1. 重构结构',
            '2. 校验效果',
            '',
            '## 涉及文件',
            '- `cat/index.html`：调整 CSS 结构',
            '',
            '## 风险与对策',
            '- 风险：样式回归',
            '',
            '## 预期结果',
            '- 浏览器中效果更自然',
        ].join('\n'));
    });

    it('detects plan-like content even when wrapped with extra chatter', () => {
        const raw = [
            '好的，我来规划。',
            '',
            '## 需求分析',
            '- 目标：修复 Plan 模式',
            '',
            '## 实现方案',
            '1. 调整保存链路',
            '2. 增加清洗逻辑',
            '3. 补充测试',
            '',
            '## 涉及文件',
            '- `src/webview/chatProvider.ts`：改执行引用方式',
            '',
            '## 风险与对策',
            '- 风险：旧流程兼容性',
            '',
            '## 预期结果',
            '- 计划文件可直接执行',
            '',
            '确认后我就开始。',
        ].join('\n');

        expect(looksLikePlanResponse(raw)).toBe(true);
    });

    it('marks ~/.mimo/plans as whitelisted and builds file-first execution prompts', () => {
        const planPath = path.join(os.homedir(), '.mimo', 'plans', 'plan-demo.md');
        expect(getMimoPlansDir()).toBe(path.join(os.homedir(), '.mimo', 'plans'));
        expect(isWhitelistedPlanPath(planPath)).toBe(true);

        const message = buildPlanExecutionMessage(planPath);
        expect(message.includes(planPath)).toBe(true);
        expect(message.includes('已被明确允许读取')).toBe(true);
        expect(message.includes('不要要求用户重新粘贴计划')).toBe(true);
    });
});
