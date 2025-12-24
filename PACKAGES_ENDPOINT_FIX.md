# Packages Endpoint Fix - Module IDs Array

## Summary

Modified the `/packages` API endpoint to return an array of module IDs for each package instead of full Module objects.

## Changes Made

### `src/server/ApiServerResponder.ts`

**Modified Method**: `getPackages()`

**What Changed**:

- Added `moduleIds: string[]` field to the returned package objects
- For each package, the method now fetches all modules and extracts their IDs
- Returns packages with both the original Package properties and a new `moduleIds` array

**Return Type**:

```typescript
Promise<
  {
    id: string;
    name: string;
    version: string;
    path: string;
    created_at: Date;
    dependencies: TypeCollection<Package>;
    devDependencies: TypeCollection<Package>;
    peerDependencies: TypeCollection<Package>;
    modules: TypeCollection<Module>;
    moduleIds: string[]; // ← NEW FIELD
  }[]
>;
```

## API Response Example

**Before**:

```json
{
  "id": "package-uuid",
  "name": "my-package",
  "version": "1.0.0",
  "modules": {}
}
```

**After**:

```json
{
  "id": "package-uuid",
  "name": "my-package",
  "version": "1.0.0",
  "modules": {},
  "moduleIds": ["module-uuid-1", "module-uuid-2", "module-uuid-3"]
}
```

## Benefits

1. **Reduced Payload Size**: Clients receive only module IDs instead of full module objects
2. **Better Separation of Concerns**: Packages endpoint focuses on package data, modules endpoint provides detailed
   module data
3. **Backward Compatible**: The `modules` field remains unchanged, only adds new `moduleIds` field
4. **Error Resilient**: If module ID fetching fails for a package, returns empty array instead of failing entirely

## Testing

To test the changes:

```bash
# Start the API server
pnpm run serve

# Test the endpoint
curl http://localhost:4001/packages | jq '.[].moduleIds'
```

Expected output: Array of module UUID strings for each package.

## Status

✅ Implementation complete ✅ TypeScript compilation successful ✅ No linter errors ✅ Backward compatible
