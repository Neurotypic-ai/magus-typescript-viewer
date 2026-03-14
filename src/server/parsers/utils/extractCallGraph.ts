/**
 * Call graph extraction utility.
 *
 * Performs best-effort static analysis of function/method bodies to identify
 * function-to-function call relationships within and across modules.
 * Uses jscodeshift to find CallExpression and NewExpression nodes and
 * classifies each call by type (direct function, method, constructor, static).
 */

import type { ASTNode, JSCodeshift } from 'jscodeshift';

/**
 * Represents a single caller-to-callee edge in the call graph.
 */
export interface CallEdge {
  /** ID or name of the calling function/method */
  callerId: string;
  /** Name of the calling function/method */
  callerName: string;
  /** The called function/method name */
  calleeName: string;
  /** Optional qualifier (e.g., 'this', variable name, class name) */
  qualifier?: string;
  /** Type of call */
  callType: 'function' | 'method' | 'constructor' | 'static';
  /** Line number of the call */
  line?: number;
}

/**
 * Dedupe key for a CallEdge. Two edges with the same key are considered
 * duplicates and only the first is kept.
 */
function edgeKey(edge: CallEdge): string {
  return `${edge.callerId}|${edge.calleeName}|${edge.qualifier ?? ''}|${edge.callType}`;
}

/**
 * Determine whether a name looks like a class/constructor (starts with uppercase).
 */
function looksLikeClassName(name: string): boolean {
  return /^[A-Z]/.test(name);
}

/**
 * Extract call edges from a function body AST node.
 *
 * This performs a best-effort static analysis without type information.
 * It walks every `CallExpression` and `NewExpression` inside the given
 * AST node and classifies the callee into one of four categories:
 *
 * - **function** -- bare identifier call, e.g. `foo()`
 * - **method** -- member expression call on `this`, e.g. `this.bar()`
 * - **static** -- member expression call on a class-like name, e.g. `Array.from()`
 * - **constructor** -- `new Foo()`
 *
 * Edges are deduplicated: if the same caller calls the same callee with the
 * same qualifier and call type, only the first occurrence is kept.
 *
 * @param j - jscodeshift API instance
 * @param functionBody - the AST node to search (typically a function body or the whole function node)
 * @param callerId - unique identifier for the calling function/method
 * @param callerName - human-readable name of the calling function/method
 * @returns array of deduplicated CallEdge objects
 */
export function extractCallEdges(
  j: JSCodeshift,
  functionBody: ASTNode,
  callerId: string,
  callerName: string,
): CallEdge[] {
  const edges: CallEdge[] = [];
  const seen = new Set<string>();

  function addEdge(edge: CallEdge): void {
    const key = edgeKey(edge);
    if (seen.has(key)) return;
    seen.add(key);
    edges.push(edge);
  }

  // --- CallExpression (regular calls) ---
  j(functionBody)
    .find(j.CallExpression)
    .forEach((path) => {
      const { callee } = path.node;
      const line = path.node.loc?.start.line;

      if (callee.type === 'Identifier') {
        // Direct function call: foo()
        addEdge({
          callerId,
          callerName,
          calleeName: callee.name,
          callType: 'function',
          line,
        });
      } else if (callee.type === 'MemberExpression') {
        // Member expression call: obj.method()
        const property = callee.property;
        let methodName: string | undefined;

        if (property.type === 'Identifier') {
          methodName = property.name;
        }

        if (!methodName) return;

        const object = callee.object;

        if (object.type === 'ThisExpression') {
          // this.bar()
          addEdge({
            callerId,
            callerName,
            calleeName: methodName,
            qualifier: 'this',
            callType: 'method',
            line,
          });
        } else if (object.type === 'Identifier') {
          // SomeClass.method() or obj.method()
          const callType = looksLikeClassName(object.name) ? 'static' : 'method';
          addEdge({
            callerId,
            callerName,
            calleeName: methodName,
            qualifier: object.name,
            callType,
            line,
          });
        } else {
          // Chained or complex expression: a.b.method(), getObj().method(), etc.
          // We still capture the method name but without a qualifier
          addEdge({
            callerId,
            callerName,
            calleeName: methodName,
            callType: 'method',
            line,
          });
        }
      }
    });

  // --- NewExpression (constructor calls) ---
  j(functionBody)
    .find(j.NewExpression)
    .forEach((path) => {
      const { callee } = path.node;
      const line = path.node.loc?.start.line;

      if (callee.type === 'Identifier') {
        addEdge({
          callerId,
          callerName,
          calleeName: callee.name,
          callType: 'constructor',
          line,
        });
      } else if (callee.type === 'MemberExpression') {
        // new module.Foo() -- extract the property name
        const property = callee.property;
        if (property.type === 'Identifier') {
          let qualifier: string | undefined;
          if (callee.object.type === 'Identifier') {
            qualifier = callee.object.name;
          }
          addEdge({
            callerId,
            callerName,
            calleeName: property.name,
            qualifier,
            callType: 'constructor',
            line,
          });
        }
      }
    });

  return edges;
}

/**
 * Build a complete call graph from multiple modules' call edges.
 *
 * Collects all unique node identifiers (callerIds and callee references)
 * and builds an adjacency list keyed by callerId.
 *
 * @param allEdges - combined call edges from all modules
 * @returns an object with:
 *   - `nodes` -- set of all unique node identifiers (callerIds and composite callee keys)
 *   - `edges` -- the deduplicated input edges
 *   - `adjacency` -- map from callerId to its outgoing CallEdge array
 */
export function buildCallGraph(allEdges: CallEdge[]): {
  nodes: Set<string>;
  edges: CallEdge[];
  adjacency: Map<string, CallEdge[]>;
} {
  const nodes = new Set<string>();
  const adjacency = new Map<string, CallEdge[]>();
  const seen = new Set<string>();
  const deduped: CallEdge[] = [];

  for (const edge of allEdges) {
    const key = edgeKey(edge);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(edge);

    // Add caller node
    nodes.add(edge.callerId);

    // Add callee node (use qualifier.name or just name)
    const calleeKey = edge.qualifier ? `${edge.qualifier}.${edge.calleeName}` : edge.calleeName;
    nodes.add(calleeKey);

    // Build adjacency
    let list = adjacency.get(edge.callerId);
    if (!list) {
      list = [];
      adjacency.set(edge.callerId, list);
    }
    list.push(edge);
  }

  return { nodes, edges: deduped, adjacency };
}
