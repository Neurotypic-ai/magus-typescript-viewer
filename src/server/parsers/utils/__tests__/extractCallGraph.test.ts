import { describe, it, expect } from 'vitest';
import jscodeshift from 'jscodeshift';
import { extractCallEdges, buildCallGraph } from '../extractCallGraph';
import type { CallEdge } from '../extractCallGraph';

const j = jscodeshift.withParser('tsx');

/**
 * Helper: parse a source string and extract call edges from the first
 * function declaration's body (or the entire program if no function found).
 */
function edgesFromSource(
  source: string,
  callerId = 'test-caller',
  callerName = 'testFn',
): CallEdge[] {
  const root = j(source);
  const fnBody = root.find(j.FunctionDeclaration);
  const node = fnBody.length > 0 ? fnBody.get().node.body : root.get().node;
  return extractCallEdges(j, node, callerId, callerName);
}

// ---------------------------------------------------------------------------
// extractCallEdges
// ---------------------------------------------------------------------------

describe('extractCallEdges', () => {
  // -----------------------------------------------------------------------
  // Direct function calls
  // -----------------------------------------------------------------------

  it('should detect direct function calls', () => {
    const edges = edgesFromSource(`
      function main() {
        foo();
        bar();
      }
    `);

    expect(edges).toHaveLength(2);
    expect(edges[0]).toMatchObject({
      callerId: 'test-caller',
      callerName: 'testFn',
      calleeName: 'foo',
      callType: 'function',
    });
    expect(edges[1]).toMatchObject({
      calleeName: 'bar',
      callType: 'function',
    });
  });

  // -----------------------------------------------------------------------
  // this-method calls
  // -----------------------------------------------------------------------

  it('should detect this.method() calls', () => {
    const edges = edgesFromSource(`
      function render() {
        this.update();
        this.draw();
      }
    `);

    expect(edges).toHaveLength(2);
    expect(edges[0]).toMatchObject({
      calleeName: 'update',
      qualifier: 'this',
      callType: 'method',
    });
    expect(edges[1]).toMatchObject({
      calleeName: 'draw',
      qualifier: 'this',
      callType: 'method',
    });
  });

  // -----------------------------------------------------------------------
  // Constructor calls (new X())
  // -----------------------------------------------------------------------

  it('should detect constructor calls with new', () => {
    const edges = edgesFromSource(`
      function create() {
        const a = new Foo();
        const b = new Bar(1, 2);
      }
    `);

    expect(edges).toHaveLength(2);
    expect(edges[0]).toMatchObject({
      calleeName: 'Foo',
      callType: 'constructor',
    });
    expect(edges[1]).toMatchObject({
      calleeName: 'Bar',
      callType: 'constructor',
    });
  });

  // -----------------------------------------------------------------------
  // Static method calls (Class.method())
  // -----------------------------------------------------------------------

  it('should detect static method calls on uppercase identifiers', () => {
    const edges = edgesFromSource(`
      function process() {
        Array.from(items);
        Math.max(a, b);
      }
    `);

    expect(edges).toHaveLength(2);
    expect(edges[0]).toMatchObject({
      calleeName: 'from',
      qualifier: 'Array',
      callType: 'static',
    });
    expect(edges[1]).toMatchObject({
      calleeName: 'max',
      qualifier: 'Math',
      callType: 'static',
    });
  });

  // -----------------------------------------------------------------------
  // Instance method calls (obj.method())
  // -----------------------------------------------------------------------

  it('should detect instance method calls on lowercase identifiers', () => {
    const edges = edgesFromSource(`
      function process() {
        logger.info("hello");
        db.query("SELECT 1");
      }
    `);

    expect(edges).toHaveLength(2);
    expect(edges[0]).toMatchObject({
      calleeName: 'info',
      qualifier: 'logger',
      callType: 'method',
    });
    expect(edges[1]).toMatchObject({
      calleeName: 'query',
      qualifier: 'db',
      callType: 'method',
    });
  });

  // -----------------------------------------------------------------------
  // Chained calls
  // -----------------------------------------------------------------------

  it('should detect chained method calls', () => {
    const edges = edgesFromSource(`
      function chain() {
        getBuilder().configure().build();
      }
    `);

    // getBuilder() -> function call
    // .configure() -> method call (no qualifier, complex expression)
    // .build() -> method call (no qualifier, complex expression)
    const functionCalls = edges.filter((e) => e.callType === 'function');
    const methodCalls = edges.filter((e) => e.callType === 'method');

    expect(functionCalls.length).toBeGreaterThanOrEqual(1);
    expect(functionCalls.some((e) => e.calleeName === 'getBuilder')).toBe(true);

    expect(methodCalls.some((e) => e.calleeName === 'configure')).toBe(true);
    expect(methodCalls.some((e) => e.calleeName === 'build')).toBe(true);
  });

  // -----------------------------------------------------------------------
  // No calls (empty function)
  // -----------------------------------------------------------------------

  it('should return empty array for function with no calls', () => {
    const edges = edgesFromSource(`
      function noop() {
        const x = 1 + 2;
        return x;
      }
    `);

    expect(edges).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Duplicate call deduplication
  // -----------------------------------------------------------------------

  it('should deduplicate identical calls', () => {
    const edges = edgesFromSource(`
      function repeat() {
        foo();
        foo();
        foo();
      }
    `);

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      calleeName: 'foo',
      callType: 'function',
    });
  });

  it('should not deduplicate calls with different qualifiers', () => {
    const edges = edgesFromSource(`
      function multi() {
        a.run();
        b.run();
      }
    `);

    expect(edges).toHaveLength(2);
    expect(edges[0]?.qualifier).toBe('a');
    expect(edges[1]?.qualifier).toBe('b');
  });

  // -----------------------------------------------------------------------
  // Mixed call types
  // -----------------------------------------------------------------------

  it('should handle mixed call types in the same function', () => {
    const edges = edgesFromSource(`
      function mixed() {
        init();
        this.setup();
        const svc = new Service();
        Config.load();
        logger.debug("ok");
      }
    `);

    expect(edges.some((e) => e.callType === 'function' && e.calleeName === 'init')).toBe(true);
    expect(edges.some((e) => e.callType === 'method' && e.calleeName === 'setup' && e.qualifier === 'this')).toBe(true);
    expect(edges.some((e) => e.callType === 'constructor' && e.calleeName === 'Service')).toBe(true);
    expect(edges.some((e) => e.callType === 'static' && e.calleeName === 'load' && e.qualifier === 'Config')).toBe(true);
    expect(edges.some((e) => e.callType === 'method' && e.calleeName === 'debug' && e.qualifier === 'logger')).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Line numbers
  // -----------------------------------------------------------------------

  it('should capture line numbers when available', () => {
    const edges = edgesFromSource(`function f() {
  foo();
}`);

    expect(edges).toHaveLength(1);
    expect(edges[0]?.line).toBeDefined();
    expect(typeof edges[0]?.line).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// buildCallGraph
// ---------------------------------------------------------------------------

describe('buildCallGraph', () => {
  it('should build adjacency map from edges', () => {
    const edges: CallEdge[] = [
      { callerId: 'fn-a', callerName: 'a', calleeName: 'b', callType: 'function' },
      { callerId: 'fn-a', callerName: 'a', calleeName: 'c', callType: 'function' },
      { callerId: 'fn-b', callerName: 'b', calleeName: 'c', callType: 'function' },
    ];

    const graph = buildCallGraph(edges);

    expect(graph.edges).toHaveLength(3);
    expect(graph.nodes.has('fn-a')).toBe(true);
    expect(graph.nodes.has('fn-b')).toBe(true);
    expect(graph.nodes.has('b')).toBe(true);
    expect(graph.nodes.has('c')).toBe(true);

    expect(graph.adjacency.get('fn-a')).toHaveLength(2);
    expect(graph.adjacency.get('fn-b')).toHaveLength(1);
  });

  it('should deduplicate edges globally', () => {
    const edges: CallEdge[] = [
      { callerId: 'fn-a', callerName: 'a', calleeName: 'b', callType: 'function' },
      { callerId: 'fn-a', callerName: 'a', calleeName: 'b', callType: 'function' },
    ];

    const graph = buildCallGraph(edges);

    expect(graph.edges).toHaveLength(1);
    expect(graph.adjacency.get('fn-a')).toHaveLength(1);
  });

  it('should include qualifier in callee node key', () => {
    const edges: CallEdge[] = [
      { callerId: 'fn-a', callerName: 'a', calleeName: 'method', qualifier: 'this', callType: 'method' },
    ];

    const graph = buildCallGraph(edges);

    expect(graph.nodes.has('this.method')).toBe(true);
  });

  it('should handle empty edge list', () => {
    const graph = buildCallGraph([]);

    expect(graph.nodes.size).toBe(0);
    expect(graph.edges).toHaveLength(0);
    expect(graph.adjacency.size).toBe(0);
  });

  it('should build correct graph for multi-module edges', () => {
    const moduleAEdges: CallEdge[] = [
      { callerId: 'mod-a:init', callerName: 'init', calleeName: 'setup', callType: 'function' },
      { callerId: 'mod-a:init', callerName: 'init', calleeName: 'Logger', callType: 'constructor' },
    ];
    const moduleBEdges: CallEdge[] = [
      { callerId: 'mod-b:run', callerName: 'run', calleeName: 'init', callType: 'function' },
      { callerId: 'mod-b:run', callerName: 'run', calleeName: 'cleanup', callType: 'function' },
    ];

    const graph = buildCallGraph([...moduleAEdges, ...moduleBEdges]);

    expect(graph.edges).toHaveLength(4);
    expect(graph.adjacency.get('mod-a:init')).toHaveLength(2);
    expect(graph.adjacency.get('mod-b:run')).toHaveLength(2);
    // Both 'init' (as callee from mod-b) and 'mod-a:init' (as caller) are separate nodes
    expect(graph.nodes.has('init')).toBe(true);
    expect(graph.nodes.has('mod-a:init')).toBe(true);
  });
});
