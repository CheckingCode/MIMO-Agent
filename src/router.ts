/**
 * Intent Router - pre-classifies user input before the main agent loop.
 */

import { MiMoAPI } from './api';

export type IntentCategory =
    | 'greeting'
    | 'acknowledgement'
    | 'question'
    | 'feedback'
    | 'context'
    | 'preference'
    | 'experience'
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
  "category": "greeting|acknowledgement|question|feedback|context|preference|experience|code_task|explanation|refactor|debug|search|review|config|creative|multi_step",
  "plan": "brief description of what to do",
  "complexity": "simple|moderate|complex",
  "suggestedPersona": "programmer|pm|reviewer|architect|debugger|summarizer|analyst|null"
}

Rules:
- Greetings or identity/capability questions -> greeting, needsTools=false
- Short confirmations/authorizations such as "continue", "ok", "可以", "继续" -> acknowledgement, needsTools=false
- Pure questions -> question, needsTools=false
- Corrections or negative feedback about assistant behavior -> feedback, needsTools=true when they mention the agent/product/workflow/UI, otherwise false
- Supplemental evidence such as screenshots, "图2", "补充一下", repro details -> context, needsTools=true if it refers to the current project/product issue
- User preferences or operating rules such as "以后", "不要", "应当", "保存规则" -> preference, needsTools=true if they ask to save/implement the rule
- Product reliability/experience issues such as trust, interruptions, stop button, red errors, repeated read/write failures -> experience, needsTools=true
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

const ZH = {
    hello: '\u4f60\u597d',
    hi: '\u55e8',
    hey: '\u54c8\u55bd',
    okay: '\u597d\u7684',
    received: '\u6536\u5230',
    thanks: '\u8c22\u8c22',
    diff: '\u6682\u5b58',
    changes: '\u53d8\u66f4',
    file: '\u6587\u4ef6',
    card: '\u5361\u7247',
    extension: '\u6269\u5c55',
    plugin: '\u63d2\u4ef6',
    what: '\u4ec0\u4e48\u662f',
    why: '\u4e3a\u4ec0\u4e48',
    how: '\u600e\u4e48',
    howTo: '\u5982\u4f55',
    can: '\u80fd\u5426',
    maybe: '\u53ef\u4e0d\u53ef\u4ee5',
    have: '\u6709\u6ca1\u6709',
    is: '\u662f\u4e0d\u662f',
    whether: '\u662f\u5426',
    review: '\u5ba1\u67e5',
    audit: '\u5ba1\u6838',
    security: '\u5b89\u5168',
    error: '\u62a5\u9519',
    wrong: '\u9519\u8bef',
    exception: '\u5f02\u5e38',
    fix: '\u4fee\u590d',
    investigate: '\u6392\u67e5',
    debug: '\u8c03\u8bd5',
    refactor: '\u91cd\u6784',
    code: '\u4ee3\u7801',
    directory: '\u76ee\u5f55',
    project: '\u9879\u76ee',
    workspace: '\u5de5\u4f5c\u533a',
    settings: '\u8bbe\u7f6e',
    config: '\u914d\u7f6e',
    compile: '\u7f16\u8bd1',
    test: '\u6d4b\u8bd5',
    commit: '\u63d0\u4ea4',
    diffWord: '\u5dee\u5f02',
    helpMe: '\u5e2e\u6211',
    please: '\u8bf7',
    modify: '\u4fee',
    change: '\u6539',
    implement: '\u5b9e\u73b0',
    add: '\u65b0\u589e',
    remove: '\u5220\u9664',
    check: '\u68c0\u67e5',
    look: '\u770b\u770b',
    explain: '\u89e3\u91ca',
    search: '\u641c\u7d22',
    find: '\u67e5\u627e',
    read: '\u8bfb\u53d6',
    write: '\u5199\u5165',
    organize: '\u6574\u7406',
    analyze: '\u5206\u6790',
    optimize: '\u4f18\u5316',
    latest: '\u6700\u65b0',
    research: '\u8c03\u7814',
    docs: '\u8d44\u6599',
    paper: '\u8bba\u6587',
    steps: '\u6b65\u9aa4',
    multiple: '\u591a\u4e2a',
    explainCode: '\u89e3\u91ca\u8fd9\u6bb5\u4ee3\u7801',
    codeMeaning: '\u8fd9\u6bb5\u4ee3\u7801\u4ec0\u4e48\u610f\u601d',
    brainstorm: '\u5934\u8111\u98ce\u66b4',
    design: '\u65b9\u6848\u8bbe\u8ba1',
    broken: '\u8fd0\u884c\u4e0d\u4e86',
    perf: '\u6027\u80fd\u4f18\u5316',
    codeReview: '\u4ee3\u7801\u5ba1\u67e5',
    vulnerability: '\u6f0f\u6d1e',
    secCheck: '\u5b89\u5168\u68c0\u67e5',
    literature: '\u6587\u732e\u7efc\u8ff0',
    competitor: '\u7ade\u54c1\u5206\u6790',
    deploy: '\u90e8\u7f72',
    env: '\u73af\u5883',
    visible: '\u4e0d\u663e\u793a',
    missing: '\u6ca1\u6709',
    notVisible: '\u770b\u4e0d\u5230',
    createFile: '\u521b\u5efa\u6587\u4ef6',
    editFile: '\u4fee\u6539\u6587\u4ef6',
    addFeature: '\u589e\u52a0\u529f\u80fd',
    openTopic: '\u5f00\u9898',
    folder: '\u6587\u4ef6\u5939',
    basedOn: '\u6839\u636e',
    view: '\u67e5\u770b',
    generate: '\u751f\u6210',
    create: '\u521b\u5efa',
    make: '\u5236\u4f5c',
    reportDraft: '\u6c47\u62a5\u7a3f',
    report: '\u62a5\u544a',
    document: '\u6587\u6863',
    summary: '\u603b\u7ed3',
    open: '\u6253\u5f00',
    close: '\u5173\u95ed',
    click: '\u70b9\u51fb',
    input: '\u8f93\u5165',
    swipe: '\u6ed1\u52a8',
    scroll: '\u6eda\u52a8',
    screenshot: '\u622a\u56fe',
    record: '\u5f55\u5236',
    browser: '\u6d4f\u89c8\u5668',
    webpage: '\u7f51\u9875',
    automation: '\u81ea\u52a8\u5316',
    control: '\u64cd\u63a7',
    remote: '\u8fdc\u7a0b',
    desktop: '\u684c\u9762',
    mouse: '\u9f20\u6807',
    keyboard: '\u952e\u76d8',
    youCan: '\u4f60\u80fd',
    youHave: '\u4f60\u6709',
    youAre: '\u4f60\u662f',
    your: '\u4f60\u7684',
    switchMode: '\u5e2e\u6211\u5207\u6362',
    setUp: '\u5e2e\u6211\u8bbe\u7f6e',
    configure: '\u5e2e\u6211\u914d\u7f6e',
    mode: '\u6a21\u5f0f',
    version: '\u7248\u672c',
    helpShort1: '\u5e2e\u5e2e\u6211',
    helpShort2: '\u5e2e\u6211\u770b\u4e0b',
    helpShort3: '\u770b\u4e00\u4e0b',
    helpShort4: '\u770b\u770b\u8fd9\u4e2a',
    free: '\u6709\u7a7a\u5417',
} as const;

const CODE_OR_WORKSPACE_SIGNAL =
    new RegExp(
        [
            String.raw`(?:^|[\s"'` + '`' + String.raw`(])(?:src|out|dist|app|lib|test|tests|package\.json|tsconfig\.json|README\.md)(?:[\s"'` + '`' + String.raw`)\/\\]|$)`,
            String.raw`(?:\.html?|\.tsx?|\.jsx?|\.ts|\.js|\.py|\.json|\.md|\.css|\.scss|\.yml|\.yaml)\b`,
            String.raw`(?:error|bug|stack trace|traceback|exception|undefined|null reference|failing|broken|fix|debug|refactor|review|commit|diff|patch|build|compile|test|lint|workspace|repo|repository|extension|plugin|vscode|VS\s*Code|mimo|MiMo|api key|baseurl|base url)`,
            `${ZH.error}|${ZH.wrong}|${ZH.exception}|${ZH.fix}|${ZH.investigate}|${ZH.debug}|${ZH.refactor}|${ZH.review}|${ZH.code}|${ZH.file}|${ZH.directory}|${ZH.project}|${ZH.workspace}|${ZH.extension}|${ZH.plugin}|${ZH.settings}|${ZH.config}|${ZH.compile}|${ZH.test}|${ZH.commit}|${ZH.diffWord}`,
        ].join('|'),
        'i',
    );

const TASK_VERB_SIGNAL =
    new RegExp(
        [
            String.raw`(?:fix|debug|implement|create|edit|update|modify|change|refactor|review|search|find|read|write|add|remove|explain|inspect|check|analy[sz]e|look into|repair|optimi[sz]e|trace)`,
            `${ZH.helpMe}|${ZH.please}|${ZH.modify}|${ZH.fix}|${ZH.change}|${ZH.implement}|${ZH.add}|${ZH.remove}|${ZH.check}|${ZH.look}|${ZH.investigate}|${ZH.debug}|${ZH.explain}|${ZH.search}|${ZH.find}|${ZH.read}|${ZH.write}|${ZH.organize}|${ZH.analyze}|${ZH.optimize}`,
        ].join('|'),
        'i',
    );

const SEARCH_SIGNAL =
    new RegExp(
        [
            String.raw`(?:search|find|grep|rg|look up|latest|research|investigate|paper|docs)`,
            `${ZH.search}|${ZH.find}|${ZH.research}|${ZH.docs}|${ZH.paper}|${ZH.latest}`,
        ].join('|'),
        'i',
    );

const EVIDENCE_VERIFICATION_SIGNAL =
    /(?:crossref|doi\b|api\b|endpoint|fetch_url|web_search|http status|status\s*code|request|response|verified|validated|actually\s+(?:checked|verified|called|queried|fetched)|did\s+(?:you|it)\s+(?:check|verify|call|query|fetch)|source|evidence|citation|\u9a8c\u8bc1|\u6821\u9a8c|\u67e5\u8bc1|\u6838\u5b9e|\u8c03\u7528|\u8bf7\u6c42|\u63a5\u53e3|\u8fd4\u56de|\u72b6\u6001\u7801|\u5b9e\u9645|\u786e\u5b9e|\u771f\u7684|\u4f9d\u636e|\u8bc1\u636e|\u6765\u6e90|\u5f15\u7528)/i;

const EXTERNAL_EVIDENCE_TARGET_SIGNAL =
    /(?:crossref|doi\b|api\b|endpoint|url\b|https?:\/\/|http status|status\s*code|request|response|web|internet|online|database|pubmed|arxiv|github|npm|pypi|\u63a5\u53e3|\u7f51\u7edc|\u7f51\u9875|\u5b98\u7f51|\u6570\u636e\u5e93|\u6587\u732e|\u8bba\u6587)/i;

export function requiresToolEvidence(userInput: string): boolean {
    const trimmed = userInput.trim();
    if (!trimmed) return false;
    if (!EVIDENCE_VERIFICATION_SIGNAL.test(trimmed)) return false;

    const asksDefinitionOnly = /^(?:what\s+(?:is|are)|what does .+ mean|define|explain)\b/i.test(trimmed)
        || /^(?:\u4ec0\u4e48\u662f|.+\u662f\u4ec0\u4e48|.+\u4ec0\u4e48\u610f\u601d)/.test(trimmed);
    const asksQuestion = /[?\uFF1F]/.test(trimmed)
        || /^(?:what|why|how|whether|did|do|does|is|are|was|were|can|could)\b/i.test(trimmed)
        || /(?:\u662f\u5426|\u662f\u4e0d\u662f|\u6709\u6ca1\u6709|\u4e3a\u4ec0\u4e48|\u600e\u4e48|\u5982\u4f55)/.test(trimmed);
    const asksForProvenance = /(?:actually|really|did\s+you|was\s+it|were\s+they|source|evidence|verified|validated|\u5b9e\u9645|\u786e\u5b9e|\u771f\u7684|\u4f9d\u636e|\u8bc1\u636e|\u6765\u6e90|\u8c03\u7528|\u9a8c\u8bc1|\u6821\u9a8c|\u67e5\u8bc1|\u6838\u5b9e)/i.test(trimmed);
    if (asksDefinitionOnly && !asksForProvenance) return false;

    return asksForProvenance || (asksQuestion && EXTERNAL_EVIDENCE_TARGET_SIGNAL.test(trimmed));
}

function buildEvidenceVerificationIntent(): IntentResult {
    return {
        needsTools: true,
        category: 'search',
        plan: 'Verify the claim against recent tool evidence or external/source data before answering',
        complexity: 'moderate',
        suggestedPersona: 'analyst',
        source: 'heuristic',
    };
}

const TOOL_BACKED_ANSWER_SIGNAL =
    /(?:root cause|why.*(?:broken|failed|stopped|slow|lag|freeze|hang)|fix plan|solution|diagnos(?:e|is)|investigate|inspect|verify|validate|test|reproduce|regression|current|latest|recent|today|now|workspace|repo|repository|project|codebase|file|folder|diff|git|commit|staged|cached|VS\s*Code|vscode|MIMO|MiMo|agent|workflow|webview|UI|button|card|input|textarea|performance|slow|lag|freeze|hang|stutter|crash|bug|error|exception|undefined|null|\u6839\u56e0|\u539f\u56e0|\u4e3a\u4ec0\u4e48.*(?:\u4e0d|\u9519|\u5361|\u6162|\u4e2d\u65ad|\u5931\u8d25)|\u4fee\u590d\u65b9\u6848|\u89e3\u51b3\u65b9\u6848|\u6392\u67e5|\u68c0\u67e5|\u9a8c\u8bc1|\u6821\u9a8c|\u590d\u73b0|\u56de\u5f52|\u5f53\u524d|\u6700\u65b0|\u6700\u8fd1|\u4eca\u5929|\u73b0\u5728|\u9879\u76ee|\u4ee3\u7801|\u4ee3\u7801\u5e93|\u6587\u4ef6|\u6587\u4ef6\u5939|\u5dee\u5f02|\u6682\u5b58|\u63d2\u4ef6|\u6269\u5c55|\u5de5\u4f5c\u6d41|\u5361\u7247|\u6309\u94ae|\u8f93\u5165\u6846|\u6027\u80fd|\u5361\u987f|\u5d29\u6e83|\u62a5\u9519|\u9519\u8bef|\u5f02\u5e38|\u4e2d\u65ad)/i;

export function requiresToolBackedAnswer(userInput: string): boolean {
    const trimmed = userInput.trim();
    if (!trimmed) return false;
    if (requiresToolEvidence(trimmed)) return true;
    if (TOOL_BACKED_ANSWER_SIGNAL.test(trimmed)) return true;
    if (hasConcreteCodeSignal(trimmed)) return true;
    if (SEARCH_SIGNAL.test(trimmed)) return true;
    return false;
}

function buildToolBackedAnswerIntent(text: string): IntentResult {
    if (requiresToolEvidence(text)) return buildEvidenceVerificationIntent();
    if (SEARCH_SIGNAL.test(text) || /(?:current|latest|recent|today|now|\u5f53\u524d|\u6700\u65b0|\u6700\u8fd1|\u4eca\u5929|\u73b0\u5728)/i.test(text)) {
        return {
            needsTools: true,
            category: 'search',
            plan: 'Search current sources or workspace evidence before answering',
            complexity: 'moderate',
            suggestedPersona: 'analyst',
            source: 'heuristic',
        };
    }
    const hasExplicitCodeTarget = /[A-Za-z]:[\\/]|(?:^|[\s"'`])\.{1,2}[\\/]|(?:^|[\s"'`])(?:src|out|dist|app|lib|test|tests|package\.json|tsconfig\.json|README\.md)(?:[\s"'`)\/\\]|$)|(?:\.html?|\.tsx?|\.jsx?|\.ts|\.js|\.py|\.json|\.md|\.css|\.scss|\.yml|\.yaml)\b/i.test(text);
    if (hasExplicitCodeTarget) {
        return buildConcreteTaskIntent(text);
    }
    if (EXPERIENCE_SIGNAL.test(text) || /(?:workflow|webview|UI|\u5de5\u4f5c\u6d41|\u4e2d\u65ad|\u5361\u987f|\u5361\u987f|\u4f53\u9a8c|\u8df3\u7ea2)/i.test(text)) {
        return {
            needsTools: true,
            category: 'experience',
            plan: 'Inspect relevant evidence before answering the product or workflow reliability question',
            complexity: 'complex',
            suggestedPersona: 'pm',
            source: 'heuristic',
        };
    }
    if (hasConcreteCodeSignal(text)) {
        return buildConcreteTaskIntent(text);
    }
    if (/(?:review|audit|security|\u5ba1\u67e5|\u5ba1\u6838|\u5b89\u5168)/i.test(text)) {
        return {
            needsTools: true,
            category: 'review',
            plan: 'Inspect evidence before producing the review',
            complexity: 'complex',
            suggestedPersona: 'reviewer',
            source: 'heuristic',
        };
    }
    return {
        needsTools: true,
        category: 'debug',
        plan: 'Inspect relevant evidence before answering or proposing a fix',
        complexity: inferConcreteTaskComplexity(text),
        suggestedPersona: 'debugger',
        source: 'heuristic',
    };
}

const QUICK_GREETINGS = new Set([
    'hi', 'hello', 'hey', 'ok', 'okay', 'thanks', 'thank you', 'thx',
    ZH.hello, ZH.hi, ZH.hey, ZH.okay, ZH.received, ZH.thanks,
]);

const IDENTITY_OR_CAPABILITY_SIGNAL =
    /^(?:who are you|what can you do|are you there|hello[,，]?\s*are you there|\u4f60\u597d.*(?:\u5728\u5417|\u4f60\u662f\u8c01|\u4f60\u4f1a\u5e72\u4ec0\u4e48)|\u5728\u5417|\u4f60\u662f\u8c01|\u4f60\u4f1a\u5e72\u4ec0\u4e48|\u4f60\u80fd\u505a\u4ec0\u4e48)/i;

const ACKNOWLEDGEMENT_SIGNAL =
    /^(?:ok|okay|yes|yep|sure|continue|go on|proceed|approved|agree|allow|\u53ef\u4ee5|\u7ee7\u7eed|\u540c\u610f|\u786e\u8ba4|\u5141\u8bb8|\u5c31\u8fd9\u4e48\u505a|\u6ca1\u95ee\u9898|\u597d\u7684|\u884c)\s*[.!?\u3002\uff01\uff1f]*$/i;

const FEEDBACK_SIGNAL =
    /(?:\u660e\u663e.*(?:\u9519|\u9519\u8bef|\u4e0d\u5bf9)|\u8fd9.*(?:\u4e0d\u5bf9|\u4e0d\u6b63\u5e38|\u662f\u9519\u7684)|\u4e0d\u5e94\u8be5|\u4e0d\u80fd.*(?:\u5f52\u56e0|\u7529\u9505)|\u76f4\u63a5\u8df3\u7ea2|stop.*(?:button|btn|\u6309\u94ae).*?(?:gone|missing|\u6ca1\u4e86)|(?:button|btn|\u6309\u94ae).*?(?:gone|missing|\u6ca1\u4e86).*?(?:output|workflow|\u8f93\u51fa|\u5de5\u4f5c\u6d41)|obviously wrong|this is wrong|should not|not acceptable)/i;

const CONTEXT_SUPPLEMENT_SIGNAL =
    /(?:^\s*(?:\u8865\u5145|\u518d\u8865\u5145|\u53e6\u5916)|\u56fe\s*\d+|screenshot|repro|reproduce|\u622a\u56fe|\u590d\u73b0|\u6211\u770b\u4e86\u4e00\u4e0b|\u6211\u770b\u4e86|\u4e5f\u5c31|\u53ea\u6709.*(?:\u884c|\u51e0\u767e\u884c))/i;

const PREFERENCE_SIGNAL =
    /(?:\u4ee5\u540e|\u540e\u7eed|\u4e0b\u6b21|\u8bf7\u5c06.*(?:\u4fdd\u5b58|\u5199\u5165|\u8bb0\u4f4f)|\u4fdd\u5b58.*(?:\u89c4\u5219|\u65b9\u6848|\u7cfb\u7edf)|\u8bb0\u4f4f|\u5e94\u5f53|\u5e94\u8be5|\u5fc5\u987b|\u5c3d\u91cf|\u4e0d\u8981.*(?:\u76f4\u63a5|\u8df3\u7ea2|\u4e71)|complex.*task.*framework|save.*(?:rule|policy|preference)|remember this|from now on|should always|must always)/i;

const EXPERIENCE_SIGNAL =
    /(?:MIMO|MiMo|mimo|agent|AGENT|\u667a\u80fd\u4f53).{0,80}(?:\u4e2d\u65ad|\u4fe1\u4efb|\u4f53\u9a8c|\u8df3\u7ea2|\u8bfb\u5199\u5931\u8d25|\u6587\u4ef6\u592a\u5927|stop|workflow|busy|idle)|(?:\u4e3a\u5565|\u4e3a\u4ec0\u4e48|\u600e\u4e48).{0,60}(?:\u603b\u662f|\u4e00\u76f4|\u53cd\u590d).{0,60}(?:\u4e2d\u65ad|\u8bfb\u5199\u5931\u8d25|\u5199\u5165\u5931\u8d25|\u6587\u4ef6\u592a\u5927)|(?:trust|user experience|reliability|interruption|interrupted|red error|read\/write failure|workflow still running)/i;

function looksLikeSimpleQuestion(text: string): boolean {
    const trimmed = text.trim();
    if (new RegExp(
        [
            String.raw`diff|git|staged|cached|VS\s*Code|vscode|MIMO|MiMo|\.html?|\.tsx?|\.jsx?|\.ts|\.js|\.py|\.json|\.md`,
            `${ZH.diff}|${ZH.changes}|${ZH.file}|${ZH.card}|${ZH.extension}|${ZH.plugin}`,
        ].join('|'),
        'i',
    ).test(trimmed)) {
        return false;
    }
    return /^(what|why|how|can|could|is|are|do|does|will|would)\b/i.test(trimmed)
        || new RegExp(`^(?:${ZH.what}|${ZH.why}|${ZH.how}|${ZH.howTo}|${ZH.can}|${ZH.maybe}|${ZH.have}|${ZH.is}|${ZH.whether})`).test(trimmed)
        || (trimmed.length <= 80 && /[?\uFF1F]$/.test(trimmed));
}

function includesAny(text: string, needles: string[]): boolean {
    const lower = text.toLowerCase();
    return needles.some((needle) => lower.includes(needle.toLowerCase()));
}

function hasConcreteCodeSignal(text: string): boolean {
    return CODE_OR_WORKSPACE_SIGNAL.test(text)
        || /[A-Za-z]:[\\/]|(?:^|[\s"'`])\.{1,2}[\\/]|(?:^|[\s"'`])[\\/]/.test(text);
}

function hasTaskVerb(text: string): boolean {
    return TASK_VERB_SIGNAL.test(text);
}

function shouldUseToolsForFeedback(text: string): boolean {
    return /(?:MIMO|MiMo|mimo|agent|AGENT|\u667a\u80fd\u4f53|workflow|stop|busy|idle|UI|webview|button|btn|card|diff|git|VS\s*Code|vscode|add-file-btn|document\.getElementById|undefined|null|\u5de5\u4f5c\u6d41|\u8df3\u7ea2|\u4e2d\u65ad|\u8bfb\u5199|\u56fe\s*\d+|\u622a\u56fe|\u6309\u94ae|\u5361\u7247|\u6ca1\u53cd\u5e94|\u62a5\u9519|\u9519\u8bef|\u4e0d\u5e94\u8be5|\u4e0d\u6b63\u5e38)/i.test(text);
}

function shouldUseToolsForPreference(text: string): boolean {
    return /(?:\u4fdd\u5b58|\u5199\u5165|\u7cfb\u7edf|\u5b9e\u73b0|\u4fee\u6539|MIMO|MiMo|mimo|agent|AGENT|save|implement|code|system)/i.test(text);
}

function inferConcreteTaskComplexity(text: string): 'simple' | 'moderate' | 'complex' {
    const trimmed = text.trim();
    if (trimmed.length > 220) return 'complex';
    if (SEARCH_SIGNAL.test(trimmed) || new RegExp(`(?:review|audit|security|performance)|(?:${ZH.review}|${ZH.audit}|${ZH.security}|${ZH.perf})`, 'i').test(trimmed)) {
        return trimmed.length > 80 ? 'complex' : 'moderate';
    }
    if (new RegExp(`(?:multiple|several|across|workflow|subagent|plan)|(?:${ZH.steps}|${ZH.multiple})`, 'i').test(trimmed)) {
        return 'complex';
    }
    return trimmed.length > 100 ? 'moderate' : 'simple';
}

export function buildConcreteTaskIntent(userInput: string): IntentResult {
    const trimmed = userInput.trim();
    if (new RegExp(`(?:review|audit|security)|(?:${ZH.review}|${ZH.audit}|${ZH.security})`, 'i').test(trimmed)) {
        return {
            needsTools: true,
            category: 'review',
            plan: 'Inspect the relevant code and produce a focused review',
            complexity: inferConcreteTaskComplexity(trimmed),
            suggestedPersona: 'reviewer',
            source: 'heuristic',
        };
    }
    if (new RegExp(`(?:bug|debug|error|crash|exception|traceback)|(?:${ZH.error}|${ZH.wrong}|${ZH.exception}|${ZH.investigate}|${ZH.debug})`, 'i').test(trimmed)) {
        return {
            needsTools: true,
            category: 'debug',
            plan: 'Inspect the relevant code and fix the issue',
            complexity: inferConcreteTaskComplexity(trimmed),
            suggestedPersona: 'debugger',
            source: 'heuristic',
        };
    }
    if (new RegExp(`(?:refactor|cleanup|optimi[sz]e|improve)|(?:${ZH.refactor}|${ZH.organize}|${ZH.optimize})`, 'i').test(trimmed)) {
        return {
            needsTools: true,
            category: 'refactor',
            plan: 'Inspect the code and implement a focused refactor',
            complexity: inferConcreteTaskComplexity(trimmed),
            suggestedPersona: 'architect',
            source: 'heuristic',
        };
    }
    if (SEARCH_SIGNAL.test(trimmed)) {
        return {
            needsTools: true,
            category: 'search',
            plan: 'Search the workspace or sources needed for the request',
            complexity: inferConcreteTaskComplexity(trimmed),
            suggestedPersona: 'analyst',
            source: 'heuristic',
        };
    }
    if (new RegExp(`(?:config|setup|install|baseurl|api key)|(?:${ZH.config}|${ZH.settings}|${ZH.deploy}|${ZH.env})`, 'i').test(trimmed)) {
        return {
            needsTools: true,
            category: 'config',
            plan: 'Inspect and update the relevant configuration safely',
            complexity: inferConcreteTaskComplexity(trimmed),
            suggestedPersona: 'programmer',
            source: 'heuristic',
        };
    }
    return {
        needsTools: true,
        category: 'code_task',
        plan: 'Inspect the relevant files and implement the requested change',
        complexity: inferConcreteTaskComplexity(trimmed),
        suggestedPersona: 'programmer',
        source: 'heuristic',
    };
}

export function shouldUseModelIntentClassification(userInput: string): boolean {
    const trimmed = userInput.trim();
    if (!trimmed) return false;
    if (/^(?:can you help|help me|need help|帮帮我|帮我看下|看一下|看看这个|有空吗)$/i.test(trimmed)) {
        return true;
    }
    if (quickClassifyIntent(trimmed)) return false;
    if (trimmed.length < 6) return false;
    if (trimmed.length > 140) return false;
    if (hasConcreteCodeSignal(trimmed) || hasTaskVerb(trimmed)) return false;
    return true;
}

function classifyLocalWorkspaceTask(text: string): IntentResult | null {
    const hasLocalPath = /[A-Za-z]:[\\/]|(?:^|[\s"'`])\.{1,2}[\\/]|[\\/][^\\/]+[\\/]/.test(text);
    const hasLocalTarget = hasLocalPath || includesAny(text, [
        'ppt', '.ppt', '.pptx', '.pdf', '.doc', '.docx', '.xls', '.xlsx',
        ZH.directory, ZH.folder, ZH.file, ZH.project, ZH.openTopic,
    ]);
    const hasAction = includesAny(text, [
        ZH.helpMe, ZH.basedOn, ZH.read, ZH.view, ZH.look,
        ZH.find, ZH.search, ZH.write, ZH.generate, ZH.organize,
        ZH.create, ZH.make, ZH.reportDraft, ZH.report, ZH.document, ZH.summary,
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
        pattern: new RegExp(`(?:${ZH.explainCode}|${ZH.codeMeaning}|explain this code|what does this code do)`, 'i'),
        result: { needsTools: false, category: 'explanation', plan: 'Explain the referenced code or concept', complexity: 'simple', suggestedPersona: null, source: 'heuristic' },
    },
    {
        pattern: new RegExp(`(?:${ZH.brainstorm}|${ZH.design}|brainstorm|design ideas|architecture ideas)`, 'i'),
        result: { needsTools: false, category: 'creative', plan: 'Brainstorm without tools first', complexity: 'moderate', suggestedPersona: 'architect', source: 'heuristic' },
    },
];

const QUICK_TOOL_PATTERNS: Array<{ pattern: RegExp; result: IntentResult }> = [
    {
        pattern: new RegExp(`(?:${ZH.fix}|${ZH.error}|bug|debug|crash|${ZH.exception}|${ZH.broken}|stack trace|error)`, 'i'),
        result: { needsTools: true, category: 'debug', plan: 'Inspect the relevant code and fix the issue', complexity: 'complex', suggestedPersona: 'debugger', source: 'heuristic' },
    },
    {
        pattern: new RegExp(`(?:${ZH.refactor}|${ZH.optimize}${ZH.code}?|refactor|cleanup|improve the code|${ZH.perf})`, 'i'),
        result: { needsTools: true, category: 'refactor', plan: 'Inspect the code and implement a focused refactor', complexity: 'complex', suggestedPersona: 'architect', source: 'heuristic' },
    },
    {
        pattern: new RegExp(`(?:review|${ZH.review}|${ZH.check}${ZH.code}|${ZH.codeReview}|audit|${ZH.vulnerability}|${ZH.secCheck})`, 'i'),
        result: { needsTools: true, category: 'review', plan: 'Inspect the codebase and produce a review', complexity: 'complex', suggestedPersona: 'reviewer', source: 'heuristic' },
    },
    {
        pattern: new RegExp(`(?:${ZH.search}|${ZH.find}|${ZH.helpMe}${ZH.find}|search|find|grep|rg|${ZH.literature}|${ZH.paper}|${ZH.research}|${ZH.competitor}|${ZH.latest})`, 'i'),
        result: { needsTools: true, category: 'search', plan: 'Search the workspace or external sources as needed', complexity: 'moderate', suggestedPersona: 'analyst', source: 'heuristic' },
    },
    {
        pattern: new RegExp(`(?:${ZH.config}|${ZH.settings}|${ZH.env}|config|setup|install|${ZH.deploy}|baseurl|api key|apikey)`, 'i'),
        result: { needsTools: true, category: 'config', plan: 'Inspect the relevant configuration and update it safely', complexity: 'moderate', suggestedPersona: 'programmer', source: 'heuristic' },
    },
    {
        pattern: new RegExp(`(?:${ZH.why}|${ZH.how}|${ZH.whether}).{0,40}(?:diff|git|${ZH.diff}|${ZH.changes}|${ZH.file}|${ZH.card}|VS\\s*Code|vscode|MIMO|MiMo|${ZH.extension}|${ZH.plugin})|(?:diff|git|staged|cached).{0,60}(?:not showing|missing|${ZH.missing}|${ZH.visible}|${ZH.notVisible})`, 'i'),
        result: { needsTools: true, category: 'debug', plan: 'Inspect the extension or workspace state before explaining the UI behavior', complexity: 'moderate', suggestedPersona: 'debugger', source: 'heuristic' },
    },
    {
        pattern: new RegExp(`(?:${ZH.write}|${ZH.helpMe}${ZH.write}|${ZH.implement}|${ZH.createFile}|${ZH.editFile}|${ZH.addFeature}|build|implement|create|edit|write file)`, 'i'),
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

    if (IDENTITY_OR_CAPABILITY_SIGNAL.test(trimmed)) {
        return {
            needsTools: false,
            category: 'greeting',
            plan: 'Answer identity and capability directly',
            complexity: 'simple',
            suggestedPersona: null,
            source: 'heuristic',
        };
    }

    if (ACKNOWLEDGEMENT_SIGNAL.test(trimmed)) {
        return {
            needsTools: false,
            category: 'acknowledgement',
            plan: 'Treat as confirmation or acknowledgement; resume pending context if one exists',
            complexity: 'simple',
            suggestedPersona: null,
            source: 'heuristic',
        };
    }

    if (QUICK_GREETINGS.has(lower) || trimmed.length <= 3 || /^[!?\uFF01\uFF1F\u3002\uFF0C\u201C\u201D\u3001~\-\s]+$/.test(trimmed)) {
        return {
            needsTools: false,
            category: 'greeting',
            plan: 'Respond directly',
            complexity: 'simple',
            suggestedPersona: null,
            source: 'heuristic',
        };
    }

    if (/^(?:can you help|help me|need help|帮帮我|帮我看下|看一下|看看这个|有空吗)$/i.test(trimmed)) {
        return null;
    }

    if (requiresToolEvidence(trimmed)) {
        return buildEvidenceVerificationIntent();
    }

    if (PREFERENCE_SIGNAL.test(trimmed)) {
        return {
            needsTools: shouldUseToolsForPreference(trimmed),
            category: 'preference',
            plan: 'Record or implement the user operating rule before continuing',
            complexity: shouldUseToolsForPreference(trimmed) ? 'moderate' : 'simple',
            suggestedPersona: 'pm',
            source: 'heuristic',
        };
    }

    if (EXPERIENCE_SIGNAL.test(trimmed)) {
        return {
            needsTools: true,
            category: 'experience',
            plan: 'Analyze the product reliability issue, attribute the cause, and improve the workflow if needed',
            complexity: 'complex',
            suggestedPersona: 'pm',
            source: 'heuristic',
        };
    }

    if (FEEDBACK_SIGNAL.test(trimmed)) {
        const needsTools = shouldUseToolsForFeedback(trimmed);
        return {
            needsTools,
            category: 'feedback',
            plan: needsTools
                ? 'Verify the reported behavior, attribute the issue, and fix the agent or UI logic if needed'
                : 'Acknowledge the correction, explain the issue, and adjust the answer',
            complexity: needsTools ? 'complex' : 'simple',
            suggestedPersona: needsTools ? 'debugger' : null,
            source: 'heuristic',
        };
    }

    if (CONTEXT_SUPPLEMENT_SIGNAL.test(trimmed)) {
        return {
            needsTools: shouldUseToolsForFeedback(trimmed) || hasConcreteCodeSignal(trimmed),
            category: 'context',
            plan: 'Merge the supplemental evidence into the current task context and update the diagnosis',
            complexity: 'moderate',
            suggestedPersona: 'analyst',
            source: 'heuristic',
        };
    }

    if (requiresToolBackedAnswer(trimmed)) {
        return buildToolBackedAnswerIntent(trimmed);
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

    if (hasConcreteCodeSignal(trimmed) && hasTaskVerb(trimmed)) {
        return buildConcreteTaskIntent(trimmed);
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
        new RegExp(`^(?:${ZH.what}|${ZH.why}|${ZH.how}|${ZH.howTo}|${ZH.can}|${ZH.maybe}|${ZH.have}|${ZH.is}|${ZH.whether})`),
        /^(what|why|how|can|could|is|are|do|does|will|would)\b/i,
        /\?|\uFF1F/,
    ];
    if (questionPatterns.some((pattern) => pattern.test(trimmed)) && trimmed.length < 100) {
        return { suitable: false, reason: 'pure question without executable output', category: 'question' };
    }

    const automationKeywords = [
        ZH.open, ZH.close, ZH.click, ZH.input, ZH.swipe, ZH.scroll, ZH.screenshot, ZH.record,
        ZH.browser, ZH.webpage, ZH.automation, ZH.control, ZH.remote, ZH.desktop,
        'open browser', 'click', 'type in', 'scroll', 'screenshot', 'automate',
        'rpa', 'gui', ZH.mouse, ZH.keyboard,
    ];
    if (automationKeywords.some((kw) => lower.includes(kw.toLowerCase()))) {
        return { suitable: false, reason: 'automation task is better served by direct execution', category: 'automation' };
    }

    const metaPatterns = [
        new RegExp(`^(?:${ZH.youCan}|${ZH.youHave}|${ZH.youAre}|${ZH.your}|${ZH.switchMode}|${ZH.setUp}|${ZH.configure})`),
        /^(switch|set|configure|change mode|change model)/i,
        new RegExp(`(?:${ZH.mode}|${ZH.settings}|${ZH.config}|${ZH.env}|version|${ZH.version})`),
    ];
    if (metaPatterns.some((pattern) => pattern.test(trimmed)) && trimmed.length < 60) {
        return { suitable: false, reason: 'meta or configuration conversation', category: 'meta' };
    }

    try {
        const quick = quickClassifyIntent(userInput);
        const intent = quick
            || (!shouldUseModelIntentClassification(userInput)
                ? buildConcreteTaskIntent(userInput)
                : await classifyIntent(api, userInput, model, signal));
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
    if (!shouldUseModelIntentClassification(userInput)) {
        return buildConcreteTaskIntent(userInput);
    }

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
