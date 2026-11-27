import { isDataverseHost } from '../../../electron/dataverse-hosts';
import { EnvironmentModel } from '../models/environment-model';

export type EnvironmentUrls = Pick<EnvironmentModel, 'url' | 'apiUrl' | 'urlName'>;

const HOST_NAME = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

/**
 * Turns what a user typed or pasted (host with or without https://, maybe a whole page address)
 * into the addresses of an environment. Returns null when it is not an https Dataverse host.
 */
export function parseEnvironmentUrl(input: string): EnvironmentUrls | null {
  const text = (input ?? '').trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }

  const host = parsed.hostname;
  if (parsed.protocol !== 'https:' || parsed.port || parsed.username || parsed.password || !HOST_NAME.test(host) || !isDataverseHost(host)) {
    return null;
  }

  return {
    url: `https://${host.replace('.api.', '.')}`,
    apiUrl: `https://${host}`,
    urlName: host.split('.')[0]
  };
}

/** Whether two models address the same environment, however their addresses are written. */
export function isSameEnvironment(first: EnvironmentModel, second: EnvironmentModel): boolean {
  const key = (model: EnvironmentModel) => parseEnvironmentUrl(model.apiUrl)?.url ?? model.apiUrl;
  return key(first) === key(second);
}

/** Whether a request origin belongs to the environment (its web address or its API address). */
export function isEnvironmentOrigin(origin: string, environment: EnvironmentModel): boolean {
  return [environment.url, environment.apiUrl].some(address => {
    try {
      return new URL(address).origin === origin;
    } catch {
      return false;
    }
  });
}
