/**
 * Synthetic Dataverse Web API responses for FetchXML queries, modelled on the Microsoft documentation:
 * no live response was captured. All names and ids are fake.
 */

const FORMATTED = '@OData.Community.Display.V1.FormattedValue';
const LOOKUP = '@Microsoft.Dynamics.CRM.lookuplogicalname';
const ATTRIBUTE_NAME = '@OData.Community.Display.V1.AttributeName';

/** account with an aliased contact link that holds a lookup */
export const aliasedLink = {
  xml: `
    <fetch top="2">
      <entity name="account">
        <attribute name="name" />
        <attribute name="ownerid" />
        <link-entity name="contact" from="contactid" to="primarycontactid" link-type="inner" alias="pc">
          <attribute name="fullname" />
          <attribute name="parentcustomerid" />
          <attribute name="emailaddress1" />
        </link-entity>
      </entity>
    </fetch>`,
  rows: [
    {
      '@odata.etag': 'W/"1000001"',
      'name': 'Sample Account A',
      [`_ownerid_value${FORMATTED}`]: 'Sample User One',
      [`_ownerid_value${LOOKUP}`]: 'systemuser',
      '_ownerid_value': '00000000-0000-0000-0000-0000000000a1',
      'accountid': '00000000-0000-0000-0000-000000000a01',
      [`pc.fullname${ATTRIBUTE_NAME}`]: 'fullname',
      'pc.fullname': 'Sample Contact One',
      [`pc.parentcustomerid${FORMATTED}`]: 'Sample Account A',
      [`pc.parentcustomerid${LOOKUP}`]: 'account',
      'pc.parentcustomerid': '00000000-0000-0000-0000-000000000a01',
      'pc.emailaddress1': 'contact.one@example.invalid'
    },
    {
      '@odata.etag': 'W/"1000002"',
      'name': 'Sample Account B',
      [`_ownerid_value${FORMATTED}`]: 'Sample Team',
      [`_ownerid_value${LOOKUP}`]: 'team',
      '_ownerid_value': '00000000-0000-0000-0000-0000000000b1',
      'accountid': '00000000-0000-0000-0000-000000000a02',
      'pc.fullname': 'Sample Contact Two',
      [`pc.parentcustomerid${FORMATTED}`]: 'Sample Contact Parent',
      [`pc.parentcustomerid${LOOKUP}`]: 'contact',
      'pc.parentcustomerid': '00000000-0000-0000-0000-000000000c09'
    }
  ]
};

/** The same table joined twice with two aliases, plus a link without an alias */
export const twoAliasesAndUnaliased = {
  xml: `
    <fetch top="1">
      <entity name="account">
        <attribute name="name" />
        <link-entity name="systemuser" from="systemuserid" to="createdby" alias="cb">
          <attribute name="fullname" />
        </link-entity>
        <link-entity name="systemuser" from="systemuserid" to="modifiedby" alias="mb">
          <attribute name="fullname" />
        </link-entity>
        <link-entity name="contact" from="contactid" to="primarycontactid" link-type="outer">
          <attribute name="fullname" />
          <attribute name="jobtitle" />
        </link-entity>
      </entity>
    </fetch>`,
  /** @param prefix whether aliased links take a number in the generated aliases is not documented */
  rows: (prefix: string) => [{
    '@odata.etag': 'W/"1000010"',
    'name': 'Sample Account C',
    'accountid': '00000000-0000-0000-0000-000000000a03',
    'cb.fullname': 'Sample User One',
    'mb.fullname': 'Sample User Two',
    [`${prefix}.fullname`]: 'Sample Contact Three',
    [`${prefix}.jobtitle`]: 'Sample Title'
  }]
};

/** An outer join whose first row has no linked record: its properties are absent, not null */
export const outerJoin = {
  xml: (linkAlias: string) => `
    <fetch top="2">
      <entity name="account">
        <attribute name="name" />
        <link-entity name="contact" from="parentcustomerid" to="accountid" link-type="outer"${linkAlias}>
          <attribute name="fullname" />
          <attribute name="telephone1" />
        </link-entity>
        <order attribute="name" />
      </entity>
    </fetch>`,
  rows: (prefix: string) => [
    { '@odata.etag': 'W/"1000020"', 'name': 'Sample Account D', 'accountid': '00000000-0000-0000-0000-000000000a04' },
    {
      '@odata.etag': 'W/"1000021"',
      'name': 'Sample Account E',
      'accountid': '00000000-0000-0000-0000-000000000a05',
      [`${prefix}.fullname`]: 'Sample Contact Four',
      [`${prefix}.telephone1`]: '000-000-0000'
    }
  ]
};

/** An aggregate with groupby: columns are named by the aliases, rows have no id */
export const aggregate = {
  xml: `
    <fetch aggregate="true">
      <entity name="account">
        <attribute name="accountid" alias="AccountCount" aggregate="count" />
        <attribute name="numberofemployees" alias="Employees" aggregate="sum" />
        <attribute name="ownerid" alias="Owner" groupby="true" />
        <attribute name="industrycode" alias="Industry" groupby="true" />
        <order alias="Owner" />
      </entity>
    </fetch>`,
  rows: [
    {
      [`AccountCount${FORMATTED}`]: '3',
      'AccountCount': 3,
      [`Employees${FORMATTED}`]: '4,500',
      'Employees': 4500,
      [`Owner${FORMATTED}`]: 'Sample User One',
      [`Owner${LOOKUP}`]: 'systemuser',
      'Owner': '00000000-0000-0000-0000-0000000000a1',
      [`Industry${FORMATTED}`]: 'Sample Industry',
      'Industry': 7
    },
    {
      [`AccountCount${FORMATTED}`]: '1',
      'AccountCount': 1,
      [`Employees${FORMATTED}`]: '0',
      'Employees': 0,
      [`Owner${FORMATTED}`]: 'Sample Team',
      [`Owner${LOOKUP}`]: 'team',
      'Owner': '00000000-0000-0000-0000-0000000000b1'
    }
  ]
};
