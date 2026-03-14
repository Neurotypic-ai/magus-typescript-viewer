import { createLogger } from '../../shared/utils/logger';
import { generateRelationshipUUID } from '../utils/uuid';

import type { Logger } from '../../shared/utils/logger';
import type { IMethodCreateDTO } from '../db/repositories/MethodRepository';
import type { IPropertyCreateDTO } from '../db/repositories/PropertyRepository';
import type { ISymbolReferenceCreateDTO } from '../db/repositories/SymbolReferenceRepository';
import type { ClassExtendsRef, ClassImplementsRef, InterfaceExtendsRef, SymbolUsageRef } from './ParseResult';

export interface ResolvedRelationships {
  classExtends: ClassExtendsRef[];
  classImplements: ClassImplementsRef[];
  interfaceExtends: InterfaceExtendsRef[];
}

export class RelationshipResolver {
  private readonly logger: Logger;

  constructor() {
    this.logger = createLogger('RelationshipResolver');
  }

  addNameMapping(nameMap: Map<string, Set<string>>, name: string, id: string): void {
    const existing = nameMap.get(name);
    if (existing) {
      existing.add(id);
      return;
    }

    nameMap.set(name, new Set([id]));
  }

  resolveUniqueName(nameMap: Map<string, Set<string>>, name: string): string | undefined {
    const ids = nameMap.get(name);
    if (ids?.size !== 1) {
      return undefined;
    }
    const [first] = ids;
    return first;
  }

  resolveRelationships(
    rawClassExtends: ClassExtendsRef[],
    rawClassImplements: ClassImplementsRef[],
    rawInterfaceExtends: InterfaceExtendsRef[],
    classNameToIds: Map<string, Set<string>>,
    interfaceNameToIds: Map<string, Set<string>>
  ): ResolvedRelationships {
    const classExtends: ClassExtendsRef[] = rawClassExtends.map((ref) => ({
      classId: ref.classId,
      parentName: ref.parentName,
      parentId: this.resolveUniqueName(classNameToIds, ref.parentName) ?? ref.parentId,
    }));

    const classImplements: ClassImplementsRef[] = rawClassImplements.map((ref) => ({
      classId: ref.classId,
      interfaceName: ref.interfaceName,
      interfaceId: this.resolveUniqueName(interfaceNameToIds, ref.interfaceName) ?? ref.interfaceId,
    }));

    const interfaceExtends: InterfaceExtendsRef[] = rawInterfaceExtends.map((ref) => ({
      interfaceId: ref.interfaceId,
      parentName: ref.parentName,
      parentId: this.resolveUniqueName(interfaceNameToIds, ref.parentName) ?? ref.parentId,
    }));

    return { classExtends, classImplements, interfaceExtends };
  }

  resolveSymbolReferences(
    packageId: string,
    symbolUsages: SymbolUsageRef[],
    classNameToIds: Map<string, Set<string>>,
    interfaceNameToIds: Map<string, Set<string>>,
    methods: IMethodCreateDTO[],
    properties: IPropertyCreateDTO[]
  ): ISymbolReferenceCreateDTO[] {
    const methodNameToIds = new Map<string, Set<string>>();
    const propertyNameToIds = new Map<string, Set<string>>();
    const methodByParentAndName = new Map<string, Set<string>>();
    const propertyByParentAndName = new Map<string, Set<string>>();

    methods.forEach((method) => {
      this.addNameMapping(methodNameToIds, method.name, method.id);
      this.addNameMapping(methodByParentAndName, this.buildParentMemberKey(method.parent_id, method.name), method.id);
    });

    properties.forEach((property) => {
      this.addNameMapping(propertyNameToIds, property.name, property.id);
      this.addNameMapping(
        propertyByParentAndName,
        this.buildParentMemberKey(property.parent_id, property.name),
        property.id
      );
    });

    const referencesById = new Map<string, ISymbolReferenceCreateDTO>();

    symbolUsages.forEach((usage) => {
      const isMethodAccess = usage.targetKind === 'method';
      const byNameMap = isMethodAccess ? methodNameToIds : propertyNameToIds;
      const byParentAndNameMap = isMethodAccess ? methodByParentAndName : propertyByParentAndName;

      let targetParentId: string | undefined;
      if (usage.qualifierName === 'this' && usage.sourceParentName && usage.sourceParentType) {
        targetParentId =
          usage.sourceParentType === 'class'
            ? this.resolveUniqueName(classNameToIds, usage.sourceParentName)
            : this.resolveUniqueName(interfaceNameToIds, usage.sourceParentName);
      } else if (usage.qualifierName) {
        targetParentId =
          this.resolveUniqueName(classNameToIds, usage.qualifierName) ??
          this.resolveUniqueName(interfaceNameToIds, usage.qualifierName);
      }

      let targetSymbolId: string | undefined;
      if (targetParentId) {
        targetSymbolId = this.resolveUniqueName(
          byParentAndNameMap,
          this.buildParentMemberKey(targetParentId, usage.targetName)
        );
      }
      targetSymbolId ??= this.resolveUniqueName(byNameMap, usage.targetName);
      if (!targetSymbolId) {
        return;
      }

      const sourceId = usage.sourceSymbolId ?? usage.moduleId;
      const id = generateRelationshipUUID(sourceId, targetSymbolId, `symbol_${usage.targetKind}`);
      referencesById.set(id, {
        id,
        package_id: packageId,
        module_id: usage.moduleId,
        source_symbol_id: usage.sourceSymbolId,
        source_symbol_type: usage.sourceSymbolType,
        source_symbol_name: usage.sourceSymbolName,
        target_symbol_id: targetSymbolId,
        target_symbol_type: usage.targetKind,
        target_symbol_name: usage.targetName,
        access_kind: usage.targetKind,
        qualifier_name: usage.qualifierName,
      });
    });

    return Array.from(referencesById.values());
  }

  private buildParentMemberKey(parentId: string, memberName: string): string {
    return `${parentId}:${memberName}`;
  }
}
