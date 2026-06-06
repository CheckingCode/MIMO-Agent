/**
 * File Lock Utility — Cross-process file locking and atomic writes.
 *
 * Solves multi-window concurrency issues when multiple VSCode instances
 * share the same data files (~/.mimo/token-usage.json, history/*.json).
 */

import * as fs from 'fs';
import * as path from 'path';

const LOCK_TIMEOUT = 10000; // 10 seconds lock timeout
const LOCK_RETRY = 50;      // 50ms retry interval

/**
 * Cross-process file lock (based on .lock files).
 * Ensures only one process can write to a file at a time.
 */
export async function withFileLock<T>(filePath: string, fn: () => Promise<T> | T): Promise<T> {
    const lockPath = filePath + '.lock';
    const lockId = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Acquire lock
    const start = Date.now();
    while (true) {
        try {
            // Atomic lock file creation (wx mode: create only if not exists)
            fs.writeFileSync(lockPath, lockId, { flag: 'wx' });
            break;
        } catch (e: any) {
            if (e.code !== 'EEXIST') throw e;

            // Check if lock is expired (prevent deadlocks)
            try {
                const stat = fs.statSync(lockPath);
                if (Date.now() - stat.mtimeMs > LOCK_TIMEOUT) {
                    // Lock expired, force release
                    try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
                    continue;
                }
            } catch { /* file may have been deleted */ }

            if (Date.now() - start > LOCK_TIMEOUT) {
                // Timeout, force acquire lock
                try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
                continue;
            }

            await new Promise(r => setTimeout(r, LOCK_RETRY));
        }
    }

    try {
        return await fn();
    } finally {
        // Release lock (only if we own it)
        try {
            const current = fs.readFileSync(lockPath, 'utf-8');
            if (current === lockId) {
                fs.unlinkSync(lockPath);
            }
        } catch { /* ignore */ }
    }
}

/**
 * Atomic write (write to temp file, then rename).
 * Rename is atomic on most filesystems, preventing partial writes.
 */
export function atomicWriteSync(filePath: string, data: string, encoding: BufferEncoding = 'utf-8'): void {
    const tmpPath = filePath + '.tmp.' + process.pid;
    try {
        fs.writeFileSync(tmpPath, data, encoding);
        fs.renameSync(tmpPath, filePath); // rename is atomic
    } catch (e) {
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        throw e;
    }
}

/**
 * Synchronous file lock for operations that must be atomic.
 * Use withFileLock for async operations.
 */
export function withFileLockSync<T>(filePath: string, fn: () => T): T {
    const lockPath = filePath + '.lock';
    const lockId = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Acquire lock
    const start = Date.now();
    while (true) {
        try {
            fs.writeFileSync(lockPath, lockId, { flag: 'wx' });
            break;
        } catch (e: any) {
            if (e.code !== 'EEXIST') throw e;

            // Check if lock is expired
            try {
                const stat = fs.statSync(lockPath);
                if (Date.now() - stat.mtimeMs > LOCK_TIMEOUT) {
                    try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
                    continue;
                }
            } catch { /* file may have been deleted */ }

            if (Date.now() - start > LOCK_TIMEOUT) {
                try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
                continue;
            }

            // Busy wait for sync version
            const waitUntil = Date.now() + LOCK_RETRY;
            while (Date.now() < waitUntil) { /* spin */ }
        }
    }

    try {
        return fn();
    } finally {
        try {
            const current = fs.readFileSync(lockPath, 'utf-8');
            if (current === lockId) {
                fs.unlinkSync(lockPath);
            }
        } catch { /* ignore */ }
    }
}
