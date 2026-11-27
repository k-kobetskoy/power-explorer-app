import { Injectable } from '@angular/core';
import { IAttributeValidator } from '../../abstract/i-attribute-validator';
import { AttributeEntityService } from '../../../entity-services/attribute-entity.service';
import { catchError, combineLatest, distinctUntilChanged, map, Observable, of, switchMap, takeUntil } from 'rxjs';
import { NodeAttribute } from 'src/app/components/query-builder/models/node-attribute';
import { VALID_RESULT, ValidationResult } from '../../../validation.service';
import { AttributeModel } from 'src/app/models/incoming/attrubute/attribute-model';

@Injectable({
  providedIn: 'root'
})
export class ToAttributeLinkEntityServerValidatorService implements IAttributeValidator {

constructor(private attributeService: AttributeEntityService) { }

  validate(attribute: NodeAttribute): Observable<ValidationResult> {
    const parentEntity = attribute.parentNode.getParentEntity();
    if (!parentEntity) {
      return of({
        isValid: false,
        errors: ['Please setup a parent entity']
      });
    }

    return parentEntity.attributes$.pipe(
      switchMap((attributes: NodeAttribute[]) => {
        const entityNameAttr = attributes.find(attr => attr.editorName === 'name');
  
        if (!entityNameAttr) {
          return of({
            isValid: false,
            errors: ['Please setup a parent entity']
          });
        }
  
        // The name is read when its validation result arrives, so the two always belong together
        const parentName$ = entityNameAttr.validationResult$.pipe(
          map(isValid => ({ isValid, entityLogicalName: entityNameAttr.value$.value }))
        );

        return combineLatest([
          attribute.value$.pipe(distinctUntilChanged()),
          parentName$
        ]).pipe(
          switchMap(([attributeName, { isValid, entityLogicalName }]) => {
            // `to` is optional in FetchXML and an empty one is not rendered
            if (!attributeName) {
              return of(VALID_RESULT);
            }
  
            if (!isValid.isValid) {
              return of({
                isValid: false,
                errors: ['Parent entity is not valid']
              });
            }
  
            const attrName = attributeName.toString().trim();
            const entityName = entityLogicalName.toString().trim();
  
            return this.attributeService.getJoinAttributes(entityName).pipe(
              map((attributes: AttributeModel[]) => {
                if (!attributes || attributes.length === 0) {
                  return {
                    isValid: false,
                    errors: [`Please verify the entity name.`]
                  };
                }
  
                const attributeWithProvidedName = attributes.find(attr =>
                  attr.logicalName.toLowerCase() === attrName.toLowerCase());
  
                return attributeWithProvidedName
                  ? VALID_RESULT
                  : {
                    isValid: false,
                    errors: [`'${attrName}' is not a valid attribute.`]
                  };
              }),
              catchError(error => {
                console.error('Error fetching attributes:', error);
                return of({
                  isValid: false,
                  errors: ['Error validating attribute. Please check attribute and entity configuration.']
                });
              })
            );
          })
        );
      }),
      takeUntil(attribute?.destroyed$),      
      catchError(error => {
        console.error('Error in attribute validation:', error);
        return of({
          isValid: false,
          errors: ['Validation error. Please check your configuration.']
        });
      })
    );
  }  
}
