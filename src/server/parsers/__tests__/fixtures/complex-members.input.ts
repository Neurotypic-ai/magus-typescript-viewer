interface Logger {
  "write-log"(entry: LogEntry): Promise<Result>;
  404: (payload: StatusPayload) => HandlerResult;
}

export interface ServiceContract {
  configure: (payload: ConfigPayload, options?: RunOptions) => Promise<ResultEnvelope>;
  run(
    { id, flags }: RunPayload,
    [first, second]: [number, number],
    ...rest: ExtraParam[]
  ): FinalState;
}

export class Worker {
  readonly "label"?: LabelType;
  static 7: CounterType;
  handler = (input: InputValue, retries = 3, ...rest: RetryHint[]): WorkerResult => {
    this.process(input);
    LoggerFactory.create().write(input);
    return buildResult(input, rest);
  };

  process(value: InputValue): OutputValue {
    return convertValue(value);
  }
}

type LogEntry = { message: string };
type Result = { ok: boolean };
type StatusPayload = { status: number };
type HandlerResult = { handled: boolean };
type ConfigPayload = { enabled: boolean };
type RunOptions = { retries: number };
type ResultEnvelope = { data: string };
type RunPayload = { id: string; flags: string[] };
type FinalState = { done: boolean };
type ExtraParam = { key: string };
type LabelType = string;
type CounterType = number;
type InputValue = { raw: string };
type RetryHint = { level: number };
type WorkerResult = { output: string };
type OutputValue = { value: string };

const LoggerFactory = {
  create(): { write(input: InputValue): void } {
    return {
      write() {},
    };
  },
};

function convertValue(value: InputValue): OutputValue {
  return { value: value.raw };
}

function buildResult(_input: InputValue, _rest: RetryHint[]): WorkerResult {
  return { output: 'ok' };
}
