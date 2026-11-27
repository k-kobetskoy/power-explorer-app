import { TestBed, fakeAsync, flush } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { BehaviorSubject } from 'rxjs';
import { ACTIVE_ACCOUNT_MODEL, ACTIVE_ENVIRONMENT_MODEL } from 'src/app/models/tokens';
import { AttributeData } from '../models/constants/attribute-data';
import { QueryNodeData } from '../models/constants/query-node-data';
import { NodeAttribute } from '../models/node-attribute';
import { QueryNode } from '../models/query-node';
import { LinkAttributesFactoryService } from './attribute-services/attribute-factories/link-attributes-factory.service';
import { NodeTreeService } from './node-tree.service';
import { ValidationResult } from './validation.service';

describe('Node validation with environment metadata', () => {
  const envUrl = 'https://test.example.invalid';
  let nodeTree: NodeTreeService;
  let http: HttpTestingController;
  let fetch: QueryNode;
  let entity: QueryNode;
  let treeResult: ValidationResult;

  const entities = {
    value: [
      { LogicalName: 'account', DisplayName: {}, EntitySetName: 'accounts' },
      { LogicalName: 'contact', DisplayName: {}, EntitySetName: 'contacts' },
    ]
  };
  const column = (LogicalName: string, AttributeType: string) => ({ LogicalName, DisplayName: {}, AttributeType });
  const formColumns = [column('name', 'String'), column('parentcustomerid', 'Customer'), column('primarycontactid', 'Lookup')];
  // As in Dataverse, primary keys are not valid for forms: a list filtered by IsValidForForm has none
  const primaryKeys = [column('accountid', 'Uniqueidentifier'), column('contactid', 'Uniqueidentifier')];
  const attributesFor = (url: string) => ({
    value: url.includes('IsValidForForm eq true') ? formColumns : [...formColumns, ...primaryKeys]
  });

  const isAttributesRequest = (url: string) => url.includes('/Attributes');

  /** Answers every pending metadata request and returns the URLs of the attribute requests. */
  function answerMetadata(): string[] {
    const urls: string[] = [];
    let pending: TestRequest[];

    do {
      pending = http.match(() => true).filter(request => !request.cancelled);
      for (const request of pending) {
        const url = request.request.url;
        if (isAttributesRequest(url)) {
          urls.push(url);
          request.flush(attributesFor(url));
        } else {
          request.flush(entities);
        }
      }
    } while (pending.length > 0);

    return urls;
  }

  function watch(node: QueryNode): () => ValidationResult {
    let last: ValidationResult;
    node.validationResult$.subscribe(result => last = result);
    return () => last;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ACTIVE_ENVIRONMENT_MODEL, useValue: new BehaviorSubject({ url: envUrl, apiUrl: envUrl, friendlyName: 'Test', urlName: 'test' }) },
        { provide: ACTIVE_ACCOUNT_MODEL, useValue: new BehaviorSubject(null) },
      ]
    });
    nodeTree = TestBed.inject(NodeTreeService);
    http = TestBed.inject(HttpTestingController);
    nodeTree.validationResult$.subscribe(result => treeResult = result);
    fetch = nodeTree.getNodeTree().value.root;
    entity = fetch.next;
    entity.setAttribute(AttributeData.Entity.Name, 'account');
    answerMetadata();
  });

  it('reports a link-entity without a name and makes the tree invalid', fakeAsync(() => {
    expect(treeResult.isValid).toBeTrue();

    const link = nodeTree.addNode(QueryNodeData.Link.NodeName, entity);
    const linkResult = watch(link);
    answerMetadata();

    expect(linkResult()).toEqual({ isValid: false, errors: ['Entity name is required.'] });
    expect(treeResult.isValid).toBeFalse();
    expect(treeResult.errors).toContain('Entity name is required.');

    link.setAttribute(AttributeData.Link.Entity, 'contact');
    answerMetadata();

    expect(linkResult().isValid).toBeTrue();
    expect(treeResult.isValid).toBeTrue();
    flush();
  }));

  it('counts the errors of attributes added after the node was created', fakeAsync(() => {
    const link = nodeTree.addNode(QueryNodeData.Link.NodeName, entity);
    const linkResult = watch(link);
    link.setAttribute(AttributeData.Link.Entity, 'contact');
    answerMetadata();
    expect(linkResult().isValid).toBeTrue();

    link.setAttribute(AttributeData.Link.From, 'nope');
    answerMetadata();

    expect(linkResult()).toEqual({ isValid: false, errors: ['Please setup a valid parent entity'] });
    expect(treeResult.isValid).toBeFalse();
    flush();
  }));

  for (const [from, to] of [['parentcustomerid', 'accountid'], ['contactid', 'primarycontactid']]) {
    it(`accepts a join on a primary key (from="${from}" to="${to}")`, fakeAsync(() => {
      const link = nodeTree.addNode(QueryNodeData.Link.NodeName, entity);
      const result = watch(link);
      link.setAttribute(AttributeData.Link.Entity, 'contact');
      link.setAttribute(AttributeData.Link.From, from);
      link.setAttribute(AttributeData.Link.To, to);

      const urls = answerMetadata();

      expect(urls.length).toBeGreaterThan(0);
      expect(urls.filter(url => url.includes('IsValidForForm'))).toEqual([]);
      expect(result()).toEqual({ isValid: true, errors: [] });
      expect(treeResult.isValid).toBeTrue();
      flush();
    }));
  }

  it('accepts empty from and to, which are optional', fakeAsync(() => {
    const link = nodeTree.addNode(QueryNodeData.Link.NodeName, entity);
    const result = watch(link);
    link.setAttribute(AttributeData.Link.Entity, 'contact');
    link.setAttribute(AttributeData.Link.From, null);
    link.setAttribute(AttributeData.Link.To, '');
    answerMetadata();

    expect(result()).toEqual({ isValid: true, errors: [] });
    flush();
  }));

  it('clears the error of a parsed link-type once the value is fixed', fakeAsync(() => {
    const link = nodeTree.addNode(QueryNodeData.Link.NodeName, entity);
    const result = watch(link);
    link.setAttribute(AttributeData.Link.Entity, 'contact');
    // parserValidation = true: the attribute is created the way Parse creates it
    link.addAttribute(TestBed.inject(LinkAttributesFactoryService)
      .createAttribute(AttributeData.Link.Type.EditorName, link, true, 'innr'));
    answerMetadata();
    expect(result()).toEqual({ isValid: false, errors: ['Invalid link type.'] });
    expect(treeResult.isValid).toBeFalse();

    for (const linkType of ['inner', 'in']) {
      link.setAttribute(AttributeData.Link.Type, linkType);
      expect(result()).withContext(linkType).toEqual({ isValid: true, errors: [] });
    }
    expect(treeResult.isValid).toBeTrue();

    link.setAttribute(AttributeData.Link.Type, 'oute');
    expect(result().errors).toEqual(['Invalid link type.']);
    flush();
  }));

  it('accepts a parsed documented link-type "in"', fakeAsync(() => {
    const link = nodeTree.addNode(QueryNodeData.Link.NodeName, entity);
    const result = watch(link);
    link.setAttribute(AttributeData.Link.Entity, 'contact');
    link.addAttribute(TestBed.inject(LinkAttributesFactoryService)
      .createAttribute(AttributeData.Link.Type.EditorName, link, true, 'in'));
    answerMetadata();

    expect(result()).toEqual({ isValid: true, errors: [] });
    flush();
  }));

  it('drops the alias error once the alias is added and restores it when the alias is removed', fakeAsync(() => {
    const attributeNode = nodeTree.addNode(QueryNodeData.Attribute.NodeName, entity);
    const result = watch(attributeNode);
    attributeNode.setAttribute(AttributeData.Attribute.Name, 'name');
    fetch.setAttribute(AttributeData.Root.Aggregate, 'true');
    answerMetadata();
    const missingAlias = 'Alias attribute is required when using aggregation.';
    expect(result().errors).toContain(missingAlias);

    attributeNode.setAttribute(AttributeData.Attribute.Alias, 'n');
    answerMetadata();
    expect(result()).toEqual({ isValid: true, errors: [] });
    expect(treeResult.isValid).toBeTrue();

    attributeNode.removeAttribute(AttributeData.Attribute.Alias.EditorName);
    answerMetadata();
    expect(result().errors).toContain(missingAlias);
    expect(treeResult.isValid).toBeFalse();
    flush();
  }));

  it('follows the root aggregate setting appearing and disappearing', fakeAsync(() => {
    const attributeNode = nodeTree.addNode(QueryNodeData.Attribute.NodeName, entity);
    const result = watch(attributeNode);
    attributeNode.setAttribute(AttributeData.Attribute.Name, 'name');
    attributeNode.setAttribute(AttributeData.Attribute.GroupBy, 'true');
    attributeNode.setAttribute(AttributeData.Attribute.Aggregate, 'count');
    attributeNode.setAttribute(AttributeData.Attribute.Alias, 'n');
    answerMetadata();
    expect(result().errors).toEqual(['Aggregate setting is not found', 'Aggregate setting is not found']);

    fetch.setAttribute(AttributeData.Root.Aggregate, 'true');
    answerMetadata();
    expect(result()).toEqual({ isValid: true, errors: [] });

    fetch.removeAttribute(AttributeData.Root.Aggregate.EditorName);
    answerMetadata();
    expect(result().errors).toContain('Aggregate setting is not found');
    flush();
  }));

  it('clears entitySetName$ when the entity name stops being valid', fakeAsync(() => {
    expect(entity.entitySetName$.value).toBe('accounts');

    entity.setAttribute(AttributeData.Entity.Name, 'accoun');
    expect(entity.entitySetName$.value).toBeNull();

    entity.setAttribute(AttributeData.Entity.Name, 'contact');
    expect(entity.entitySetName$.value).toBe('contacts');

    entity.removeAttribute(AttributeData.Entity.Name.EditorName);
    expect(entity.entitySetName$.value).toBeNull();
    flush();
  }));

  it('does not request attribute metadata for a previous entity name', fakeAsync(() => {
    entity.setAttribute(AttributeData.Entity.Name, 'nope');
    const attributeNode = nodeTree.addNode(QueryNodeData.Attribute.NodeName, entity);
    const link = nodeTree.addNode(QueryNodeData.Link.NodeName, entity);
    link.setAttribute(AttributeData.Link.Entity, 'contact');
    link.setAttribute(AttributeData.Link.To, 'accountid');
    attributeNode.setAttribute(AttributeData.Attribute.Name, 'name');
    expect(answerMetadata().filter(url => url.includes('nope'))).toEqual([]);

    entity.setAttribute(AttributeData.Entity.Name, 'account');
    const afterValid = answerMetadata();
    entity.setAttribute(AttributeData.Entity.Name, 'other');
    const afterInvalid = answerMetadata();

    expect(afterValid.length).toBeGreaterThan(0);
    expect([...afterValid, ...afterInvalid].filter(url => url.includes('nope') || url.includes('other'))).toEqual([]);
    flush();
  }));
});

describe('QueryNode attributes$', () => {
  let entity: QueryNode;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ACTIVE_ENVIRONMENT_MODEL, useValue: new BehaviorSubject(null) },
        { provide: ACTIVE_ACCOUNT_MODEL, useValue: new BehaviorSubject(null) },
      ]
    });
    entity = TestBed.inject(NodeTreeService).getNodeTree().value.root.next;
  });

  it('emits a new array on every change, with the value of a new attribute already set', () => {
    const emissions: { array: NodeAttribute[], values: string[] }[] = [];
    entity.attributes$.subscribe(array => emissions.push({ array, values: array.map(a => a.value$.value) }));

    entity.setAttribute(AttributeData.Entity.Alias, 'a');
    entity.setAttribute(AttributeData.Entity.Name, 'account');
    entity.removeAttribute(AttributeData.Entity.Alias.EditorName);

    expect(emissions.map(e => e.values)).toEqual([[], ['a'], ['account', 'a'], ['account']]);
    expect(emissions.map(e => e.array.length)).toEqual([0, 1, 2, 1]);
    expect(new Set(emissions.map(e => e.array)).size).toBe(4);
  });
});
