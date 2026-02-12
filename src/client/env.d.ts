/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

// @dagrejs/graphlib is not hoisted by pnpm, so the types from @dagrejs/dagre's
// own .d.ts cannot resolve the graphlib import. We provide ambient declarations
// for the subset of the API used in this project.
declare module '@dagrejs/graphlib' {
  export interface GraphOptions {
    directed?: boolean;
    multigraph?: boolean;
    compound?: boolean;
  }

  export interface Edge {
    v: string;
    w: string;
    name?: string;
  }

  export class Graph<T = Record<string, unknown>> {
    constructor(options?: GraphOptions);
    setGraph(label: Record<string, unknown>): Graph<T>;
    graph(): Record<string, unknown>;
    setDefaultNodeLabel(label: string | ((v: string) => string)): Graph<T>;
    setDefaultEdgeLabel(label: Record<string, unknown> | ((v: string) => Record<string, unknown>)): Graph<T>;
    setNode(name: string, label?: T): Graph<T>;
    hasNode(name: string): boolean;
    node(name: string): T;
    removeNode(name: string): Graph<T>;
    nodes(): string[];
    setEdge(v: string, w: string, label?: unknown, name?: string): Graph<T>;
    setEdge(edge: Edge, label?: unknown): Graph<T>;
    hasEdge(v: string, w: string, name?: string): boolean;
    hasEdge(edge: Edge): boolean;
    edge(v: string, w: string, name?: string): unknown;
    edge(e: Edge): unknown;
    removeEdge(v: string, w: string, name?: string): Graph<T>;
    edges(): Edge[];
    setParent(v: string, p?: string): Graph<T>;
    parent(v: string): string | undefined;
    children(v: string): string[];
    filterNodes(filter: (v: string) => boolean): Graph<T>;
    inEdges(v: string, w?: string): Edge[] | undefined;
    outEdges(v: string, w?: string): Edge[] | undefined;
    nodeEdges(v: string, w?: string): Edge[] | undefined;
    predecessors(v: string): string[] | undefined;
    successors(v: string): string[] | undefined;
    neighbors(v: string): string[] | undefined;
    isDirected(): boolean;
    isMultigraph(): boolean;
    isCompound(): boolean;
    nodeCount(): number;
    edgeCount(): number;
    sources(): string[];
    sinks(): string[];
  }
}
