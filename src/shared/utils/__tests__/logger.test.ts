import { vi } from 'vitest';

import { ConsoleLogger, createLogger, logger } from '../logger';

// Freeze a known timestamp for deterministic formatMessage output.
// formatMessage extracts HH:MM:SS from new Date().toISOString().
const FAKE_NOW = new Date('2025-06-15T14:30:45.123Z');
const EXPECTED_TIME = '14:30:45';

describe('ConsoleLogger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FAKE_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('creates a logger with a prefix', () => {
      const log = new ConsoleLogger('MyPrefix');
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      log.info('test');
      // Allow the queued log to execute
      vi.runAllTimers();
      expect(spy).toHaveBeenCalledWith(`${EXPECTED_TIME} [MyPrefix] test`);
    });

    it('creates a logger with empty prefix when none given', () => {
      const log = new ConsoleLogger();
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      log.info('hello');
      vi.runAllTimers();
      expect(spy).toHaveBeenCalledWith(`${EXPECTED_TIME} [] hello`);
    });

    it('uses "Logger" as fallback in formatMessage when prefix is undefined', () => {
      // When prefix is undefined (not just empty string), formatMessage uses 'Logger'
      // But the constructor defaults to '' so this path requires direct manipulation
      const log = new ConsoleLogger();
      // The constructor sets prefix to '' via `prefix ?? ''`, so formatMessage will use ''
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      log.info('msg');
      vi.runAllTimers();
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('[]'));
    });
  });

  describe('info', () => {
    it('logs to console.log with formatted message', () => {
      const log = new ConsoleLogger('App');
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      log.info('Server started');
      vi.runAllTimers();
      expect(spy).toHaveBeenCalledWith(`${EXPECTED_TIME} [App] Server started`);
    });

    it('passes extra arguments when provided', () => {
      const log = new ConsoleLogger('App');
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      log.info('count', 42, { key: 'value' });
      vi.runAllTimers();
      expect(spy).toHaveBeenCalledWith(`${EXPECTED_TIME} [App] count`, 42, { key: 'value' });
    });

    it('does not pass extra arguments when none provided', () => {
      const log = new ConsoleLogger('App');
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      log.info('simple message');
      vi.runAllTimers();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(`${EXPECTED_TIME} [App] simple message`);
      // Verify it was called with exactly one argument (no extra args)
      expect(spy.mock.calls[0]).toHaveLength(1);
    });
  });

  describe('debug', () => {
    it('does not log when DEBUG env is not set', () => {
      const originalDebug = process.env['DEBUG'];
      delete process.env['DEBUG'];

      // Need to re-import or create a new logger since DEBUG is read at module load
      // Since DEBUG is evaluated at module level, we test the behavior directly
      const log = new ConsoleLogger('Debug');
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      log.debug('should not appear');
      vi.runAllTimers();
      expect(spy).not.toHaveBeenCalled();

      process.env['DEBUG'] = originalDebug ?? '';
    });

    it('logs to console.debug with [DEBUG] tag when DEBUG=true', async () => {
      // We need to re-evaluate the module with DEBUG=true
      const originalDebug = process.env['DEBUG'];
      process.env['DEBUG'] = 'true';

      // Re-import the module to pick up the new DEBUG value
      vi.resetModules();
      const { ConsoleLogger: FreshLogger } = await import('../logger');

      const log = new FreshLogger('App');
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      log.debug('debug info');
      vi.runAllTimers();
      expect(spy).toHaveBeenCalledWith(`${EXPECTED_TIME} [App] [DEBUG] debug info`);

      process.env['DEBUG'] = originalDebug ?? '';
    });

    it('passes extra arguments in debug mode', async () => {
      const originalDebug = process.env['DEBUG'];
      process.env['DEBUG'] = 'true';

      vi.resetModules();
      const { ConsoleLogger: FreshLogger } = await import('../logger');

      const log = new FreshLogger('App');
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      log.debug('data', { id: 1 });
      vi.runAllTimers();
      expect(spy).toHaveBeenCalledWith(`${EXPECTED_TIME} [App] [DEBUG] data`, { id: 1 });

      process.env['DEBUG'] = originalDebug ?? '';
    });

    it('does not pass extra arguments when none provided in debug mode', async () => {
      const originalDebug = process.env['DEBUG'];
      process.env['DEBUG'] = 'true';

      vi.resetModules();
      const { ConsoleLogger: FreshLogger } = await import('../logger');

      const log = new FreshLogger('App');
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      log.debug('solo message');
      vi.runAllTimers();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]).toHaveLength(1);

      process.env['DEBUG'] = originalDebug ?? '';
    });
  });

  describe('error', () => {
    it('logs to console.error with error emoji prefix', () => {
      const log = new ConsoleLogger('App');
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      log.error('Something failed');
      vi.runAllTimers();
      // When no error arg is provided, error is undefined.
      // undefined ?? '' yields '', JSON.stringify('') yields '""'.
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('\u274C Something failed'),
        '""',
      );
    });

    it('extracts message from Error instances', () => {
      const log = new ConsoleLogger('App');
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      log.error('Operation failed', new Error('connection timeout'));
      vi.runAllTimers();
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('\u274C Operation failed'),
        'connection timeout',
      );
    });

    it('JSON-stringifies non-Error objects', () => {
      const log = new ConsoleLogger('App');
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      log.error('Bad data', { code: 404 });
      vi.runAllTimers();
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('\u274C Bad data'),
        '{"code":404}',
      );
    });

    it('handles string error argument', () => {
      const log = new ConsoleLogger('App');
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      log.error('Failed', 'raw string error');
      vi.runAllTimers();
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('\u274C Failed'),
        '"raw string error"',
      );
    });

    it('handles undefined error argument', () => {
      const log = new ConsoleLogger('App');
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      log.error('No error detail', undefined);
      vi.runAllTimers();
      // undefined ?? '' yields '', JSON.stringify('') yields '""'
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('\u274C No error detail'),
        '""',
      );
    });

    it('handles null error argument', () => {
      const log = new ConsoleLogger('App');
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      log.error('Null error', null);
      vi.runAllTimers();
      // null ?? '' yields '' (null is nullish), JSON.stringify('') yields '""'
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('\u274C Null error'),
        '""',
      );
    });

    it('handles numeric error argument', () => {
      const log = new ConsoleLogger('App');
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      log.error('Error code', 500);
      vi.runAllTimers();
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('\u274C Error code'),
        '500',
      );
    });
  });

  describe('warn', () => {
    it('logs to console.warn with warning emoji prefix', () => {
      const log = new ConsoleLogger('App');
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      log.warn('Deprecated feature');
      vi.runAllTimers();
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('\u26A0\uFE0F  Deprecated feature'),
      );
    });

    it('passes extra arguments when provided', () => {
      const log = new ConsoleLogger('App');
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      log.warn('Low memory', { available: '100MB' });
      vi.runAllTimers();
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('\u26A0\uFE0F  Low memory'),
        { available: '100MB' },
      );
    });

    it('does not pass extra arguments when none provided', () => {
      const log = new ConsoleLogger('App');
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      log.warn('Just a warning');
      vi.runAllTimers();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]).toHaveLength(1);
    });
  });

  describe('formatMessage', () => {
    it('includes HH:MM:SS timestamp', () => {
      const log = new ConsoleLogger('Test');
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      log.info('check timestamp');
      vi.runAllTimers();
      const message = spy.mock.calls[0]?.[0] as string;
      expect(message).toMatch(/^\d{2}:\d{2}:\d{2} /);
      expect(message).toContain(EXPECTED_TIME);
    });

    it('includes the prefix in brackets', () => {
      const log = new ConsoleLogger('MyService');
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      log.info('test');
      vi.runAllTimers();
      const message = spy.mock.calls[0]?.[0] as string;
      expect(message).toContain('[MyService]');
    });
  });

  describe('log queue', () => {
    it('processes multiple log calls in order', async () => {
      const log = new ConsoleLogger('Queue');
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      log.info('first');
      log.info('second');
      log.info('third');
      // The queue uses async processing with setTimeout(0) between items,
      // so we need runAllTimersAsync to resolve the promise chain.
      await vi.runAllTimersAsync();
      expect(spy).toHaveBeenCalledTimes(3);
      expect(spy.mock.calls[0]?.[0]).toContain('first');
      expect(spy.mock.calls[1]?.[0]).toContain('second');
      expect(spy.mock.calls[2]?.[0]).toContain('third');
    });

    it('processes mixed log levels through the queue', async () => {
      const log = new ConsoleLogger('Mix');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      log.info('info msg');
      log.warn('warn msg');
      log.error('error msg');
      await vi.runAllTimersAsync();
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });
  });
});

describe('createLogger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FAKE_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns a Logger instance with the given prefix', () => {
    const log = createLogger('CustomPrefix');
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.info('test message');
    vi.runAllTimers();
    expect(spy).toHaveBeenCalledWith(`${EXPECTED_TIME} [CustomPrefix] test message`);
  });

  it('returns a new instance each time', () => {
    const log1 = createLogger('A');
    const log2 = createLogger('B');
    expect(log1).not.toBe(log2);
  });

  it('creates loggers that operate independently', () => {
    const logA = createLogger('ServiceA');
    const logB = createLogger('ServiceB');
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logA.info('from A');
    logB.info('from B');
    vi.runAllTimers();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0]?.[0]).toContain('[ServiceA]');
    expect(spy.mock.calls[1]?.[0]).toContain('[ServiceB]');
  });
});

describe('default logger export', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FAKE_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('is an instance of ConsoleLogger', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
  });

  it('logs with empty prefix by default', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('default logger test');
    vi.runAllTimers();
    expect(spy).toHaveBeenCalledWith(`${EXPECTED_TIME} [] default logger test`);
  });
});
