/**
 * Command Palette — slash command autocomplete.
 * Dynamically includes skills from the extension host.
 */
import { bus } from '../core/bus';
import { escapeHtml } from '../utils/dom';

interface Command {
    name: string;
    desc: string;
}

const BUILTIN_COMMANDS: Command[] = [
    { name: '/clear', desc: 'Clear conversation' },
];

/** Commands populated from skills loaded by the host */
let dynamicCommands: Command[] = [];

export const CommandPalette = {
    filtered: [] as Command[],
    activeIdx: -1,

    /** Get all commands: builtin + dynamic skills */
    getAllCommands(): Command[] {
        return [...BUILTIN_COMMANDS, ...dynamicCommands];
    },

    mount(): void {
        const input = document.getElementById('input') as HTMLTextAreaElement;
        const palette = document.getElementById('cmd-palette')!;

        // Listen for skill list updates from host
        bus.on('skillList', (skills: Array<{ name: string; description: string }>) => {
            dynamicCommands = skills.map(s => ({
                name: `/${s.name}`,
                desc: s.description || s.name,
            }));
        });

        // Input handler — show palette on /
        input.addEventListener('input', () => {
            const val = input.value;
            if (val.startsWith('/')) {
                const sp = val.indexOf(' ');
                const query = sp > 0 ? val.substring(0, sp) : val;
                this.show(query);
            } else {
                this.hide();
            }
        });

        // Keyboard navigation
        input.addEventListener('keydown', (e) => {
            if (!palette.classList.contains('show')) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.activeIdx = Math.min(this.activeIdx + 1, this.filtered.length - 1);
                this.render();
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.activeIdx = Math.max(this.activeIdx - 1, 0);
                this.render();
                return;
            }
            if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                e.preventDefault();
                this.accept();
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                this.hide();
                return;
            }
        });

        // Hide on click outside
        document.addEventListener('click', () => this.hide());
    },

    show(query: string): void {
        this.filtered = this.getAllCommands().filter((c) => c.name.startsWith(query));
        if (this.filtered.length === 0) { this.hide(); return; }
        this.activeIdx = 0;
        this.render();
        document.getElementById('cmd-palette')!.classList.add('show');
    },

    hide(): void {
        document.getElementById('cmd-palette')!.classList.remove('show');
        this.activeIdx = -1;
        this.filtered = [];
    },

    render(): void {
        const palette = document.getElementById('cmd-palette')!;
        palette.innerHTML = '';
        for (let i = 0; i < this.filtered.length; i++) {
            const item = document.createElement('div');
            item.className = 'cmd-item' + (i === this.activeIdx ? ' active' : '');
            item.innerHTML = `<span class="cmd-name">${escapeHtml(this.filtered[i].name)}</span><span class="cmd-desc">${escapeHtml(this.filtered[i].desc)}</span>`;
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                (document.getElementById('input') as HTMLTextAreaElement).value = this.filtered[i].name + ' ';
                (document.getElementById('input') as HTMLTextAreaElement).focus();
                this.hide();
            });
            palette.appendChild(item);
        }
    },

    accept(): void {
        if (this.activeIdx >= 0 && this.activeIdx < this.filtered.length) {
            (document.getElementById('input') as HTMLTextAreaElement).value = this.filtered[this.activeIdx].name + ' ';
            this.hide();
        }
    },
};
