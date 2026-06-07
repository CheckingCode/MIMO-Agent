/**
 * Tests for dependency install command classification and policy decisions.
 */
import { describe, it, expect, summary } from './test-runner';
import { classifyDependencyInstall, decideDependencyInstall } from '../dependencyInstall';

describe('classifyDependencyInstall', () => {
    it('should classify project dependency installs', () => {
        expect(classifyDependencyInstall('npm install')).toBe('project-dependency');
        expect(classifyDependencyInstall('pip install -r requirements.txt')).toBe('project-dependency');
        expect(classifyDependencyInstall('python -m pip install pytest')).toBe('project-dependency');
        expect(classifyDependencyInstall('go mod download')).toBe('project-dependency');
    });

    it('should classify system dependency installs', () => {
        expect(classifyDependencyInstall('winget install Python.Python.3.12')).toBe('system-dependency');
        expect(classifyDependencyInstall('choco install python')).toBe('system-dependency');
        expect(classifyDependencyInstall('brew install node')).toBe('system-dependency');
        expect(classifyDependencyInstall('apt-get install python3')).toBe('system-dependency');
    });

    it('should not classify ordinary commands as installs', () => {
        expect(classifyDependencyInstall('npm run test')).toBe('none');
        expect(classifyDependencyInstall('python --version')).toBe('none');
        expect(classifyDependencyInstall('pip list')).toBe('none');
    });
});

describe('decideDependencyInstall', () => {
    it('should allow project dependencies by default and raise timeout', () => {
        const decision = decideDependencyInstall('npm install', 120);
        expect(decision.kind).toBe('project-dependency');
        expect(decision.allowed).toBe(true);
        expect(decision.needsConfirm).toBe(false);
        expect(decision.timeoutSec).toBe(600);
    });

    it('should require confirmation for system dependencies by default', () => {
        const decision = decideDependencyInstall('winget install Python.Python.3.12', 120);
        expect(decision.kind).toBe('system-dependency');
        expect(decision.allowed).toBe(true);
        expect(decision.needsConfirm).toBe(true);
        expect(decision.timeoutSec).toBe(600);
    });

    it('should block project installs when projectMode is disabled', () => {
        const decision = decideDependencyInstall('pip install requests', 120, {
            projectMode: 'disabled',
        });
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('Project dependency installation is disabled');
    });

    it('should require confirmation when projectMode is confirm', () => {
        const decision = decideDependencyInstall('pnpm install', 120, {
            projectMode: 'confirm',
        });
        expect(decision.allowed).toBe(true);
        expect(decision.needsConfirm).toBe(true);
    });

    it('should block system installs when systemMode is disabled', () => {
        const decision = decideDependencyInstall('choco install git', 120, {
            systemMode: 'disabled',
        });
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('System software installation is disabled');
    });

    it('should preserve normal timeout for non-install commands', () => {
        const decision = decideDependencyInstall('npm run test', 42);
        expect(decision.kind).toBe('none');
        expect(decision.allowed).toBe(true);
        expect(decision.timeoutSec).toBe(42);
    });
});

summary();
