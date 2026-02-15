/**
 * Variable structure for module-level const/let/var
 */
export interface VariableStructure {
  id: string;
  name: string;
  type: string;
  kind: 'const' | 'let' | 'var';
  initializer?: string | undefined;
}
