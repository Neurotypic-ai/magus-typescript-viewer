import {
  RepositoryError,
  EntityNotFoundError,
  NoFieldsToUpdateError,
  ConstraintViolationError,
  SchemaError,
  TransactionError,
} from '../RepositoryError';

// ---------------------------------------------------------------------------
// RepositoryError (base class)
// ---------------------------------------------------------------------------
describe('RepositoryError', () => {
  describe('construction', () => {
    it('creates an error with the formatted message', () => {
      const error = new RepositoryError('something broke', 'insert', 'UserRepo');
      expect(error.message).toBe('[UserRepo] insert: something broke');
    });

    it('sets operation and repository fields', () => {
      const error = new RepositoryError('msg', 'delete', 'PackageRepo');
      expect(error.operation).toBe('delete');
      expect(error.repository).toBe('PackageRepo');
    });

    it('sets the name property to RepositoryError', () => {
      const error = new RepositoryError('msg', 'op', 'repo');
      expect(error.name).toBe('RepositoryError');
    });

    it('has an undefined cause when none is provided', () => {
      const error = new RepositoryError('msg', 'op', 'repo');
      expect(error.cause).toBeUndefined();
    });

    it('stores the cause when provided', () => {
      const cause = new Error('root problem');
      const error = new RepositoryError('msg', 'op', 'repo', cause);
      expect(error.cause).toBe(cause);
    });
  });

  describe('inheritance', () => {
    it('is an instance of Error', () => {
      const error = new RepositoryError('msg', 'op', 'repo');
      expect(error).toBeInstanceOf(Error);
    });

    it('is an instance of RepositoryError', () => {
      const error = new RepositoryError('msg', 'op', 'repo');
      expect(error).toBeInstanceOf(RepositoryError);
    });

    it('has a stack trace', () => {
      const error = new RepositoryError('msg', 'op', 'repo');
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('RepositoryError');
    });
  });

  describe('getRootCause', () => {
    it('returns itself when there is no cause', () => {
      const error = new RepositoryError('msg', 'op', 'repo');
      expect(error.getRootCause()).toBe(error);
    });

    it('returns the plain Error cause for a single-level chain', () => {
      const root = new Error('root');
      const error = new RepositoryError('msg', 'op', 'repo', root);
      expect(error.getRootCause()).toBe(root);
    });

    it('traverses a multi-level RepositoryError chain', () => {
      const root = new Error('database connection lost');
      const mid = new RepositoryError('query failed', 'select', 'RepoA', root);
      const top = new RepositoryError('operation failed', 'findAll', 'RepoB', mid);

      expect(top.getRootCause()).toBe(root);
    });

    it('stops traversal at the first non-RepositoryError cause', () => {
      const deepRoot = new Error('deep');
      // A regular Error in the middle breaks the chain because getRootCause only
      // recurses into RepositoryError instances.
      const midPlain = new Error('mid');
      midPlain.cause = deepRoot; // plain Error's cause is not traversed
      const top = new RepositoryError('top', 'op', 'repo', midPlain);

      // Should return the plain Error, not deepRoot
      expect(top.getRootCause()).toBe(midPlain);
    });
  });

  describe('getErrorChain', () => {
    it('returns a single message when there is no cause', () => {
      const error = new RepositoryError('oops', 'insert', 'ModuleRepo');
      expect(error.getErrorChain()).toBe('[ModuleRepo] insert: oops');
    });

    it('chains messages with " -> " for a RepositoryError cause', () => {
      const cause = new RepositoryError('inner', 'query', 'InnerRepo');
      const error = new RepositoryError('outer', 'save', 'OuterRepo', cause);

      expect(error.getErrorChain()).toBe(
        '[OuterRepo] save: outer -> [InnerRepo] query: inner',
      );
    });

    it('includes a plain Error cause message', () => {
      const cause = new Error('sql syntax error');
      const error = new RepositoryError('query failed', 'select', 'Repo', cause);

      expect(error.getErrorChain()).toBe(
        '[Repo] select: query failed -> sql syntax error',
      );
    });

    it('stops after a plain Error cause (does not continue beyond)', () => {
      const deepCause = new Error('deep');
      const plainCause = new Error('plain');
      plainCause.cause = deepCause;
      const error = new RepositoryError('top', 'op', 'Repo', plainCause);

      // The chain should stop at plainCause because it's not a RepositoryError
      expect(error.getErrorChain()).toBe('[Repo] op: top -> plain');
    });

    it('chains multiple RepositoryErrors correctly', () => {
      const root = new Error('connection refused');
      const level1 = new RepositoryError('connect failed', 'connect', 'DBPool', root);
      const level2 = new RepositoryError('query failed', 'select', 'UserRepo', level1);
      const level3 = new RepositoryError('lookup failed', 'findById', 'Service', level2);

      expect(level3.getErrorChain()).toBe(
        '[Service] findById: lookup failed -> [UserRepo] select: query failed -> [DBPool] connect: connect failed -> connection refused',
      );
    });
  });
});

// ---------------------------------------------------------------------------
// EntityNotFoundError
// ---------------------------------------------------------------------------
describe('EntityNotFoundError', () => {
  it('formats the message with entity name and id', () => {
    const error = new EntityNotFoundError('User', '123-abc', 'UserRepo');
    expect(error.message).toBe("[UserRepo] retrieve: User with ID '123-abc' not found");
  });

  it('sets operation to "retrieve"', () => {
    const error = new EntityNotFoundError('Module', 'xyz', 'ModuleRepo');
    expect(error.operation).toBe('retrieve');
  });

  it('sets the repository field', () => {
    const error = new EntityNotFoundError('Module', 'xyz', 'ModuleRepo');
    expect(error.repository).toBe('ModuleRepo');
  });

  it('sets the name to EntityNotFoundError', () => {
    const error = new EntityNotFoundError('Module', 'xyz', 'ModuleRepo');
    expect(error.name).toBe('EntityNotFoundError');
  });

  it('is an instance of RepositoryError and Error', () => {
    const error = new EntityNotFoundError('Package', 'id', 'PackageRepo');
    expect(error).toBeInstanceOf(EntityNotFoundError);
    expect(error).toBeInstanceOf(RepositoryError);
    expect(error).toBeInstanceOf(Error);
  });

  it('has no cause', () => {
    const error = new EntityNotFoundError('Package', 'id', 'PackageRepo');
    expect(error.cause).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// NoFieldsToUpdateError
// ---------------------------------------------------------------------------
describe('NoFieldsToUpdateError', () => {
  it('formats the message with entity name', () => {
    const error = new NoFieldsToUpdateError('Class', 'ClassRepo');
    expect(error.message).toBe('[ClassRepo] update: No fields provided to update Class');
  });

  it('sets operation to "update"', () => {
    const error = new NoFieldsToUpdateError('Interface', 'InterfaceRepo');
    expect(error.operation).toBe('update');
  });

  it('sets the name to NoFieldsToUpdateError', () => {
    const error = new NoFieldsToUpdateError('Function', 'FunctionRepo');
    expect(error.name).toBe('NoFieldsToUpdateError');
  });

  it('is an instance of RepositoryError and Error', () => {
    const error = new NoFieldsToUpdateError('Class', 'ClassRepo');
    expect(error).toBeInstanceOf(NoFieldsToUpdateError);
    expect(error).toBeInstanceOf(RepositoryError);
    expect(error).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// ConstraintViolationError
// ---------------------------------------------------------------------------
describe('ConstraintViolationError', () => {
  it('formats the message with "Constraint violation:" prefix', () => {
    const error = new ConstraintViolationError('duplicate key', 'insert', 'UserRepo');
    expect(error.message).toBe('[UserRepo] insert: Constraint violation: duplicate key');
  });

  it('sets the name to ConstraintViolationError', () => {
    const error = new ConstraintViolationError('msg', 'op', 'repo');
    expect(error.name).toBe('ConstraintViolationError');
  });

  it('preserves the operation and repository', () => {
    const error = new ConstraintViolationError('dup', 'upsert', 'ModuleRepo');
    expect(error.operation).toBe('upsert');
    expect(error.repository).toBe('ModuleRepo');
  });

  it('supports error cause chaining', () => {
    const cause = new Error('UNIQUE constraint failed');
    const error = new ConstraintViolationError('dup key', 'insert', 'Repo', cause);
    expect(error.cause).toBe(cause);
  });

  it('is an instance of RepositoryError and Error', () => {
    const error = new ConstraintViolationError('msg', 'op', 'repo');
    expect(error).toBeInstanceOf(ConstraintViolationError);
    expect(error).toBeInstanceOf(RepositoryError);
    expect(error).toBeInstanceOf(Error);
  });

  it('getErrorChain includes the cause message', () => {
    const cause = new Error('SQLITE_CONSTRAINT');
    const error = new ConstraintViolationError('dup', 'insert', 'Repo', cause);
    expect(error.getErrorChain()).toBe(
      '[Repo] insert: Constraint violation: dup -> SQLITE_CONSTRAINT',
    );
  });
});

// ---------------------------------------------------------------------------
// SchemaError
// ---------------------------------------------------------------------------
describe('SchemaError', () => {
  it('formats the message with "Schema error:" prefix', () => {
    const error = new SchemaError('table missing', 'migrate', 'SchemaRepo');
    expect(error.message).toBe('[SchemaRepo] migrate: Schema error: table missing');
  });

  it('sets the name to SchemaError', () => {
    const error = new SchemaError('msg', 'op', 'repo');
    expect(error.name).toBe('SchemaError');
  });

  it('supports error cause chaining', () => {
    const cause = new Error('no such table: modules');
    const error = new SchemaError('table missing', 'query', 'Repo', cause);
    expect(error.cause).toBe(cause);
    expect(error.getRootCause()).toBe(cause);
  });

  it('is an instance of RepositoryError and Error', () => {
    const error = new SchemaError('msg', 'op', 'repo');
    expect(error).toBeInstanceOf(SchemaError);
    expect(error).toBeInstanceOf(RepositoryError);
    expect(error).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// TransactionError
// ---------------------------------------------------------------------------
describe('TransactionError', () => {
  it('formats the message with "Transaction error:" prefix', () => {
    const error = new TransactionError('rollback failed', 'commit', 'TxnRepo');
    expect(error.message).toBe('[TxnRepo] commit: Transaction error: rollback failed');
  });

  it('sets the name to TransactionError', () => {
    const error = new TransactionError('msg', 'op', 'repo');
    expect(error.name).toBe('TransactionError');
  });

  it('supports error cause chaining', () => {
    const cause = new Error('deadlock detected');
    const error = new TransactionError('aborted', 'begin', 'Repo', cause);
    expect(error.cause).toBe(cause);
    expect(error.getRootCause()).toBe(cause);
  });

  it('is an instance of RepositoryError and Error', () => {
    const error = new TransactionError('msg', 'op', 'repo');
    expect(error).toBeInstanceOf(TransactionError);
    expect(error).toBeInstanceOf(RepositoryError);
    expect(error).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// Cross-subclass instanceof checks
// ---------------------------------------------------------------------------
describe('cross-subclass instanceof checks', () => {
  it('EntityNotFoundError is not an instance of ConstraintViolationError', () => {
    const error = new EntityNotFoundError('User', 'id', 'Repo');
    expect(error).not.toBeInstanceOf(ConstraintViolationError);
  });

  it('ConstraintViolationError is not an instance of SchemaError', () => {
    const error = new ConstraintViolationError('msg', 'op', 'repo');
    expect(error).not.toBeInstanceOf(SchemaError);
  });

  it('TransactionError is not an instance of EntityNotFoundError', () => {
    const error = new TransactionError('msg', 'op', 'repo');
    expect(error).not.toBeInstanceOf(EntityNotFoundError);
  });

  it('all subclasses are instances of RepositoryError', () => {
    const errors = [
      new EntityNotFoundError('E', 'id', 'R'),
      new NoFieldsToUpdateError('E', 'R'),
      new ConstraintViolationError('m', 'o', 'R'),
      new SchemaError('m', 'o', 'R'),
      new TransactionError('m', 'o', 'R'),
    ];

    for (const error of errors) {
      expect(error).toBeInstanceOf(RepositoryError);
      expect(error).toBeInstanceOf(Error);
    }
  });
});
