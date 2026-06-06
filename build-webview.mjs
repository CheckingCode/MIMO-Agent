import * as esbuild from 'esbuild';
import { copyFileSync } from 'fs';

await esbuild.build({
    entryPoints: ['src/webview/main.ts'],
    bundle: true,
    outfile: 'out/webview/app.js',
    format: 'iife',
    target: 'es2020',
    minify: false,
    sourcemap: false,
    logLevel: 'info',
});

// Copy styles.css to output
copyFileSync('src/webview/styles.css', 'out/webview/styles.css');
console.log('  src/webview/styles.css → out/webview/styles.css');
