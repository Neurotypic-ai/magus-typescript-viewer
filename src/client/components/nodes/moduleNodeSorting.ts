import type { EmbeddedModuleEntity } from '../../types/EmbeddedModuleEntity';
import type { EmbeddedSymbol } from '../../types/EmbeddedSymbol';
import type { ExternalDependencyRef } from '../../types/ExternalDependencyRef';
import type { NodeMethod } from '../../types/NodeMethod';
import type { NodeProperty } from '../../types/NodeProperty';

const alphabeticCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

function compareMaybeString(left: string | undefined, right: string | undefined): number {
  const safeLeft = left ?? '';
  const safeRight = right ?? '';
  const comparison = alphabeticCollator.compare(safeLeft, safeRight);
  if (comparison !== 0) {
    return comparison;
  }
  return safeLeft.localeCompare(safeRight);
}

function sortNodeMethods(methods: NodeMethod[]): NodeMethod[] {
  return [...methods].sort(
    (left, right) =>
      compareMaybeString(left.name, right.name) || compareMaybeString(left.signature, right.signature),
  );
}

export function sortNodeProperties(properties: NodeProperty[]): NodeProperty[] {
  return [...properties].sort(
    (left, right) => compareMaybeString(left.name, right.name) || compareMaybeString(left.type, right.type),
  );
}

export function sortExternalDependencies(dependencies: ExternalDependencyRef[]): ExternalDependencyRef[] {
  return [...dependencies]
    .map((dependency) => ({
      ...dependency,
      symbols: [...dependency.symbols].sort((left, right) => compareMaybeString(left, right)),
    }))
    .sort(
      (left, right) =>
        compareMaybeString(left.packageName, right.packageName) ||
        compareMaybeString(left.symbols[0], right.symbols[0]),
    );
}

export function sortEmbeddedSymbols(symbols: EmbeddedSymbol[]): EmbeddedSymbol[] {
  return [...symbols]
    .map((symbol) => ({
      ...symbol,
      properties: sortNodeProperties(symbol.properties),
      methods: sortNodeMethods(symbol.methods),
    }))
    .sort(
      (left, right) =>
        compareMaybeString(left.name, right.name) || compareMaybeString(left.type, right.type),
    );
}

export function sortModuleEntities(entities: EmbeddedModuleEntity[]): EmbeddedModuleEntity[] {
  return [...entities].sort(
    (left, right) =>
      compareMaybeString(left.name, right.name) ||
      compareMaybeString(left.type, right.type) ||
      compareMaybeString(left.detail, right.detail),
  );
}

export function sortSectionsByTitle<TSection extends { title: string }>(sections: TSection[]): TSection[] {
  return [...sections].sort((left, right) => compareMaybeString(left.title, right.title));
}
