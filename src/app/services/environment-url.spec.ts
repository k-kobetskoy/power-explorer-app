import { EnvironmentModel } from '../models/environment-model';
import { isEnvironmentOrigin, isSameEnvironment, parseEnvironmentUrl } from './environment-url';

describe('environment URL', () => {
  const model = (apiUrl: string) => ({ apiUrl, url: apiUrl.replace('.api.', '.') }) as EnvironmentModel;

  describe('parseEnvironmentUrl', () => {
    const expected = {
      url: 'https://org.crm4.dynamics.com',
      apiUrl: 'https://org.crm4.dynamics.com',
      urlName: 'org'
    };

    [
      'org.crm4.dynamics.com',
      '  https://org.crm4.dynamics.com/  ',
      'HTTPS://Org.CRM4.Dynamics.com',
      'https://org.crm4.dynamics.com/main.aspx?appid=1#view',
      'org.crm4.dynamics.com:443'
    ].forEach(input => {
      it(`normalizes "${input}"`, () => expect(parseEnvironmentUrl(input)).toEqual(expected));
    });

    it('keeps the API address as typed and drops .api from the web address', () => {
      expect(parseEnvironmentUrl('https://org.api.crm.dynamics.com')).toEqual({
        url: 'https://org.crm.dynamics.com',
        apiUrl: 'https://org.api.crm.dynamics.com',
        urlName: 'org'
      });
    });

    [
      '',
      '   ',
      'org',
      'http://org.crm.dynamics.com',
      'https://https://org.crm.dynamics.com',
      'ftp://org.crm.dynamics.com',
      'org crm.dynamics.com',
      'user@org.crm.dynamics.com',
      'org.crm.dynamics.com:8080',
      '10.0.0.1'
    ].forEach(input => {
      it(`rejects "${input}"`, () => expect(parseEnvironmentUrl(input)).toBeNull());
    });
  });

  it('treats differently written addresses of one environment as the same', () => {
    expect(isSameEnvironment(model('https://org.crm.dynamics.com/'), model('https://ORG.api.crm.dynamics.com'))).toBeTrue();
    expect(isSameEnvironment(model('https://org.crm.dynamics.com'), model('https://other.crm.dynamics.com'))).toBeFalse();
  });

  it('matches a request origin against both addresses of an environment', () => {
    const environment = model('https://org.api.crm.dynamics.com');

    expect(isEnvironmentOrigin('https://org.crm.dynamics.com', environment)).toBeTrue();
    expect(isEnvironmentOrigin('https://org.api.crm.dynamics.com', environment)).toBeTrue();
    expect(isEnvironmentOrigin('https://org.crm.dynamics.com.example.com', environment)).toBeFalse();
    expect(isEnvironmentOrigin('http://org.crm.dynamics.com', environment)).toBeFalse();
  });
});
