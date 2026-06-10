import { ConversationState } from './agentTypes';

export class AgentProgressSummary {
    buildProgressSummary(conv: ConversationState, reason: string, info?: { round?: number; maxRounds?: number; softMaxRounds?: number }): string {
        const title = String(conv.title || '').trim();
        const round = info?.round;
        const maxRounds = info?.maxRounds;
        const softMaxRounds = info?.softMaxRounds;
        const header = title ? `Current task: ${title}` : 'Current task in progress.';
        const detail = String(reason || '').trim() || 'Work is still in progress.';
        const roundBits = [
            typeof round === 'number' ? `round ${round}` : '',
            typeof softMaxRounds === 'number' ? `soft limit ${softMaxRounds}` : '',
            typeof maxRounds === 'number' ? `hard limit ${maxRounds}` : '',
        ].filter(Boolean).join(', ');
        return roundBits ? `${header}\n\n${detail}\n\nStatus: ${roundBits}.` : `${header}\n\n${detail}`;
    }

    buildUserFacingProgressSummary(conv: ConversationState, reason: string): string {
        const title = String(conv.title || '').trim();
        const prefix = title ? `Current task: ${title}` : 'Current task in progress.';
        const cleanReason = String(reason || '').trim();
        return cleanReason ? `${prefix}\n\n${cleanReason}` : prefix;
    }
}
