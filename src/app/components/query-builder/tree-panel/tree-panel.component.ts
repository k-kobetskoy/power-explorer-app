// TreePanelComponent - Added to fix component declaration issue
import { ChangeDetectionStrategy, Component, OnInit, ViewEncapsulation } from '@angular/core';
import { Observable } from 'rxjs';

import { QueryNodeTree } from 'src/app/components/query-builder/models/query-node-tree';
import { NodeTreeService } from '../services/node-tree.service';
import { QueryNode } from '../models/query-node';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
@Component({
  selector: 'app-tree-panel',
  templateUrl: './tree-panel.component.html',
  styleUrls: ['./tree-panel.component.css'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
      CommonModule,
      MatIconModule,
      MatTooltipModule
  ],
})
export class TreePanelComponent implements OnInit {

dataSource$: Observable<QueryNodeTree>
selectedNode$: Observable<QueryNode>

constructor(
  private nodeTreeProcessor: NodeTreeService) { }

ngOnInit() {
  this.dataSource$ = this.nodeTreeProcessor.getNodeTree()
  this.selectedNode$ = this.nodeTreeProcessor.selectedNode$
}

selectNode(node: QueryNode) {
  this.nodeTreeProcessor.selectedNode$ = node
}

toggleNode(node: QueryNode) {
  this.nodeTreeProcessor.toggleNode(node)
}

removeNode(node: QueryNode) {
  this.nodeTreeProcessor.removeNode(node)
}

getNodeIcon(node: QueryNode) {
  if (node.tagName === 'fetch' || node.tagName === 'value') {
    return false
  }

  return true;
}
}
