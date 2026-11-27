import { Injectable } from '@angular/core';
import { IDataStorageService } from './abstract/i-data-storage-service';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root', })
export class CacheStorageService implements IDataStorageService {

  constructor() { 
  }

  getItem<T>(key: string): BehaviorSubject<T> {
    
    let item$ = this[key];
    if (!item$) {
      item$ = new BehaviorSubject<T>(null);
      this[key] = item$;
    } else {
    }
    return item$;
  }

  setItem<T>(item: T, key: string): void {

    let subject$: BehaviorSubject<T> = this[key];

    if (!subject$) {
      this[key] = new BehaviorSubject<T>(item);
      return;
    }

    subject$.next(item);
  }
}
