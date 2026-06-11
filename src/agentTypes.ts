import { ChatMessage } from './api';
import { TokenUsage } from './tokenTracker';
import { WorkflowResult } from './workflow';

export interface StopGuardInfo {
    round: number;
    reason: string;
    summary?: string;
}

export interface TaskChangeFile {
    path: string;
    added: number;
    removed: number;
    binary?: boolean;
    staged?: boolean;
}

export interface TaskChangeSummary {
    id: string;
    files: TaskChangeFile[];
    totalAdded: number;
    totalRemoved: number;
    patch: string;
    createdAt: number;
    canUndo?: boolean;
    warning?: string;
}

export interface AgentEvents {
    onToken: (token: string) => void;
    onReasoning: (token: string) => void;
    onAssistantUpdate?: (text: string) => void;
    onVerificationUpdate?: (text: string, preservedDraft?: string) => void;
    onFinalAnswer?: (text: string) => void;
    onThoughtSummary?: (text: string) => void;
    onToolCallStart: (name: string, args: Record<string, any>) => void;
    onToolCallEnd: (name: string, result: string, isError: boolean, elapsed: number, gitDiff?: string) => void;
    onRoundStart: (round: number) => void;
    onRoundEnd: (round: number) => void;
    onDone: (response: string) => void;
    onError: (error: string) => void;
    onStatus: (status: string) => void;
    onModelSwitched?: (model: string, reason?: 'chat' | 'image') => void;
    onTokenUsage?: (usage: TokenUsage) => void;
    onEditPreview?: (previewId: string, path: string, oldText: string, newText: string, matchCount: number) => void;
    onWritePreview?: (previewId: string, filePath: string, content: string, isCreate: boolean) => void;
    onWorkflowStart?: (totalPhases: number, totalTasks: number) => void;
    onWorkflowPhaseStart?: (phaseIndex: number, title: string, mode: string, taskCount: number) => void;
    onWorkflowTaskStart?: (phaseIndex: number, taskIndex: number, label: string) => void;
    onWorkflowTaskEnd?: (phaseIndex: number, taskIndex: number, result: any) => void;
    onWorkflowPhaseEnd?: (phaseIndex: number, result: any) => void;
    onWorkflowEnd?: (result: WorkflowResult) => void;
    onAdversarialTurn?: (persona: 'programmer' | 'pm', name: string, icon: string, phase: 'speak' | 'tool' | 'review' | 'verdict', content: string, iteration: number) => void;
    onAdversarialToolStart?: (persona: 'programmer' | 'pm', toolName: string, args: Record<string, any>) => void;
    onAdversarialToolEnd?: (persona: 'programmer' | 'pm', toolName: string, result: string, isError: boolean, elapsed: number) => void;
    onAskUser?: (previewId: string, question: string, options: string[]) => void;
    onStopGuard?: (info: StopGuardInfo) => void;
}

export type AgentMode = 'auto' | 'polling' | 'plan' | 'adversarial' | 'infinite';

export interface ConversationState {
    id: string;
    title: string;
    messages: ChatMessage[];
    model: string;
    modelEndpointId?: string;
    uiLang?: 'en' | 'zh';
    planConfirmed?: boolean;
    mode: AgentMode;
    personaId?: string;
    activeSkillPrompt?: string;
    contextSummary?: string;
    contextSummaryMessageCount?: number;
    contextSummaryUpdatedAt?: number;
}

export interface TrackedIssue {
    id: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    file: string;
    line?: number;
    description: string;
    dimension: string;
    round: number;
    resolved: boolean;
    resolvedRound?: number;
}

export interface PendingEdit {
    previewId: string;
    path: string;
    oldText?: string;
    newText: string;
    lineStart?: number;
    lineEnd?: number;
    convId?: string;
    resolve: (result: string) => void;
}

export interface PendingWrite {
    previewId: string;
    path: string;
    content: string;
    convId?: string;
    resolve: (result: string) => void;
}

export interface PendingAsk {
    previewId: string;
    convId?: string;
    resolve: (answer: string) => void;
}

export interface RoundProgress {
    madeProgress: boolean;
    valuableProgress: boolean;
    errorOnly: boolean;
    reason: string;
    completedCount?: number;
    errorCount?: number;
    noProgressCount?: number;
    progressToolCount?: number;
    readOnlySuccessCount?: number;
}

export interface CompletionGateDecision {
    shouldContinue: boolean;
    reason: string;
}
