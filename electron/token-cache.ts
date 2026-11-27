import { app, safeStorage } from 'electron';
import { ICachePlugin, TokenCacheContext } from '@azure/msal-node';
import * as fs from 'fs';
import * as path from 'path';

/**
 * MSAL cache plugin. The cache holds refresh tokens, so it reaches the disk only encrypted with
 * safeStorage. Where encryption is not available nothing is written and the sign-in lasts until
 * the app is closed. Create it after the app is ready.
 */
export class EncryptedCachePlugin implements ICachePlugin {
    private readonly cachePath: string;
    // The unencrypted file written by earlier versions
    private readonly plaintextPath: string;
    private readonly encrypted: boolean;
    // Content of the unencrypted file when it cannot be re-written encrypted
    private carriedOver: string | null = null;
    private migration: Promise<void> | null = null;
    private writes: Promise<void> = Promise.resolve();

    constructor() {
        const userData = app.getPath('userData');
        this.cachePath = path.join(userData, 'msal-cache.bin');
        this.plaintextPath = path.join(userData, 'msal-cache.json');
        this.encrypted = canEncrypt();

        if (!this.encrypted) {
            console.warn('[TOKEN-CACHE] The operating system offers no encryption for the token cache. ' +
                'Nothing is saved to disk: you will have to sign in again after restarting the app.');
        }

        // Do not leave the old file around until the first token request
        this.migrate();
    }

    async beforeCacheAccess(cacheContext: TokenCacheContext): Promise<void> {
        await this.migrate();
        await this.writes;

        if (!this.encrypted) {
            // MSAL keeps it in memory from here on
            if (this.carriedOver) {
                cacheContext.tokenCache.deserialize(this.carriedOver);
                this.carriedOver = null;
            }
            return;
        }

        let data: Buffer;
        try {
            data = await fs.promises.readFile(this.cachePath);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                console.error('[TOKEN-CACHE] Could not read the cache:', (error as NodeJS.ErrnoException).code);
            }
            return;
        }

        try {
            cacheContext.tokenCache.deserialize(safeStorage.decryptString(data));
        } catch (error) {
            // Only the name: a parse error message quotes the content
            console.error('[TOKEN-CACHE] The cache is damaged and was removed, sign in again:', (error as Error)?.name);
            await this.remove(this.cachePath);
        }
    }

    async afterCacheAccess(cacheContext: TokenCacheContext): Promise<void> {
        if (!cacheContext.cacheHasChanged || !this.encrypted) return;

        const data = cacheContext.tokenCache.serialize();
        // One write at a time: they share the temporary file
        this.writes = this.writes.then(() => this.write(data)).catch(error => {
            console.error('[TOKEN-CACHE] Could not write the cache:', (error as NodeJS.ErrnoException)?.code);
        });
        await this.writes;
    }

    private migrate(): Promise<void> {
        this.migration ??= this.migratePlaintextCache().catch(error => {
            // The old file stays, so the next start tries again
            console.error('[TOKEN-CACHE] Could not migrate the unencrypted cache:', (error as NodeJS.ErrnoException)?.code);
        });
        return this.migration;
    }

    private async migratePlaintextCache(): Promise<void> {
        let data: string;
        try {
            data = await fs.promises.readFile(this.plaintextPath, 'utf-8');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
            throw error;
        }

        if (!isJson(data)) {
            console.error('[TOKEN-CACHE] The old cache is damaged and was removed, sign in again');
        } else if (!this.encrypted) {
            this.carriedOver = data;
        } else if (!fs.existsSync(this.cachePath)) {
            // An encrypted cache that is already there is kept, normally one whose migration could not
            // delete the old file. After a downgrade and another upgrade the old file is the newer one
            // and is dropped all the same: at worst the user signs in again
            await this.write(data);
        }

        await this.remove(this.plaintextPath);
    }

    private async write(data: string): Promise<void> {
        const temporaryPath = `${this.cachePath}.tmp`;
        await fs.promises.writeFile(temporaryPath, safeStorage.encryptString(data), { mode: 0o600 });
        await fs.promises.rename(temporaryPath, this.cachePath);
    }

    private async remove(filePath: string): Promise<void> {
        try {
            await fs.promises.rm(filePath, { force: true });
        } catch (error) {
            console.error('[TOKEN-CACHE] Could not remove a cache file:', (error as NodeJS.ErrnoException)?.code);
        }
    }
}

function canEncrypt(): boolean {
    // On Linux without a keyring Electron "encrypts" with a built-in password, which protects nothing
    return safeStorage.isEncryptionAvailable()
        && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text');
}

function isJson(data: string): boolean {
    try {
        JSON.parse(data);
        return true;
    } catch {
        return false;
    }
}
