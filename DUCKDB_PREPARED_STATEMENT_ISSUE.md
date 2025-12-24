# DuckDB Prepared Statement Issue Analysis

## Problem Statement

Both `MethodRepository.retrieveByParent()` and `PropertyRepository.retrieveByParent()` fail intermittently with:

```
Failed to execute prepared statement
```

When executing queries with 2 parameters:

```sql
SELECT p.* FROM properties p
WHERE p.parent_id = ? AND p.parent_type = ?
```

## Evidence

### 1. Data is Correct ✅

- ModuleParser correctly sets `parent_type` for all properties (422 interface, 47 class)
- Database contains 100% accurate parent_type values
- No NULL or missing values

### 2. Direct Queries Work ✅

- MCP/MotherDuck queries with 2 parameters work perfectly
- Direct `@duckdb/node-api` test with prepared statements succeeds
- Single-parameter queries always work

### 3. Application Queries Fail Intermittently ⚠️

- Both MethodRepository and PropertyRepository require fallback logic
- Error only occurs during module enrichment with concurrent queries
- Same query pattern works in isolation

## Root Cause Hypothesis

The issue appears to be **connection state or concurrent query handling** in DuckDB's Node.js adapter when running in
READ_ONLY mode with multiple simultaneous prepared statements.

### Possible Causes:

1. **Single Connection Limitation**
   - DuckDBAdapter uses a single connection for all queries
   - Concurrent `retrieveByParent` calls may conflict
   - READ_ONLY mode may have stricter connection limits

2. **Parameter Binding Issue**
   - `runAndReadAll` may not properly handle parameter arrays in concurrent scenarios
   - Type casting `params as DuckDBValue[]` may lose type information

3. **Prepared Statement Cache**
   - DuckDB may cache prepared statements
   - Concurrent execution with same statement but different params could conflict

## Current Workaround

Both repositories use try/catch with fallback:

```typescript
try {
  // Try query with parent_id AND parent_type
} catch (err) {
  // Fall back to query with just parent_id
  // This works but returns more rows than needed
}
```

## Proposed Solutions

### Option 1: Connection Pooling (Best)

Create a connection pool instead of single connection:

```typescript
export class DuckDBAdapter implements IDatabaseAdapter {
  private connectionPool: DuckDBConnection[] = [];
  private currentConnectionIndex = 0;

  async init(): Promise<void> {
    const poolSize = 4; // Configurable
    for (let i = 0; i < poolSize; i++) {
      const conn = await this.db.connect();
      this.connectionPool.push(conn);
    }
  }

  private getConnection(): DuckDBConnection {
    const conn = this.connectionPool[this.currentConnectionIndex];
    this.currentConnectionIndex = (this.currentConnectionIndex + 1) % this.connectionPool.length;
    return conn!;
  }
}
```

### Option 2: Query Serialization (Medium)

Serialize prepared statement execution with a mutex:

```typescript
import { Mutex } from 'async-mutex';

export class DuckDBAdapter implements IDatabaseAdapter {
  private queryMutex = new Mutex();

  async query<T>(sql: string, params?: QueryParams): Promise<QueryResult<T>> {
    return this.queryMutex.runExclusive(async () => {
      const result = await this.connection.runAndReadAll(sql, params);
      return this.processResults(result);
    });
  }
}
```

### Option 3: Retry Logic (Temporary)

Add automatic retry with exponential backoff:

```typescript
async query<T>(sql: string, params?: QueryParams): Promise<QueryResult<T>> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await this.connection.runAndReadAll(sql, params);
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt)));
    }
  }
}
```

### Option 4: Remove parent_type filter (Quick but suboptimal)

If the above don't work, we could:

1. Always query with just `parent_id`
2. Filter by `parent_type` in memory
3. This works but is less efficient

## Recommendation

**Implement Option 1 (Connection Pooling)** because:

1. It's the proper architectural solution
2. Improves performance for concurrent queries
3. Eliminates the race condition entirely
4. Allows us to remove fallback logic from repositories

Fallback to Option 2 (Mutex) if connection pooling proves incompatible with DuckDB's threading model.

## Action Items

- [ ] Test connection pooling with @duckdb/node-api
- [ ] Implement connection pool in DuckDBAdapter
- [ ] Remove fallback logic from MethodRepository and PropertyRepository
- [ ] Add integration tests for concurrent queries
- [ ] Update documentation

---

**Created**: 2025-10-17 **Status**: Analysis Complete **Priority**: High
