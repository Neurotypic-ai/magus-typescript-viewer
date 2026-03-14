export enum Direction {
  Up = 'UP',
  Down = 'DOWN',
  Left = 'LEFT',
  Right = 'RIGHT',
}

export enum StatusCode {
  OK = 200,
  NotFound = 404,
  Error = 500,
}

export type UserID = string;

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

// Not exported — should NOT be captured
enum InternalEnum {
  A,
  B,
}

type InternalType = number;

void InternalEnum;
void (null as unknown as InternalType);
