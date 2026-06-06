/**
 * Browser Automation — Headless browser for web interaction.
 * Uses puppeteer-core with system Chrome/Chromium.
 */

import * as path from 'path';
import * as fs from 'fs';

let browser: any = null;
let page: any = null;

/**
 * Find Chrome/Chromium executable on the system.
 */
function findChromePath(): string | null {
    const candidates = process.platform === 'win32'
        ? [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
            'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        ]
        : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
        ]
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
        ];

    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

/**
 * Launch browser if not already running.
 */
async function ensureBrowser(): Promise<any> {
    if (browser && browser.connected) return browser;

    const puppeteer = require('puppeteer-core');
    const chromePath = findChromePath();
    if (!chromePath) {
        throw new Error('Chrome/Chromium not found. Please install Chrome or set PUPPETEER_EXECUTABLE_PATH.');
    }

    browser = await puppeteer.launch({
        executablePath: chromePath,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    return browser;
}

/**
 * Ensure we have an active page.
 */
async function ensurePage(): Promise<any> {
    const b = await ensureBrowser();
    if (!page || page.isClosed()) {
        page = await b.newPage();
        await page.setViewport({ width: 1280, height: 720 });
    }
    return page;
}

// ── Public API ──

/**
 * Open a URL in the browser.
 */
export async function browserOpen(url: string): Promise<string> {
    const p = await ensurePage();
    try {
        await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const title = await p.title();
        return `Opened: ${url}\nTitle: ${title}`;
    } catch (e: any) {
        return `Error opening ${url}: ${e.message}`;
    }
}

/**
 * Click an element by CSS selector.
 */
export async function browserClick(selector: string): Promise<string> {
    const p = await ensurePage();
    try {
        await p.waitForSelector(selector, { timeout: 10000 });
        await p.click(selector);
        await new Promise(r => setTimeout(r, 1000)); // Wait for navigation
        return `Clicked: ${selector}`;
    } catch (e: any) {
        return `Error clicking ${selector}: ${e.message}`;
    }
}

/**
 * Type text into an input element.
 */
export async function browserType(selector: string, text: string): Promise<string> {
    const p = await ensurePage();
    try {
        await p.waitForSelector(selector, { timeout: 10000 });
        await p.click(selector);
        await p.type(selector, text);
        return `Typed "${text}" into ${selector}`;
    } catch (e: any) {
        return `Error typing into ${selector}: ${e.message}`;
    }
}

/**
 * Take a screenshot of the current page.
 */
export async function browserScreenshot(savePath?: string): Promise<string> {
    const p = await ensurePage();
    try {
        const outputPath = savePath || path.join(process.env.TEMP || '/tmp', `mimo-screenshot-${Date.now()}.png`);
        await p.screenshot({ path: outputPath, fullPage: false });
        return `Screenshot saved: ${outputPath}`;
    } catch (e: any) {
        return `Screenshot error: ${e.message}`;
    }
}

/**
 * Get the page content (text).
 */
export async function browserGetContent(): Promise<string> {
    const p = await ensurePage();
    try {
        const text = await p.evaluate(() => document.body?.innerText || '');
        return text.substring(0, 5000); // Limit to 5000 chars
    } catch (e: any) {
        return `Error getting content: ${e.message}`;
    }
}

/**
 * Close the browser.
 */
export async function browserClose(): Promise<string> {
    if (page) { await page.close().catch(() => {}); page = null; }
    if (browser) { await browser.close().catch(() => {}); browser = null; }
    return 'Browser closed';
}
