import { getPageableQueryPage, readPagingCookie, sanitizeForTransmission, withPage } from './fetch-xml-request';

describe('FetchXML request helpers', () => {
  it('keeps quotes and ">" in values intact', () => {
    const xml = `<fetch>\n  <condition value='say  "hi" > now' />\n  <value>O'Brien  Jr</value>\n  <value>  </value>\n</fetch>`;

    expect(sanitizeForTransmission(xml)).toBe(`<fetch> <condition value='say  "hi" > now' /> <value>O'Brien  Jr</value> <value>  </value> </fetch>`);
  });

  it('replaces the page and the cookie the query already has', () => {
    const xml = `<fetch count="3" page='2' paging-cookie="old"><entity name="account" /></fetch>`;

    expect(getPageableQueryPage(xml)).toBe(2);
    expect(withPage(xml, 3, '<c a="1" />')).toBe(
      '<fetch count="3" page="3" paging-cookie="&lt;c a=&quot;1&quot; /&gt;"><entity name="account" /></fetch>');
  });

  it('has no cookie for a missing or broken annotation', () => {
    expect(readPagingCookie(undefined)).toBeNull();
    expect(readPagingCookie('<cookie pagingcookie="%25E0%25A4" />')).toBeNull();
  });
});
