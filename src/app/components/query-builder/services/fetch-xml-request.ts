/** Pure helpers that prepare FetchXML for a GET request and page through its result. */

/** Dataverse limit for the URL of a GET request. */
export const MAX_REQUEST_URL_LENGTH = 32768;

// a comment, a CDATA section, a tag (quoted attribute values may contain '>') or a run of text
const XML_TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<(?:"[^"]*"|'[^']*'|[^'">])*>|[^<]+|</g;
const QUOTED_OR_WHITESPACE = /("[^"]*"|'[^']*')|\s+/g;
const TAG_ATTRIBUTE = /\s+([^\s=/<>]+)\s*=\s*("[^"]*"|'[^']*')/g;
const FETCH_OPENING_TAG = /<fetch(?=[\s/>])(?:"[^"]*"|'[^']*'|[^'">])*>/;

function tokenize(xml: string): string[] {
  return xml.match(XML_TOKEN) ?? [];
}

/**
 * Removes comments and collapses the formatting whitespace. Attribute values and element text
 * are data and stay exactly as written.
 */
export function sanitizeForTransmission(xml: string): string {
  // comments go first, so that the whitespace around a removed comment is collapsed as one run
  const withoutComments = tokenize(xml).filter(token => !token.startsWith('<!--')).join('');

  return tokenize(withoutComments)
    .map(token => {
      if (token.startsWith('<![CDATA[')) return token;
      if (token.startsWith('<')) {
        return token.replace(QUOTED_OR_WHITESPACE, (_, quoted: string) => quoted ?? ' ');
      }
      // indentation between tags; whitespace without a line break may be a value
      if (!token.trim()) return token.includes('\n') ? ' ' : token;
      return token;
    })
    .join('')
    .trim();
}

/**
 * The page this query asks for, or null when its result cannot be paged: `top` is incompatible with
 * paging and aggregate results are not paged either.
 */
export function getPageableQueryPage(xml: string): number | null {
  const fetch = new DOMParser().parseFromString(xml, 'text/xml').documentElement;

  if (fetch?.tagName !== 'fetch' || fetch.hasAttribute('top') || ['true', '1'].includes(fetch.getAttribute('aggregate'))) {
    return null;
  }

  return Number(fetch.getAttribute('page')) || 1;
}

/**
 * Asks for page 1 explicitly, as the Microsoft examples do: it is not documented that the paging
 * annotations are returned without it. A query that cannot be paged or sets `page` stays as it is.
 */
export function withFirstPage(xml: string): string {
  const setsPage = new DOMParser().parseFromString(xml, 'text/xml').documentElement?.hasAttribute('page');

  if (setsPage || getPageableQueryPage(xml) === null) {
    return xml;
  }

  return xml.replace(FETCH_OPENING_TAG, openingTag => openingTag.replace('<fetch', '<fetch page="1"'));
}

/**
 * Extracts the paging cookie from the `fetchxmlpagingcookie` annotation, an XML element whose
 * `pagingcookie` attribute is URL-encoded twice. Returns null when there is no usable cookie
 * (some queries only support simple paging).
 */
export function readPagingCookie(annotation: string): string | null {
  if (!annotation) return null;

  const encoded = new DOMParser().parseFromString(annotation, 'text/xml').documentElement?.getAttribute('pagingcookie');
  if (!encoded) return null;

  try {
    return decodeURIComponent(decodeURIComponent(encoded));
  } catch {
    return null;
  }
}

/** The same query asking for another page: sets `page` and `paging-cookie` on the fetch element. */
export function withPage(xml: string, page: number, pagingCookie: string | null): string {
  return xml.replace(FETCH_OPENING_TAG, openingTag => {
    const end = openingTag.endsWith('/>') ? '/>' : '>';
    const tag = openingTag
      .slice(0, -end.length)
      .replace(TAG_ATTRIBUTE, (attribute, name: string) => name === 'page' || name === 'paging-cookie' ? '' : attribute)
      .trimEnd();
    const cookie = pagingCookie ? ` paging-cookie="${escapeAttributeValue(pagingCookie)}"` : '';

    return `${tag} page="${page}"${cookie}${end}`;
  });
}

function escapeAttributeValue(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
