import { MockAdapter } from '../MockAdapter';

describe('MockAdapter', () => {
  let adapter: MockAdapter;

  beforeEach(async () => {
    adapter = new MockAdapter();
    await adapter.init();
  });

  describe('getDbPath', () => {
    it('returns ":memory:" by default', () => {
      expect(adapter.getDbPath()).toBe(':memory:');
    });

    it('returns the custom path when provided', () => {
      const custom = new MockAdapter('/tmp/test.db');
      expect(custom.getDbPath()).toBe('/tmp/test.db');
    });
  });

  describe('init', () => {
    it('clears all stored tables', async () => {
      // Insert a row so there is state
      await adapter.query('INSERT INTO widgets (name) VALUES (?)', ['sprocket']);
      // Verify the row is there
      const before = await adapter.query('SELECT * FROM widgets');
      expect(before).toHaveLength(1);

      // Re-init should wipe state
      await adapter.init();

      const after = await adapter.query('SELECT * FROM widgets');
      expect(after).toHaveLength(0);
    });
  });

  describe('query', () => {
    describe('INSERT', () => {
      it('stores a row and returns it', async () => {
        const result = await adapter.query('INSERT INTO users (name) VALUES (?)', ['Alice']);

        expect(result).toHaveLength(1);
        expect(result[0]).toHaveProperty('id');
        expect(typeof result[0]!.id).toBe('string');
      });

      it('maps positional params to param0, param1, ...', async () => {
        const result = await adapter.query('INSERT INTO users (name, age) VALUES (?, ?)', [
          'Bob',
          30,
        ]);

        expect(result).toHaveLength(1);
        const row = result[0]!;
        expect(row.param0).toBe('Bob');
        expect(row.param1).toBe(30);
      });

      it('creates a row with only id when no params are provided', async () => {
        const result = await adapter.query('INSERT INTO users DEFAULT VALUES');

        expect(result).toHaveLength(1);
        const row = result[0]!;
        expect(row).toHaveProperty('id');
        // Only the auto-generated id key should exist
        const keys = Object.keys(row);
        expect(keys).toEqual(['id']);
      });

      it('accumulates rows across multiple inserts to the same table', async () => {
        await adapter.query('INSERT INTO items (name) VALUES (?)', ['first']);
        await adapter.query('INSERT INTO items (name) VALUES (?)', ['second']);
        await adapter.query('INSERT INTO items (name) VALUES (?)', ['third']);

        const rows = await adapter.query('SELECT * FROM items');
        expect(rows).toHaveLength(3);
      });

      it('isolates rows between different tables', async () => {
        await adapter.query('INSERT INTO cats (name) VALUES (?)', ['Whiskers']);
        await adapter.query('INSERT INTO dogs (name) VALUES (?)', ['Rex']);

        const cats = await adapter.query('SELECT * FROM cats');
        const dogs = await adapter.query('SELECT * FROM dogs');

        expect(cats).toHaveLength(1);
        expect(dogs).toHaveLength(1);
        expect(cats[0]!.param0).toBe('Whiskers');
        expect(dogs[0]!.param0).toBe('Rex');
      });
    });

    describe('SELECT', () => {
      it('returns an empty array for an empty table', async () => {
        const result = await adapter.query('SELECT * FROM empty_table');
        expect(result).toEqual([]);
      });

      it('returns all rows previously inserted', async () => {
        await adapter.query('INSERT INTO products (sku) VALUES (?)', ['AAA']);
        await adapter.query('INSERT INTO products (sku) VALUES (?)', ['BBB']);

        const result = await adapter.query('SELECT * FROM products');
        expect(result).toHaveLength(2);
        expect(result[0]!.param0).toBe('AAA');
        expect(result[1]!.param0).toBe('BBB');
      });
    });

    describe('unrecognized SQL', () => {
      it('returns an empty array for UPDATE statements', async () => {
        const result = await adapter.query('UPDATE users SET name = ? WHERE id = ?', [
          'Charlie',
          '123',
        ]);
        expect(result).toEqual([]);
      });

      it('returns an empty array for DELETE statements', async () => {
        const result = await adapter.query('DELETE FROM users WHERE id = ?', ['123']);
        expect(result).toEqual([]);
      });

      it('returns an empty array for CREATE TABLE statements', async () => {
        const result = await adapter.query('CREATE TABLE foo (id TEXT)');
        expect(result).toEqual([]);
      });
    });

    describe('table name extraction', () => {
      it('extracts table name from INSERT INTO', async () => {
        await adapter.query('INSERT INTO my_table (col) VALUES (?)', ['val']);
        const rows = await adapter.query('SELECT * FROM my_table');
        expect(rows).toHaveLength(1);
      });

      it('falls back to "unknown_table" when no table name is found', async () => {
        // A malformed SQL that doesn't match the FROM/INTO pattern
        const result = await adapter.query('SELECT 1');
        // Should query the "unknown_table" which is empty
        expect(result).toEqual([]);
      });
    });
  });

  describe('transaction', () => {
    it('commits changes when the callback succeeds', async () => {
      const result = await adapter.transaction(async () => {
        await adapter.query('INSERT INTO orders (item) VALUES (?)', ['widget']);
        return 'committed';
      });

      expect(result).toBe('committed');

      // Data should persist after transaction
      const rows = await adapter.query('SELECT * FROM orders');
      expect(rows).toHaveLength(1);
      expect(rows[0]!.param0).toBe('widget');
    });

    it('rolls back changes when the callback throws an Error', async () => {
      await expect(
        adapter.transaction(async () => {
          await adapter.query('INSERT INTO doomed_table (item) VALUES (?)', ['doomed']);
          throw new Error('something went wrong');
        })
      ).rejects.toThrow('something went wrong');

      // New tables created during the transaction are removed on rollback
      const rows = await adapter.query('SELECT * FROM doomed_table');
      expect(rows).toHaveLength(0);
    });

    it('restores the map reference on rollback, removing new tables', async () => {
      // Seed data before the transaction
      await adapter.query('INSERT INTO stable (val) VALUES (?)', ['keep']);

      await expect(
        adapter.transaction(async () => {
          // Insert into a brand-new table (not in the snapshot)
          await adapter.query('INSERT INTO ephemeral (val) VALUES (?)', ['gone']);
          throw new Error('rollback');
        })
      ).rejects.toThrow('rollback');

      // The new table should not exist after rollback
      const ephemeral = await adapter.query('SELECT * FROM ephemeral');
      expect(ephemeral).toHaveLength(0);

      // Pre-existing table is still accessible
      const stable = await adapter.query('SELECT * FROM stable');
      expect(stable).toHaveLength(1);
    });

    it('rolls back changes when the callback throws a non-Error value', async () => {
      await expect(
        adapter.transaction(async () => {
          await adapter.query('INSERT INTO stuff (val) VALUES (?)', ['temp']);
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw 'string error';
        })
      ).rejects.toThrow('string error');

      // Rolled back: the table should be empty
      const rows = await adapter.query('SELECT * FROM stuff');
      expect(rows).toHaveLength(0);
    });

    it('returns the value from a successful callback', async () => {
      const result = await adapter.transaction(async () => {
        return { status: 'ok', count: 42 };
      });

      expect(result).toEqual({ status: 'ok', count: 42 });
    });

    it('removes new tables on rollback while keeping pre-existing tables', async () => {
      await adapter.query('INSERT INTO tableB (y) VALUES (?)', ['b1']);

      await expect(
        adapter.transaction(async () => {
          // Insert into a new table only
          await adapter.query('INSERT INTO tableC (z) VALUES (?)', ['c1']);
          throw new Error('abort');
        })
      ).rejects.toThrow('abort');

      // tableB was not touched, should still be there
      const tableB = await adapter.query('SELECT * FROM tableB');
      expect(tableB).toHaveLength(1);

      // tableC was created during the transaction and should be gone
      const tableC = await adapter.query('SELECT * FROM tableC');
      expect(tableC).toHaveLength(0);
    });

    it('note: shallow snapshot does not roll back mutations to existing arrays', async () => {
      // This tests the known limitation of the shallow snapshot approach:
      // When inserting into a pre-existing table during a failed transaction,
      // the array is mutated in-place, so the snapshot shares the same reference.
      await adapter.query('INSERT INTO shared (val) VALUES (?)', ['original']);

      await expect(
        adapter.transaction(async () => {
          await adapter.query('INSERT INTO shared (val) VALUES (?)', ['added-in-txn']);
          throw new Error('fail');
        })
      ).rejects.toThrow('fail');

      // Due to shallow copy, the in-place push is NOT rolled back
      const rows = await adapter.query('SELECT * FROM shared');
      expect(rows).toHaveLength(2);
    });
  });

  describe('close', () => {
    it('resolves without throwing', async () => {
      await expect(adapter.close()).resolves.toBeUndefined();
    });

    it('can be called multiple times without error', async () => {
      await adapter.close();
      await expect(adapter.close()).resolves.toBeUndefined();
    });
  });
});
