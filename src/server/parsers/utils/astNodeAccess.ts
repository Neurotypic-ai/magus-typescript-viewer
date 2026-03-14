/**
 * Safely access a property on an untyped AST node.
 * Replaces the verbose `(node as unknown as Record<string, unknown>)['prop']` pattern.
 */
export function getNodeProp(node: unknown, key: string): unknown {
  if (node && typeof node === 'object') return (node as Record<string, unknown>)[key];
  return undefined;
}
