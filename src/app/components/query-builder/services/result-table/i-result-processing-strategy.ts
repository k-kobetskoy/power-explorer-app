import { EntityAttributeMap } from '../entity-services/attribute-entity.service';
import { AttributeModel } from 'src/app/models/incoming/attrubute/attribute-model';
import { Observable } from 'rxjs';
import { MatTableRawData } from '../xml-executor.service';
/**
 * Interface for handling different result processing strategies
 */
export interface IResultProcessingStrategy {
  /**
   * Process raw data from the API and return a processed result
   * @param rawData The original raw data from the API
   * @param entityAttributeMap Map of entity logical names to their attribute data
   * @param primaryEntityName Primary entity name for URL generation 
   * @param environmentBrowserUrl URL prefix for generated links
   * @returns Observable of the processed result
   */
  processRawData(
    rawData: any[], 
    entityAttributeMap: EntityAttributeMap,
    primaryEntityName: string, 
    environmentBrowserUrl: string
  ): Observable<MatTableRawData>;
  
  /**
   * Load all attributes for the given entities
   * @param entityLogicalName The entity logical name to load attributes for
   * @returns Promise that resolves when all attributes are loaded
   */
  loadAllAttributes?(entityLogicalName: string): Promise<{ [attributeLogicalName: string]: AttributeModel }> ;
}
