/**
 * Desktop Control — Control other applications on the system.
 *
 * Uses platform-native commands (PowerShell on Windows, osascript on macOS)
 * to capture screenshots, simulate keyboard/mouse, and manage windows.
 *
 * No new npm dependencies required — uses built-in child_process.
 */

import { exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// ── Helpers ──

/** Escape a string for safe use in shell commands (inside double quotes).
 *  Platform-aware: uses backslash on bash, backtick on PowerShell.
 *  Also strips newlines and null bytes to prevent injection. */
function shellEscape(s: string): string {
    const cleaned = s.replace(/\x00/g, '').replace(/[\r\n]+/g, ' ');
    if (process.platform === 'win32') {
        return cleaned.replace(/[`"$\\]/g, '`$&');
    }
    return cleaned.replace(/["$`\\]/g, '\\$&');
}

/** Escape a string for use inside single-quoted bash strings (e.g., osascript).
 *  Single-quoted strings cannot contain single quotes at all, so we use the
 *  concatenation trick: end quote, escaped quote, start quote. */
function shellEscapeSingle(s: string): string {
    return s.replace(/\x00/g, '').replace(/[\r\n]+/g, ' ').replace(/'/g, "'\\''");
}

function runCommand(cmd: string, timeoutMs = 15000): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve, reject) => {
        const shell = process.platform === 'win32' ? 'powershell' : 'bash';
        const shellArgs = process.platform === 'win32'
            ? ['-NoProfile', '-Command', cmd]
            : ['-c', cmd];

        const proc = require('child_process').spawn(shell, shellArgs, {
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        // Manual timeout since spawn() does not support the timeout option
        const timer = setTimeout(() => {
            try { proc.kill('SIGTERM'); } catch { /* ignore */ }
        }, timeoutMs);

        let stdout = '';
        let stderr = '';
        proc.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
        proc.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
        proc.on('close', (code: number) => { clearTimeout(timer); resolve({ stdout, stderr, code: code ?? 0 }); });
        proc.on('error', (e: Error) => { clearTimeout(timer); reject(e); });
    });
}

/**
 * Run a PowerShell .ps1 file directly (avoids bash interpretation of $_ etc.)
 */
function runPs1File(ps1Path: string, timeoutMs = 15000): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve, reject) => {
        const proc = require('child_process').spawn(
            'powershell',
            ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1Path],
            { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
        );
        // Manual timeout since spawn() does not support the timeout option
        const timer = setTimeout(() => {
            try { proc.kill('SIGTERM'); } catch { /* ignore */ }
        }, timeoutMs);
        let stdout = '';
        let stderr = '';
        proc.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
        proc.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
        proc.on('close', (code: number) => { clearTimeout(timer); resolve({ stdout, stderr, code: code ?? 0 }); });
        proc.on('error', (e: Error) => { clearTimeout(timer); reject(e); });
    });
}

// ── Screenshot ──

/**
 * Capture a screenshot of the screen or a specific window.
 * Returns the saved image path.
 */
export async function desktopScreenshot(options?: { windowTitle?: string; savePath?: string }): Promise<string> {
    const outputPath = options?.savePath || path.join(process.env.TEMP || '/tmp', `mimo-desktop-${Date.now()}.png`);

    if (process.platform === 'win32') {
        // Use PowerShell + System.Drawing to capture screen
        const psScript = options?.windowTitle
            ? `Add-Type -AssemblyName System.Drawing; Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class Win32 { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect); } [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; } $hwnd = [Win32]::GetForegroundWindow(); $rect = New-Object RECT; [Win32]::GetWindowRect($hwnd, [ref]$rect); $w = $rect.Right - $rect.Left; $h = $rect.Bottom - $rect.Top; $bmp = New-Object System.Drawing.Bitmap($w, $h); $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, [System.Drawing.Size]::new($w, $h)); $bmp.Save('${outputPath.replace(/\\/g, '\\\\')}'); $g.Dispose(); $bmp.Dispose(); Write-Output "OK"`
            : `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen | ForEach-Object { $bmp = New-Object System.Drawing.Bitmap($_.Bounds.Width, $_.Bounds.Height); $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($_.Bounds.Location, [System.Drawing.Point]::Empty, $_.Bounds.Size); $bmp.Save('${outputPath.replace(/\\/g, '\\\\')}'); $g.Dispose(); $bmp.Dispose() }; Write-Output "OK"`;

        const result = await runCommand(psScript, 20000);
        if (result.code === 0 && fs.existsSync(outputPath)) {
            return `Screenshot saved: ${outputPath}`;
        }
        return `Screenshot failed: ${result.stderr || result.stdout}`;
    } else if (process.platform === 'darwin') {
        const safeTitle = options?.windowTitle ? shellEscapeSingle(options.windowTitle) : '';
        const cmd = options?.windowTitle
            ? `screencapture -l$(osascript -e 'tell application "System Events" to set winList to every window whose name contains "${safeTitle}"' -e 'get id of first item of winList') "${outputPath}"`
            : `screencapture "${outputPath}"`;
        const result = await runCommand(cmd);
        if (result.code === 0 && fs.existsSync(outputPath)) {
            return `Screenshot saved: ${outputPath}`;
        }
        return `Screenshot failed: ${result.stderr}`;
    } else {
        // Linux: try scrot or import
        const cmd = `import -window root "${outputPath}" 2>/dev/null || scrot "${outputPath}"`;
        const result = await runCommand(cmd);
        if (fs.existsSync(outputPath)) {
            return `Screenshot saved: ${outputPath}`;
        }
        return `Screenshot failed: no screenshot tool found (install scrot or imagemagick)`;
    }
}

// ── Window Management ──

interface WindowInfo {
    title: string;
    pid: number;
    foreground: boolean;
}

/**
 * List all visible windows.
 */
export async function desktopWindows(): Promise<string> {
    if (process.platform === 'win32') {
        // Write temp PS1 to avoid $_ being interpreted by bash
        const psLines = [
            'Get-Process | Where-Object { $_.MainWindowTitle -ne "" } | ForEach-Object {',
            '    Write-Output ("  [" + $_.Id + "] " + $_.ProcessName + " — " + $_.MainWindowTitle)',
            '}',
        ];
        const tmpPs1 = path.join(process.env.TEMP || '/tmp', `mimo-windows-${Date.now()}.ps1`);
        fs.writeFileSync(tmpPs1, psLines.join('\n'), 'utf-8');
        try {
            const result = await runPs1File(tmpPs1, 10000);
            if (result.code !== 0) return `Failed to list windows: ${result.stderr}`;
            const windows = result.stdout.trim().split('\n').filter(Boolean);
            return windows.length > 0 ? `Open windows:\n${windows.join('\n')}` : 'No visible windows found';
        } finally {
            try { fs.unlinkSync(tmpPs1); } catch { /* ignore */ }
        }
    } else if (process.platform === 'darwin') {
        const result = await runCommand(`osascript -e 'tell application "System Events" to get name of every window of every process whose visible is true'`);
        return result.stdout.trim() || 'No windows found';
    } else {
        const result = await runCommand(`wmctrl -l 2>/dev/null || xdotool search --name "" 2>/dev/null`);
        return result.stdout.trim() || 'No window listing tool found (install wmctrl)';
    }
}

/**
 * Focus a window by partial title match.
 */
export async function desktopFocus(windowTitle: string): Promise<string> {
    if (process.platform === 'win32') {
        // Write temp PS1 to avoid $_ being interpreted by bash
        // Escape PowerShell special chars in double-quoted string: $, `, "
        const psSafe = windowTitle.replace(/`/g, '``').replace(/\$/g, '`$').replace(/"/g, '""');
        const psLines = [
            `$target = "${psSafe}"`,
            '$proc = Get-Process | Where-Object { $_.MainWindowTitle -like ("*" + $target + "*") } | Select-Object -First 1',
            'if ($proc) {',
            '    $shell = New-Object -ComObject WScript.Shell',
            '    $shell.AppActivate($proc.Id)',
            '    Write-Output "Focused: $($proc.MainWindowTitle)"',
            '} else {',
            '    Write-Output "Window not found: $target"',
            '}',
        ];
        const tmpPs1 = path.join(process.env.TEMP || '/tmp', `mimo-focus-${Date.now()}.ps1`);
        fs.writeFileSync(tmpPs1, psLines.join('\n'), 'utf-8');
        try {
            const result = await runPs1File(tmpPs1, 10000);
            return result.stdout.trim() || 'Focus command executed';
        } finally {
            try { fs.unlinkSync(tmpPs1); } catch { /* ignore */ }
        }
    } else if (process.platform === 'darwin') {
        const safe = shellEscapeSingle(windowTitle);
        const result = await runCommand(`osascript -e 'tell application "${safe}" to activate'`);
        return result.code === 0 ? `Focused: ${windowTitle}` : `Failed: ${result.stderr}`;
    } else {
        const safe = shellEscape(windowTitle);
        const result = await runCommand(`wmctrl -a "${safe}" 2>/dev/null || xdotool search --name "${safe}" windowactivate`);
        return result.code === 0 ? `Focused: ${windowTitle}` : `Failed: ${result.stderr}`;
    }
}

// ── Keyboard Simulation ──

/**
 * Type text via keyboard simulation.
 */
export async function desktopType(text: string): Promise<string> {
    if (process.platform === 'win32') {
        // Use PowerShell SendKeys for text input
        // Special characters need escaping for SendKeys
        const escaped = text
            .replace(/\+/g, '{+}')
            .replace(/\^/g, '{^}')
            .replace(/%/g, '{%}')
            .replace(/~/g, '{~}')
            .replace(/\(/g, '{(}')
            .replace(/\)/g, '{)}')
            .replace(/\[/g, '{[}')
            .replace(/\]/g, '{]}');

        const psScript = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escaped.replace(/'/g, "''")}')`;
        const result = await runCommand(psScript);
        return result.code === 0 ? `Typed: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}` : `Type failed: ${result.stderr}`;
    } else if (process.platform === 'darwin') {
        // Use osascript for text input
        const safeText = shellEscapeSingle(text);
        const result = await runCommand(`osascript -e 'tell application "System Events" to keystroke "${safeText}"'`);
        return result.code === 0 ? `Typed: ${text.substring(0, 50)}` : `Type failed: ${result.stderr}`;
    } else {
        const safeText = shellEscape(text);
        const result = await runCommand(`xdotool type "${safeText}" 2>/dev/null || echo "${safeText}" | xclip -selection clipboard && xdotool key ctrl+v`);
        return result.code === 0 ? `Typed: ${text.substring(0, 50)}` : `Type failed: ${result.stderr}`;
    }
}

/**
 * Press a keyboard shortcut or special key.
 *
 * Special keys: ENTER, TAB, ESC, BACKSPACE, DELETE, UP, DOWN, LEFT, RIGHT,
 *               F1-F12, SPACE, HOME, END, PAGEUP, PAGEDOWN
 * Combinations: CTRL+C, ALT+TAB, CTRL+SHIFT+S, etc.
 */
export async function desktopKey(keyCombo: string): Promise<string> {
    if (process.platform === 'win32') {
        const upper = keyCombo.toUpperCase();

        // WIN key needs Win32 API — SendKeys doesn't support it
        if (upper.includes('WIN')) {
            const keyPart = upper.includes('+') ? upper.split('+').pop() || 'D' : '';
            const vkMap: Record<string, number> = {
                'R': 0x52, 'D': 0x44, 'E': 0x45, 'I': 0x49, 'L': 0x4C, 'M': 0x4D,
                'P': 0x50, 'S': 0x53, 'A': 0x41, 'X': 0x58, 'V': 0x56, 'C': 0x43,
            };
            const vk = vkMap[keyPart] || (keyPart.charCodeAt(0));

            // Write PS1 to temp file to avoid bash backtick interpretation
            const psLines = [
                'Add-Type @"',
                'using System;',
                'using System.Runtime.InteropServices;',
                'public class KeyB {',
                '    [DllImport("user32.dll")] public static extern void keybd_event(byte bKey, byte bScan, int dwFlags, int dwExtraInfo);',
                '}',
                '"@',
                '$VK_LWIN = 0x5B',
                `[KeyB]::keybd_event($VK_LWIN, 0, 0, 0)`,
                `[KeyB]::keybd_event(0x${vk.toString(16).toUpperCase()}, 0, 0, 0)`,
                `[KeyB]::keybd_event(0x${vk.toString(16).toUpperCase()}, 0, 2, 0)`,
                `[KeyB]::keybd_event($VK_LWIN, 0, 2, 0)`,
                'Write-Output "OK"',
            ];
            const tmpPs1 = path.join(process.env.TEMP || '/tmp', `mimo-key-${Date.now()}.ps1`);
            fs.writeFileSync(tmpPs1, psLines.join('\n'), 'utf-8');
            try {
                const result = await runPs1File(tmpPs1, 5000);
                return result.code === 0 ? `Key pressed: ${keyCombo}` : `Key press failed: ${result.stderr}`;
            } finally {
                try { fs.unlinkSync(tmpPs1); } catch { /* ignore */ }
            }
        }

        // Convert common key names to SendKeys format
        let sendKey = keyCombo
            .replace(/ENTER/gi, '{ENTER}')
            .replace(/RETURN/gi, '{ENTER}')
            .replace(/TAB/gi, '{TAB}')
            .replace(/ESC(?:APE)?/gi, '{ESC}')
            .replace(/BACKSPACE/gi, '{BACKSPACE}')
            .replace(/DELETE/gi, '{DELETE}')
            .replace(/UP/gi, '{UP}')
            .replace(/DOWN/gi, '{DOWN}')
            .replace(/LEFT/gi, '{LEFT}')
            .replace(/RIGHT/gi, '{RIGHT}')
            .replace(/HOME/gi, '{HOME}')
            .replace(/END/gi, '{END}')
            .replace(/PAGEUP/gi, '{PGUP}')
            .replace(/PAGEDOWN/gi, '{PGDN}')
            .replace(/SPACE/gi, ' ')
            .replace(/F(\d+)/gi, '{F$1}')
            .replace(/CTRL\+/gi, '^')
            .replace(/ALT\+/gi, '%')
            .replace(/SHIFT\+/gi, '+');

        const psScript = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${sendKey.replace(/'/g, "''")}')`;
        const result = await runCommand(psScript);
        return result.code === 0 ? `Key pressed: ${keyCombo}` : `Key press failed: ${result.stderr}`;
    } else if (process.platform === 'darwin') {
        // Convert to AppleScript key codes
        let args = '';
        const parts = keyCombo.split('+');
        const key = parts.pop() || '';
        const mods = parts;

        if (mods.includes('CTRL')) args += 'control down, ';
        if (mods.includes('ALT') || mods.includes('OPTION')) args += 'option down, ';
        if (mods.includes('SHIFT')) args += 'shift down, ';
        if (mods.includes('CMD')) args += 'command down, ';

        const result = await runCommand(`osascript -e 'tell application "System Events" to key code ${getKeyCode(key)} ${args ? `using {${args.slice(0, -2)}}` : ''}'`);
        return result.code === 0 ? `Key pressed: ${keyCombo}` : `Key press failed: ${result.stderr}`;
    } else {
        const safeCombo = shellEscape(keyCombo.toLowerCase().replace(/\+/g, '+'));
        const result = await runCommand(`xdotool key "${safeCombo}"`);
        return result.code === 0 ? `Key pressed: ${keyCombo}` : `Key press failed: ${result.stderr}`;
    }
}

/**
 * macOS key code mapping (for AppleScript).
 */
function getKeyCode(key: string): number {
    const codes: Record<string, number> = {
        'a': 0, 's': 1, 'd': 2, 'f': 3, 'h': 4, 'g': 5, 'z': 6, 'x': 7,
        'c': 8, 'v': 9, 'b': 11, 'q': 12, 'w': 13, 'e': 14, 'r': 15,
        'y': 16, 't': 17, '1': 18, '2': 19, '3': 20, '4': 21, '6': 22,
        '5': 23, '=': 24, '9': 25, '7': 26, '-': 27, '8': 28, '0': 29,
        ']': 30, 'o': 31, 'u': 32, '[': 33, 'i': 34, 'p': 35, 'l': 37,
        'j': 38, "'": 39, 'k': 40, ';': 41, '\\': 42, ',': 43, '/': 44,
        'n': 45, 'm': 46, '.': 47, '`': 50, 'ENTER': 36, 'RETURN': 36,
        'TAB': 48, 'SPACE': 49, 'DELETE': 51, 'ESCAPE': 53, 'ESC': 53,
        'BACKSPACE': 51, 'UP': 126, 'DOWN': 125, 'LEFT': 123, 'RIGHT': 124,
        'HOME': 115, 'END': 119, 'PAGEUP': 116, 'PAGEDOWN': 121,
        'F1': 122, 'F2': 120, 'F3': 99, 'F4': 118, 'F5': 96, 'F6': 97,
        'F7': 98, 'F8': 100, 'F9': 101, 'F10': 109, 'F11': 103, 'F12': 111,
    };
    return codes[key] || 0;
}

// ── Mouse Simulation ──

/**
 * Click at absolute screen coordinates.
 * Requires Python pyautogui (commonly available).
 */
export async function desktopClick(x: number, y: number, button: 'left' | 'right' | 'middle' = 'left'): Promise<string> {
    const pyBtn = button === 'middle' ? 'middle' : button === 'right' ? 'right' : 'left';
    const cmd = process.platform === 'win32'
        ? `python -c "import pyautogui; pyautogui.click(${x}, ${y}, button='${pyBtn}')" 2>&1 || python3 -c "import pyautogui; pyautogui.click(${x}, ${y}, button='${pyBtn}')" 2>&1`
        : `python3 -c "import pyautogui; pyautogui.click(${x}, ${y}, button='${pyBtn}')" 2>&1 || python -c "import pyautogui; pyautogui.click(${x}, ${y}, button='${pyBtn}')" 2>&1`;

    const result = await runCommand(cmd, 10000);
    if (result.code === 0 && !result.stderr.includes('ModuleNotFoundError')) {
        return `Clicked ${button} at (${x}, ${y})`;
    }
    if (result.stderr.includes('ModuleNotFoundError')) {
        return `Click requires pyautogui. Install: pip install pyautogui`;
    }
    return `Click failed: ${result.stderr}`;
}

/**
 * Move mouse to absolute screen coordinates.
 */
export async function desktopMouseMove(x: number, y: number): Promise<string> {
    const cmd = process.platform === 'win32'
        ? `python -c "import pyautogui; pyautogui.moveTo(${x}, ${y})" 2>&1 || python3 -c "import pyautogui; pyautogui.moveTo(${x}, ${y})" 2>&1`
        : `python3 -c "import pyautogui; pyautogui.moveTo(${x}, ${y})" 2>&1 || python -c "import pyautogui; pyautogui.moveTo(${x}, ${y})" 2>&1`;

    const result = await runCommand(cmd, 10000);
    if (result.code === 0 && !result.stderr.includes('ModuleNotFoundError')) {
        return `Mouse moved to (${x}, ${y})`;
    }
    if (result.stderr.includes('ModuleNotFoundError')) {
        return `Mouse move requires pyautogui. Install: pip install pyautogui`;
    }
    return `Mouse move failed: ${result.stderr}`;
}

/**
 * Drag from one position to another.
 */
export async function desktopDrag(x1: number, y1: number, x2: number, y2: number, duration = 0.5): Promise<string> {
    const cmd = process.platform === 'win32'
        ? `python -c "import pyautogui; pyautogui.moveTo(${x1}, ${y1}); pyautogui.drag(${x2 - x1}, ${y2 - y1}, duration=${duration})" 2>&1`
        : `python3 -c "import pyautogui; pyautogui.moveTo(${x1}, ${y1}); pyautogui.drag(${x2 - x1}, ${y2 - y1}, duration=${duration})" 2>&1`;

    const result = await runCommand(cmd, 15000);
    if (result.code === 0 && !result.stderr.includes('ModuleNotFoundError')) {
        return `Dragged from (${x1}, ${y1}) to (${x2}, ${y2})`;
    }
    if (result.stderr.includes('ModuleNotFoundError')) {
        return `Drag requires pyautogui. Install: pip install pyautogui`;
    }
    return `Drag failed: ${result.stderr}`;
}

// ── App Launch ──

/**
 * Launch an application by name or path.
 * On Windows: uses Get-Command to find the exe, then Start-Process.
 * On macOS: uses open command.
 */
export async function desktopLaunch(appName: string, args?: string): Promise<string> {
    if (process.platform === 'win32') {
        // Escape single quotes for PowerShell single-quoted strings
        const psSafeApp = appName.replace(/'/g, "''");
        const psSafeArgs = args ? args.replace(/'/g, "''") : '';
        // Try to find and launch the app
        const psScript = `$cmd = Get-Command '${psSafeApp}' -ErrorAction SilentlyContinue
if ($cmd) {
    Start-Process -FilePath $cmd.Source ${psSafeArgs ? `-ArgumentList '${psSafeArgs}'` : ''} -ErrorAction Stop
    Write-Output "Launched: $($cmd.Source)"
} else {
    # Try as a full path
    if (Test-Path '${psSafeApp}') {
        Start-Process -FilePath '${psSafeApp}' ${psSafeArgs ? `-ArgumentList '${psSafeArgs}'` : ''} -ErrorAction Stop
        Write-Output "Launched: ${psSafeApp}"
    } else {
        # Try Start-Process which can find apps in PATH and known locations
        try {
            Start-Process '${psSafeApp}' ${psSafeArgs ? `-ArgumentList '${psSafeArgs}'` : ''} -ErrorAction Stop
            Write-Output "Launched: ${psSafeApp}"
        } catch {
            Write-Output "NOT_FOUND: Cannot find '${psSafeApp}'. Error: $($_.Exception.Message)"
        }
    }
}`;
        const result = await runCommand(psScript, 15000);
        if (result.stdout.includes('Launched:')) {
            return result.stdout.trim();
        }
        if (result.stdout.includes('NOT_FOUND') || result.stderr) {
            return `Cannot launch "${appName}": ${result.stdout || result.stderr}. Try providing the full path.`;
        }
        return result.stdout.trim() || `Launch command sent for: ${appName}`;
    } else if (process.platform === 'darwin') {
        const safeApp = shellEscape(appName);
        const cmd = args
            ? `open -a "${safeApp}" --args ${shellEscape(args)}`
            : `open -a "${safeApp}" 2>/dev/null || open "${safeApp}"`;
        const result = await runCommand(cmd);
        return result.code === 0 ? `Launched: ${appName}` : `Launch failed: ${result.stderr}`;
    } else {
        const safeApp = shellEscape(appName);
        const result = await runCommand(`"${safeApp}" ${args ? `"${shellEscape(args)}"` : ''} &`);
        return result.code === 0 ? `Launched: ${appName}` : `Launch failed: ${result.stderr}`;
    }
}
