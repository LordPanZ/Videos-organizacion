/** Comparison operators supported by field filters. */
export type CompareOp = ':' | '=' | '!=' | '>' | '>=' | '<' | '<=';

export type QueryNode =
  | { type: 'and'; children: QueryNode[] }
  | { type: 'or'; children: QueryNode[] }
  | { type: 'not'; child: QueryNode }
  | { type: 'text'; value: string; phrase: boolean }
  | { type: 'field'; field: string; op: CompareOp; value: string; raw: string }
  | { type: 'true' };

export interface ParsedQuery {
  root: QueryNode;
  warnings: string[];
}

export const TRUE_NODE: QueryNode = { type: 'true' };

/** Walks the tree depth-first, visiting every node once. */
export function walk(node: QueryNode, visit: (node: QueryNode) => void): void {
  visit(node);
  switch (node.type) {
    case 'and':
    case 'or':
      for (const child of node.children) walk(child, visit);
      break;
    case 'not':
      walk(node.child, visit);
      break;
    default:
      break;
  }
}

/** Collects every field filter present in a parsed query. */
export function collectFields(node: QueryNode): Extract<QueryNode, { type: 'field' }>[] {
  const found: Extract<QueryNode, { type: 'field' }>[] = [];
  walk(node, (n) => {
    if (n.type === 'field') found.push(n);
  });
  return found;
}

/** True when the query imposes no constraints at all. */
export function isEmptyQuery(node: QueryNode): boolean {
  if (node.type === 'true') return true;
  if (node.type === 'and' || node.type === 'or') return node.children.every(isEmptyQuery);
  return false;
}
