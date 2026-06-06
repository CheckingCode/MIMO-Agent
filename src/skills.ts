import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface Skill {
    name: string;
    description: string;
    tools?: string[];
    prompt: string;
    /** Where this skill was loaded from */
    source: 'builtin' | 'user';
}

/**
 * Load skills from two locations:
 * 1. Built-in: <extensionPath>/skills/*.md
 * 2. User-defined: ~/.mimo/skills/*.md (overrides built-in with same name)
 */
export function loadSkills(extensionPath: string): Map<string, Skill> {
    const skills = new Map<string, Skill>();

    // Load built-in skills
    const builtinDir = path.join(extensionPath, 'skills');
    if (fs.existsSync(builtinDir)) {
        for (const file of fs.readdirSync(builtinDir)) {
            if (!file.endsWith('.md')) continue;
            try {
                const content = fs.readFileSync(path.join(builtinDir, file), 'utf-8');
                const skill = parseSkill(file, content, 'builtin');
                if (skill) skills.set(skill.name, skill);
            } catch { /* skip */ }
        }
    }

    // Load user skills (override built-in with same name)
    const userDir = path.join(os.homedir(), '.mimo', 'skills');
    if (fs.existsSync(userDir)) {
        for (const file of fs.readdirSync(userDir)) {
            if (!file.endsWith('.md')) continue;
            try {
                const content = fs.readFileSync(path.join(userDir, file), 'utf-8');
                const skill = parseSkill(file, content, 'user');
                if (skill) skills.set(skill.name, skill);
            } catch { /* skip */ }
        }
    }

    return skills;
}

/**
 * Save or update a user skill to ~/.mimo/skills/<name>.md
 */
export function saveUserSkill(skill: { name: string; description: string; tools?: string[]; prompt: string }): boolean {
    try {
        const userDir = path.join(os.homedir(), '.mimo', 'skills');
        if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });

        const frontmatter = [
            '---',
            `name: ${skill.name}`,
            `description: ${skill.description}`,
            skill.tools?.length ? `tools: [${skill.tools.join(', ')}]` : '',
            '---',
        ].filter(Boolean).join('\n');

        const content = `${frontmatter}\n\n${skill.prompt}`;
        fs.writeFileSync(path.join(userDir, `${skill.name}.md`), content, 'utf-8');
        return true;
    } catch {
        return false;
    }
}

/**
 * Delete a user skill from ~/.mimo/skills/<name>.md
 */
export function deleteUserSkill(name: string): boolean {
    try {
        const filePath = path.join(os.homedir(), '.mimo', 'skills', `${name}.md`);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            return true;
        }
        return false;
    } catch {
        return false;
    }
}

export function listSkills(skills: Map<string, Skill>): Skill[] {
    return Array.from(skills.values());
}

export function renderSkill(skill: Skill, input: string, workspace: string): string {
    return skill.prompt
        .replace(/\{\{input\}\}/g, input)
        .replace(/\{\{workspace\}\}/g, workspace);
}

function parseSkill(filename: string, content: string, source: 'builtin' | 'user' = 'builtin'): Skill | null {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);

    if (!match) {
        return {
            name: filename.replace(/\.md$/, ''),
            description: '',
            prompt: content.trim(),
            source,
        };
    }

    const meta = parseSimpleYaml(match[1]);
    return {
        name: meta.name || filename.replace(/\.md$/, ''),
        description: meta.description || '',
        tools: meta.tools || [],
        prompt: match[2].trim(),
        source,
    };
}

function parseSimpleYaml(text: string): Record<string, any> {
    const result: Record<string, any> = {};
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf(':');
        if (idx === -1) continue;
        const key = trimmed.slice(0, idx).trim();
        let value: any = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
        // Handle [list] format
        if (value.startsWith('[') && value.endsWith(']')) {
            value = value.slice(1, -1).split(',').map((v: string) => v.trim().replace(/^["']|["']$/g, ''));
        }
        result[key] = value;
    }
    return result;
}
