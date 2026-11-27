import { Injectable } from '@angular/core';
import { syntaxTree } from "@codemirror/language"
import { Extension } from '@codemirror/state';
import { linter, Diagnostic } from "@codemirror/lint"
import { XmlValidationService } from './xml-validation.service';

@Injectable({ providedIn: 'root' })

export class LinterProviderService {

  constructor(private tagsValidator: XmlValidationService) { }

  getLinter(): Extension {
    return linter(view => {

      let xmlValidationErrors: Diagnostic[] = [];

      let tagsValidationStack: { mandatoryNodes: string[], from: number, to: number }[] = [];
      let sequenceValidationStack: string[] = [];

      syntaxTree(view.state).cursor().iterate(iteratingNode => {
        // Always validate the XML syntax
        this.tagsValidator.validateTagNode(iteratingNode, tagsValidationStack, xmlValidationErrors, sequenceValidationStack, view)
      });

      if (xmlValidationErrors.length > 0) {
        // Filter out unwanted text errors that are inside value tags
        const filteredErrors = xmlValidationErrors.filter(error => {
          if (error.message === 'Unwanted text') {
            // Get text before and after the error position
            const contextBefore = view.state.sliceDoc(
              Math.max(0, error.from - 30), 
              error.from
            );
            const contextAfter = view.state.sliceDoc(
              error.to, 
              Math.min(view.state.doc.length, error.to + 30)
            );
            
            // Check if this text is inside value tags
            const isInValueTag = 
              contextBefore.toLowerCase().includes('<value') && 
              contextAfter.toLowerCase().includes('</value');
              
            // If it's in a value tag, filter out the error
            return !isInValueTag;
          }
          return true;
        });
        
        return filteredErrors;
      }

      return [];
    });
  }
}
