/**
 * Which addresses count as a Dataverse environment. Used by the main process, which enforces it,
 * and by the connection dialog, so no Node or Electron imports here.
 */

import type { EnvironmentModel } from './types';

// Host name endings of the commercial and GCC clouds. Other sovereign clouds need their own
// sign-in authority besides an entry here
export const DATAVERSE_HOST_SUFFIXES = ['.dynamics.com'];

export function isDataverseHost(hostname: string): boolean {
    return DATAVERSE_HOST_SUFFIXES.some(suffix => hostname.endsWith(suffix));
}

/** The origin of an https address of a Dataverse host without port, path or credentials; null otherwise. */
export function dataverseOrigin(address: unknown): string | null {
    if (typeof address !== 'string') return null;

    let parsed: URL;
    try {
        parsed = new URL(address);
    } catch {
        return null;
    }

    const bare = parsed.protocol === 'https:' && !parsed.port && !parsed.username && !parsed.password
        && parsed.pathname === '/' && !parsed.search && !parsed.hash;

    return bare && isDataverseHost(parsed.hostname) ? parsed.origin : null;
}

/** A copy of the known fields of a model received from outside, or null when it is not a valid one. */
export function toEnvironmentModel(value: unknown): EnvironmentModel | null {
    const model = value as EnvironmentModel;
    if (!model || !dataverseOrigin(model.url) || !dataverseOrigin(model.apiUrl)
        || typeof model.friendlyName !== 'string' || typeof model.urlName !== 'string') {
        return null;
    }

    const { url, apiUrl, friendlyName, urlName } = model;
    return { url, apiUrl, friendlyName, urlName };
}
