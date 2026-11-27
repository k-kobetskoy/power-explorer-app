import { shell } from 'electron';

const ALLOWED_PROTOCOLS = ['https:', 'mailto:'];

// The only place that hands a URL to the operating system. Other schemes could
// start a local program or a protocol handler, so they are rejected.
export async function openExternalLink(link: string): Promise<boolean> {
  let protocol: string;
  try {
    protocol = new URL(link).protocol;
  } catch {
    console.warn('[EXTERNAL-LINK] Rejected: not a valid URL');
    return false;
  }

  if (!ALLOWED_PROTOCOLS.includes(protocol)) {
    // Only the scheme is logged: the rest of the link may carry data
    console.warn(`[EXTERNAL-LINK] Rejected: scheme "${protocol}" is not allowed`);
    return false;
  }

  await shell.openExternal(link);
  return true;
}
