import { describe, it, expect, summary } from './test-runner';
import { executeTool } from '../tools';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('file tools outside workspace', () => {
    it('backs up an external file before editing it', async () => {
        const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'mimo-workspace-'));
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mimo-tools-'));
        const externalFile = path.join(tempDir, 'external.txt');
        fs.writeFileSync(externalFile, 'before', 'utf8');

        const result = await executeTool(
            'edit_file',
            { path: externalFile, old_text: 'before', new_text: 'after' },
            workspace,
            2000,
            10,
        );

        expect(result.includes('[backup]')).toBe(true);
        expect(fs.readFileSync(externalFile, 'utf8')).toBe('after');

        const backupRoot = path.join(workspace, '.mimo', 'backups');
        const backups = fs.existsSync(backupRoot)
            ? fs.readdirSync(backupRoot, { recursive: true }).map(String)
            : [];
        const backupName = backups.find(name => name.endsWith('external.txt.bak'));
        expect(!!backupName).toBe(true);
        expect(fs.readFileSync(path.join(backupRoot, backupName || ''), 'utf8')).toBe('before');
    });
});

summary();
