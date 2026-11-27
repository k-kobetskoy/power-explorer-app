import { dataverseOrigin, toEnvironmentModel } from '../../../electron/dataverse-hosts';
import { parseEnvironmentUrl } from './environment-url';

// The rule the main process enforces on what the window sends it
describe('Dataverse addresses', () => {
  const rejected = [
    'http://org.crm.dynamics.com',
    'https://org.crm.dynamics.com:8080',
    'https://user@org.crm.dynamics.com',
    'https://dynamics.com',
    'https://org.crm.evildynamics.com',
    'https://org.crm.dynamics.com.example.com',
    'https://example.com/.dynamics.com',
    'https://example.com?host=.dynamics.com',
    'https://example.com#.dynamics.com',
    'https://org.crm.dynamics.com@example.com',
    'https://org.crm.microsoftdynamics.us',
    'https://org.crm.dynamics.cn',
    'file:///C:/org.dynamics.com',
    'org.crm.dynamics.com'
  ];

  rejected.forEach(address => {
    it(`rejects "${address}"`, () => expect(dataverseOrigin(address)).toBeNull());
  });

  [
    'https://org.crm.dynamics.com',
    'https://org.crm.dynamics.com/',
    'HTTPS://Org.api.CRM9.Dynamics.com:443'
  ].forEach(address => {
    it(`accepts "${address}"`, () => expect(dataverseOrigin(address)).toBe(new URL(address).origin));
  });

  it('applies the same host rule in the connection dialog', () => {
    expect(parseEnvironmentUrl('org.crm.evildynamics.com')).toBeNull();
    expect(parseEnvironmentUrl('org.crm.microsoftdynamics.us')).toBeNull();
    expect(parseEnvironmentUrl('example.com')).toBeNull();
    expect(parseEnvironmentUrl('org.crm9.dynamics.com')).not.toBeNull();
  });

  describe('environment model', () => {
    const model = {
      url: 'https://org.crm.dynamics.com',
      apiUrl: 'https://org.api.crm.dynamics.com',
      friendlyName: 'My Environment',
      urlName: 'org'
    };

    it('accepts what the connection dialog builds', () => {
      const built = { ...parseEnvironmentUrl('org.api.crm.dynamics.com'), friendlyName: 'My Environment' };

      expect(toEnvironmentModel(built)).toEqual(model);
    });

    it('keeps only the known fields', () => {
      expect(toEnvironmentModel({ ...model, scopes: ['anything'] })).toEqual(model);
    });

    [
      null,
      undefined,
      'https://org.crm.dynamics.com',
      {},
      { ...model, url: 'https://example.com' },
      { ...model, apiUrl: 'https://example.com' },
      { ...model, apiUrl: 'https://org.crm.dynamics.com/path' },
      { ...model, apiUrl: ['https://org.crm.dynamics.com'] },
      { ...model, friendlyName: 1 },
      { ...model, urlName: undefined }
    ].forEach(value => {
      it(`rejects ${JSON.stringify(value)}`, () => expect(toEnvironmentModel(value)).toBeNull());
    });
  });
});
