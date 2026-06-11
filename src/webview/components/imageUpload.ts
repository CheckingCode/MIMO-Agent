/**
 * Image Upload component — file input, clipboard paste, preview, overlay.
 */
import { store, ImageData } from '../core/store';
import { bus } from '../core/bus';
import { vscode } from '../core/vscode';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const SAFE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']);

function isSafeImageFile(file: File): boolean {
    return SAFE_IMAGE_TYPES.has(file.type.toLowerCase()) && file.size <= MAX_IMAGE_BYTES;
}

function isSafeImageDataUrl(dataUrl: string): boolean {
    return /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(dataUrl)
        && dataUrl.length <= Math.ceil(MAX_IMAGE_BYTES * 1.4);
}

function extractImagesFromClipboardHtml(html: string): Array<{ dataUrl: string; name: string; size: number }> {
    const host = document.createElement('div');
    host.innerHTML = html;
    const images: Array<{ dataUrl: string; name: string; size: number }> = [];

    host.querySelectorAll('img').forEach((img, index) => {
        const dataUrl = String(img.getAttribute('src') || '').trim();
        if (!isSafeImageDataUrl(dataUrl)) return;
        const base64 = dataUrl.split(',', 2)[1] || '';
        const estimatedSize = Math.floor((base64.replace(/\s+/g, '').length * 3) / 4);
        images.push({
            dataUrl,
            name: img.getAttribute('alt') || img.getAttribute('title') || `image-${index + 1}`,
            size: estimatedSize,
        });
    });

    return images;
}

function extractTextFromClipboardHtml(html: string): string {
    const host = document.createElement('div');
    host.innerHTML = html;
    return (host.textContent || '').trim();
}

function insertTextAtCursor(input: HTMLTextAreaElement, text: string): void {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const before = input.value.slice(0, start);
    const after = input.value.slice(end);
    input.value = before + text + after;
    const cursor = before.length + text.length;
    input.setSelectionRange(cursor, cursor);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

export const ImageUpload = {
    mount(): void {
        const fileInput = document.getElementById('file-input') as HTMLInputElement;
        const imagePreview = document.getElementById('image-preview')!;
        const overlay = document.getElementById('img-overlay')!;
        const overlayImg = document.getElementById('overlay-img') as HTMLImageElement;
        const input = document.getElementById('input') as HTMLTextAreaElement;

        // Overlay dismiss
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.remove('show');
        });
        overlayImg.addEventListener('click', (e) => e.stopPropagation());

        // Show overlay on bus event
        bus.on('showOverlay', (src: string) => {
            overlayImg.src = src;
            overlay.classList.add('show');
        });

        // File input
        fileInput.addEventListener('change', () => {
            const files = fileInput.files;
            if (files) {
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    if (!isSafeImageFile(file)) {
                        bus.emit('system', `Skipped unsupported or too large image: ${file.name}`);
                        continue;
                    }
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        this.addImage(ev.target!.result as string, file.name, file.size);
                    };
                    reader.readAsDataURL(file);
                }
            }
            fileInput.value = '';
        });

        // Clipboard paste — always allow images (auto-switch handles model)
        input.addEventListener('paste', (e) => {
            const items = e.clipboardData?.items;
            const html = e.clipboardData?.getData('text/html') || '';
            const htmlImages = extractImagesFromClipboardHtml(html);

            if (htmlImages.length > 0) {
                e.preventDefault();
                for (const image of htmlImages) {
                    this.addImage(image.dataUrl, image.name, image.size);
                }
                const text = extractTextFromClipboardHtml(html);
                if (text) {
                    insertTextAtCursor(input, text);
                }
                return;
            }

            if (!items) return;
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image/') === 0) {
                    e.preventDefault();
                    const file = items[i].getAsFile();
                    if (!file) return;
                    if (!isSafeImageFile(file)) {
                        bus.emit('system', `Skipped unsupported or too large image: ${file.name || 'clipboard image'}`);
                        return;
                    }
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        this.addImage(ev.target!.result as string, file.name, file.size);
                    };
                    reader.readAsDataURL(file);
                    return;
                }
            }
        });

        // Clear images when store is cleared
        bus.on('clearImages', () => {
            store.set('images', []);
            this.renderPreviews();
        });
        bus.on('imagesChanged', () => {
            this.renderPreviews();
        });

        // Model capabilities
        bus.on('modelCaps', (caps: { vision: boolean }) => {
            store.set('visionEnabled', caps.vision);
        });
    },

    addImage(dataUrl: string, name: string, size: number): void {
        if (!isSafeImageDataUrl(dataUrl)) {
            bus.emit('system', `Skipped unsupported image: ${name || 'image'}`);
            return;
        }
        const images = store.get('images');
        images.push({ dataUrl, name: name || 'image', size: size || 0 });
        store.set('images', images);
        this.renderPreviews();
    },

    renderPreviews(): void {
        const imagePreview = document.getElementById('image-preview')!;
        const images = store.get('images');
        imagePreview.innerHTML = '';

        if (images.length === 0) {
            imagePreview.style.display = 'none';
            return;
        }
        imagePreview.style.display = 'inline-flex';

        for (let i = 0; i < images.length; i++) {
            const img = images[i];
            if (!isSafeImageDataUrl(img.dataUrl)) continue;
            const wrap = document.createElement('div');
            wrap.className = 'img-thumb';
            const imgEl = document.createElement('img');
            imgEl.src = img.dataUrl;
            imgEl.title = img.name || 'image';
            imgEl.addEventListener('click', () => bus.emit('showOverlay', img.dataUrl));
            const label = document.createElement('span');
            label.className = 'img-label';
            label.textContent = `#${i + 1}`;
            const remove = document.createElement('button');
            remove.className = 'img-rm';
            remove.title = 'Remove';
            remove.textContent = '\u00d7';
            remove.addEventListener('click', (e) => {
                e.stopPropagation();
                images.splice(i, 1);
                store.set('images', images);
                this.renderPreviews();
            });
            wrap.appendChild(imgEl);
            wrap.appendChild(label);
            wrap.appendChild(remove);
            imagePreview.appendChild(wrap);
        }

        const addBtn = document.createElement('div');
        addBtn.className = 'img-add';
        addBtn.textContent = '+';
        addBtn.title = 'Add more images';
        addBtn.addEventListener('click', () => (document.getElementById('file-input') as HTMLInputElement).click());
        imagePreview.appendChild(addBtn);
    },
};
