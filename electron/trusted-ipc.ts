/**
 * IPC registration that serves only the app's own page. Every handler and listener goes through here.
 */

import { ipcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Mirrors what main.ts loads: the dev server, or index.html from the application folder.
// The router changes the path afterwards, so the exact file is not compared
let isAppUrl: (url: URL) => boolean = () => false;

export function trustAppPage(appRoot: string, devServerUrl: string | undefined): void {
    if (devServerUrl) {
        const devOrigin = new URL(devServerUrl).origin;
        isAppUrl = url => url.origin === devOrigin;
    } else {
        isAppUrl = url => {
            if (url.protocol !== 'file:') return false;
            const relative = path.relative(appRoot, fileURLToPath(url));
            return !relative.startsWith('..') && !path.isAbsolute(relative);
        };
    }
}

function isTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    const frame = event.senderFrame;
    try {
        // Top frame only: an embedded frame is not the app, whatever it shows
        return !!frame && !frame.parent && isAppUrl(new URL(frame.url));
    } catch {
        return false;
    }
}

export function handleTrusted(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown): void {
    ipcMain.handle(channel, (event, ...args) => {
        if (!isTrustedSender(event)) {
            console.warn(`[IPC] Rejected "${channel}" from an untrusted sender`);
            throw new Error('Untrusted IPC sender');
        }
        return listener(event, ...args);
    });
}

export function onTrusted(channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void): void {
    ipcMain.on(channel, (event, ...args) => {
        if (!isTrustedSender(event)) {
            console.warn(`[IPC] Rejected "${channel}" from an untrusted sender`);
            return;
        }
        listener(event, ...args);
    });
}
