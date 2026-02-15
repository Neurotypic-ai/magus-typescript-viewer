export interface NodeDiagnostics {
  isTestFile: boolean;
  orphanCurrent: boolean;
  orphanGlobal: boolean;
  externalDependencyPackageCount: number;
  externalDependencySymbolCount: number;
  externalDependencyLevel: 'normal' | 'high' | 'critical';
}
