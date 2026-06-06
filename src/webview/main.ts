/**
 * MiMo Agent Webview — Entry Point
 *
 * Initializes all components and registers the message handler
 * that dispatches host messages to the store and event bus.
 */

import { store } from './core/store';
import { bus } from './core/bus';
import { vscode } from './core/vscode';
import { Header } from './components/header';
import { Messages } from './components/messages';
import { InputArea } from './components/input';
import { Panels } from './components/panels';
import { CommandPalette } from './components/commandPalette';
import { ImageUpload } from './components/imageUpload';
import { setLang, getWelcomePair } from './core/i18n';

let activeReplayId = 0;

// ── Initialize welcome text ──
function initWelcome(): void {
    const desc = document.querySelector('.welcome-desc');
    const hint = document.querySelector('.welcome-hint');
    if (!desc || !hint) return;
    if (desc.textContent) return; // Already populated
    const seed = String(Date.now()) + Math.random();
    const pair = getWelcomePair(seed);
    desc.innerHTML = pair.desc;
    hint.innerHTML = pair.hint;
}

// ── Initialize components ──

function init(): void {
    console.log('[MiMo] initializing components...');

    Header.mount();
    Messages.mount();
    InputArea.mount();
    Panels.mount();
    CommandPalette.mount();
    ImageUpload.mount();

    // ── Initialize welcome text with random variant ──
    initWelcome();

    // ── Register message handler from extension host ──

    window.addEventListener('message', (e: MessageEvent) => {
        const msg = e.data;
        if (!msg || !msg.type) return;

        switch (msg.type) {
            // ── Tab management ──
            case 'tabList':
                store.set('tabs', msg.tabs);
                store.set('activeTabId', msg.activeId);
                bus.emit('tabList', msg.tabs, msg.activeId);
                break;

            case 'chatCreated':
                // No-op for now
                break;

            // ── Messages ──
            case 'userMessage':
                bus.emit('userMessage', msg.text, msg.images);
                break;

            case 'streamHtml':
                bus.emit('streamHtml', msg.html);
                break;

            case 'reasoning':
                bus.emit('reasoning', msg.token);
                break;

            case 'toolCallStart':
                bus.emit('toolCallStart', msg.name, msg.args);
                break;

            case 'toolCallEnd':
                bus.emit('toolCallEnd', msg.name, msg.result, msg.isError, msg.elapsed);
                break;

            case 'roundStart':
                bus.emit('roundStart', msg.round);
                break;

            case 'done':
                bus.emit('done', msg.response);
                break;

            case 'error':
                bus.emit('error', msg.error);
                break;

            case 'system':
                bus.emit('system', msg.text);
                break;

            case 'clearMessages':
                bus.emit('clearMessages');
                break;

            case 'historyReplayStart':
                activeReplayId = msg.replayId || activeReplayId + 1;
                break;

            case 'replayBatch':
                if (msg.replayId && msg.replayId !== activeReplayId) break;
                // Three-phase replay for correct ordering:
                // Phase 1: Process lightweight events (tool cards, markers, reasoning) — chunked with yields
                // Phase 2: Process heavy streamHtml events (pre-rendered markdown) — one per frame
                // Phase 3: Fire 'done' events — AFTER all streamHtml, so streamingMsg is intact
                if (msg.events && Array.isArray(msg.events)) {
                    const lightEvents: any[] = [];
                    const heavyEvents: any[] = [];
                    const doneEvents: any[] = [];
                    for (const evt of msg.events) {
                        if (evt.type === 'streamHtml') {
                            heavyEvents.push(evt);
                        } else if (evt.type === 'done') {
                            doneEvents.push(evt);
                        } else {
                            lightEvents.push(evt);
                        }
                    }

                    // Phase 1: Lightweight events — chunked to avoid blocking UI
                    // Process 15 events per frame (each triggers DOM manipulation)
                    const CHUNK_SIZE = 15;
                    let lightIdx = 0;
                    const processLightChunk = () => {
                        if (msg.replayId && msg.replayId !== activeReplayId) return;
                        const end = Math.min(lightIdx + CHUNK_SIZE, lightEvents.length);
                        for (let i = lightIdx; i < end; i++) {
                            const evt = lightEvents[i];
                            switch (evt.type) {
                                case 'userMessage': bus.emit('userMessage', evt.text, evt.images); break;
                                case 'reasoning': bus.emit('reasoning', evt.token); break;
                                case 'toolCallStart': bus.emit('toolCallStart', evt.name, evt.args); break;
                                case 'toolCallEnd': bus.emit('toolCallEnd', evt.name, evt.result, evt.isError, evt.elapsed); break;
                                case 'roundStart': bus.emit('roundStart', evt.round); break;
                            }
                        }
                        lightIdx = end;
                        if (lightIdx < lightEvents.length) {
                            requestAnimationFrame(processLightChunk);
                        } else {
                            // Phase 1 done — start Phase 2
                            processHeavyPhase2();
                        }
                    };

                    // Phase 2: Heavy streamHtml events — one per frame
                    const processHeavyPhase2 = () => {
                        if (heavyEvents.length === 0) {
                            fireDone();
                            return;
                        }
                        let hIdx = 0;
                        const processOne = () => {
                            if (msg.replayId && msg.replayId !== activeReplayId) return;
                            if (hIdx >= heavyEvents.length) {
                                fireDone();
                                return;
                            }
                            bus.emit('streamHtml', heavyEvents[hIdx].html);
                            hIdx++;
                            requestAnimationFrame(processOne);
                        };
                        requestAnimationFrame(processOne);
                    };

                    // Phase 3: Fire done events
                    const fireDone = () => {
                        if (msg.replayId && msg.replayId !== activeReplayId) return;
                        for (const evt of doneEvents) {
                            bus.emit('done', evt.response);
                        }
                    };

                    if (lightEvents.length > 0) {
                        requestAnimationFrame(processLightChunk);
                    } else {
                        processHeavyPhase2();
                    }
                }
                break;

            // ── Status ──
            case 'busy':
                bus.emit('busy');
                break;

            case 'idle':
                bus.emit('idle');
                break;

            case 'status':
                store.set('statusText', msg.text);
                document.getElementById('status-text')!.textContent = msg.text;
                break;

            // ── Model ──
            case 'modelList':
                store.set('models', msg.models || []);
                store.set('currentModel', msg.current);
                bus.emit('modelList', msg.models || [], msg.current);
                break;

            case 'modelCaps':
                store.set('modelCaps', msg.caps || { vision: false, tts: false, description: '' });
                bus.emit('modelCaps', msg.caps || {});
                break;

            case 'welcomeUpdate':
                bus.emit('welcomeUpdate', msg.desc, msg.hint);
                break;

            case 'restoreMode':
                store.set('currentMode', msg.mode);
                bus.emit('restoreMode', msg.mode, msg.label);
                break;

            case 'modelSwitched':
                // Auto-switched model (e.g., pro → v2.5 for vision)
                store.set('currentModel', msg.model);
                bus.emit('modelList', store.get('models'), msg.model);
                bus.emit('system', `Model auto-switched to ${msg.model} for image support`);
                break;

            // ── History ──
            case 'historyList':
                store.set('historyItems', msg.items || []);
                bus.emit('historyList', msg.items || []);
                break;

            case 'restoreInputHistory':
                store.set('inputHistory', Array.isArray(msg.items) ? msg.items.slice(0, 50) : []);
                store.set('historyIdx', -1);
                break;

            case 'exportResult':
                bus.emit('exportResult', msg.format, msg.content, msg.title);
                break;

            // ── Settings ──
            case 'settingsData':
                store.set('settingsData', msg.settings || {});
                bus.emit('settingsData', msg.settings || {});
                break;

            // ── Skills ──
            case 'skillList':
                bus.emit('skillList', msg.skills || []);
                break;

            // ── Token Usage ──
            case 'tokenUsage':
                bus.emit('tokenUsage', msg.usage);
                break;

            case 'conversationUsage':
                bus.emit('conversationUsage', msg.usage);
                break;

            // ── Edit Preview ──
            case 'editPreview':
                bus.emit('editPreview', msg.previewId, msg.path, msg.oldText, msg.newText, msg.matchCount);
                break;

            case 'writePreview':
                bus.emit('writePreview', msg.previewId, msg.filePath, msg.content, msg.isCreate);
                break;

            case 'askUser':
                bus.emit('askUser', msg.previewId, msg.question, msg.options);
                break;

            // ── Workflow ──
            case 'workflowStart':
                bus.emit('workflowStart', msg.totalPhases, msg.totalTasks);
                break;
            case 'workflowPhaseStart':
                bus.emit('workflowPhaseStart', msg.phaseIndex, msg.title, msg.mode, msg.taskCount);
                break;
            case 'workflowTaskStart':
                bus.emit('workflowTaskStart', msg.phaseIndex, msg.taskIndex, msg.label);
                break;
            case 'workflowTaskEnd':
                bus.emit('workflowTaskEnd', msg.phaseIndex, msg.taskIndex, msg.result);
                break;
            case 'workflowPhaseEnd':
                bus.emit('workflowPhaseEnd', msg.phaseIndex, msg.result);
                break;
            case 'workflowEnd':
                bus.emit('workflowEnd', msg.result);
                break;

            // ── Adversarial Mode ──
            case 'adversarialTurn':
                bus.emit('adversarialTurn', msg.persona, msg.name, msg.icon, msg.phase, msg.content, msg.iteration);
                break;
            case 'adversarialToolStart':
                bus.emit('adversarialToolStart', msg.persona, msg.toolName, msg.args);
                break;
            case 'adversarialToolEnd':
                bus.emit('adversarialToolEnd', msg.persona, msg.toolName, msg.result, msg.isError, msg.elapsed);
                break;

            // ── Message Queue ──
            case 'messageQueued':
                bus.emit('messageQueued', msg.text, msg.queueLength);
                break;
            case 'queueProcessed':
                bus.emit('queueProcessed', msg.remaining);
                break;
            case 'clearQueue':
                bus.emit('clearQueue');
                break;

            // ── Plan Mode ──
            case 'planReady':
                bus.emit('planReady', msg.planContent, msg.planPath);
                break;
            case 'convTitle':
                bus.emit('convTitle', msg.title, msg.convId);
                break;

            case 'setLang':
                setLang(msg.lang);
                // Update lang toggle button text
                const langBtn = document.getElementById('btn-lang');
                if (langBtn) langBtn.textContent = msg.lang === 'zh' ? 'EN' : 'ZH';
                break;
            case 'voiceResult':
                // Stop recording animation
                const voiceBtn2 = document.getElementById('voice-btn');
                if (voiceBtn2) {
                    voiceBtn2.classList.remove('recording');
                    voiceBtn2.title = 'Voice input';
                }
                store.set('isRecording', false);
                // Fill input with transcribed text
                if (msg.text && !msg.error) {
                    const inputEl = document.getElementById('input') as HTMLTextAreaElement;
                    if (inputEl) {
                        inputEl.value = msg.text;
                        inputEl.style.height = 'auto';
                        inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
                    }
                } else if (msg.error) {
                    bus.emit('system', `Voice error: ${msg.error}`);
                }
                break;
        }
    });

    // ── Signal ready to extension host ──
    console.log('[MiMo] sending ready...');
    vscode.ready();
}

// ── Bootstrap with error handling ──

try {
    init();
} catch (err: any) {
    console.error('[MiMo] init error:', err);
    const el = document.getElementById('messages');
    if (el) {
        const div = document.createElement('div');
        div.className = 'msg msg-system';
        div.textContent = `Init error: ${String(err.message)}`;
        el.appendChild(div);
    }
}
