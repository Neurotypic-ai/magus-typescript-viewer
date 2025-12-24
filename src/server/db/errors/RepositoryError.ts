/**
 * Base error class for repository-related errors
 */
export class RepositoryError extends Error {
  public readonly operation: string;
  public readonly repository: string;
  public override readonly cause?: Error | undefined;

  constructor(message: string, operation: string, repository: string, cause?: Error) {
    // Include operation and repository in the main error message for better debugging
    const fullMessage = `[${repository}] ${operation}: ${message}`;
    super(fullMessage);

    this.name = 'RepositoryError';
    this.operation = operation;
    this.repository = repository;
    this.cause = cause ?? undefined;

    // Maintain proper prototype chain
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Get the root cause of the error chain
   */
  public getRootCause(): Error | undefined {
    const traverse = (error: Error): Error | undefined => {
      if (error instanceof RepositoryError && error.cause) {
        return traverse(error.cause);
      }
      return error;
    };

    return traverse(this);
  }

  /**
   * Get a string representation of the error chain
   */
  public getErrorChain(): string {
    const chain: string[] = [this.message];
    let current: Error | undefined = this.cause;

    while (current) {
      chain.push(current.message);
      current = current instanceof RepositoryError ? current.cause : undefined;
    }

    return chain.join(' -> ');
  }
}

/**
 * Error thrown when an entity is not found
 */
export class EntityNotFoundError extends RepositoryError {
  constructor(entity: string, id: string, repository: string) {
    super(`${entity} with ID '${id}' not found`, 'retrieve', repository);
    this.name = 'EntityNotFoundError';
  }
}

/**
 * Error thrown when there are no fields to update
 */
export class NoFieldsToUpdateError extends RepositoryError {
  constructor(entity: string, repository: string) {
    super(`No fields provided to update ${entity}`, 'update', repository);
    this.name = 'NoFieldsToUpdateError';
  }
}

/**
 * Error thrown when a database constraint is violated
 */
export class ConstraintViolationError extends RepositoryError {
  constructor(message: string, operation: string, repository: string, cause?: Error) {
    super(`Constraint violation: ${message}`, operation, repository, cause);
    this.name = 'ConstraintViolationError';
  }
}

/**
 * Error thrown when there's an issue with the database schema
 */
export class SchemaError extends RepositoryError {
  constructor(message: string, operation: string, repository: string, cause?: Error) {
    super(`Schema error: ${message}`, operation, repository, cause);
    this.name = 'SchemaError';
  }
}

/**
 * Error thrown when there's an issue with a database transaction
 */
export class TransactionError extends RepositoryError {
  constructor(message: string, operation: string, repository: string, cause?: Error) {
    super(`Transaction error: ${message}`, operation, repository, cause);
    this.name = 'TransactionError';
  }
}
