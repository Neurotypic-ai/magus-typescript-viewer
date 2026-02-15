import http from 'node:http';

import { ApiServerResponder } from './server/ApiServerResponder';
import { RepositoryError } from './server/db/errors/RepositoryError';
import { createLogger } from './shared/utils/logger';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, PATCH, DELETE',
  'Access-Control-Allow-Headers': 'X-Requested-With,content-type,Authorization,Origin,Accept',
  'Access-Control-Max-Age': '86400', // 24 hours
} as const;

// Add custom replacer function for JSON serialization
function mapReplacer(_key: string, value: unknown) {
  if (value instanceof Map) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of value.entries()) {
      obj[String(k)] = v;
    }
    return obj;
  }
  return value;
}

// Helper function to apply CORS headers consistently
function applyCorsHeaders(res: http.ServerResponse): void {
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
}

// Updated helper function with proper type for resource
function sendResource(res: http.ServerResponse, resource: unknown) {
  applyCorsHeaders(res);
  res.writeHead(200, {
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify(resource, mapReplacer));
}

function sendError(res: http.ServerResponse, statusCode: number, message: string) {
  applyCorsHeaders(res);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify({ error: message }));
}

function readRequestBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => { resolve(Buffer.concat(chunks).toString('utf-8')); });
    req.on('error', reject);
  });
}

// Initialize logger
const logger = createLogger('Server');

// Initialize database and repositories in read-only mode
const apiServerResponder = new ApiServerResponder({
  dbPath: 'typescript-viewer.duckdb',
  readOnly: true,
});

logger.info('Server initialized with read-only database access');

// Ensure database exists without wiping existing data
void apiServerResponder.initialize().catch((error: unknown) => {
  if (error instanceof RepositoryError) {
    logger.error('Database initialization failed:', {
      message: error.message,
      operation: error.operation,
      repository: error.repository,
      cause: error.cause?.message,
      chain: error.getErrorChain(),
    });
  } else {
    logger.error(
      'Unexpected error during database initialization:',
      error instanceof Error ? error.message : String(error)
    );
  }
  process.exit(1);
});

// Centralized error handler
function handleServerError(error: unknown, res: http.ServerResponse): void {
  if (error instanceof RepositoryError) {
    // Log the full error context with the complete error chain
    logger.error('Repository operation failed:', {
      message: error.message,
      operation: error.operation,
      repository: error.repository,
      cause: error.cause?.message,
      chain: error.getErrorChain(),
    });
    sendError(res, 500, error.message);
    return;
  }

  // Handle other types of errors
  logger.error('Unexpected server error:', error instanceof Error ? error.message : String(error));
  sendError(res, 500, error instanceof Error ? error.message : 'Internal server error');
}

const server = http.createServer((req, res) => {
  // Apply CORS headers immediately for all requests
  applyCorsHeaders(res);

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  void (async () => {
    try {
      let resource: unknown;
      if (req.url === '/packages' && req.method === 'GET') {
        // Get all packages (be permissive on errors)
        try {
          resource = await apiServerResponder.getPackages();
        } catch (routeErr) {
          logger.error('Error in /packages route, returning empty array', routeErr);
          resource = [];
        }
      } else if (req.url?.startsWith('/graph/summary') && req.method === 'GET') {
        try {
          resource = await apiServerResponder.getGraphSummary();
        } catch (routeErr) {
          logger.error('Error in /graph/summary route, returning empty graph payload', routeErr);
          resource = { packages: [] };
        }
      } else if (req.url === '/graph' && req.method === 'GET') {
        try {
          resource = await apiServerResponder.getGraph();
        } catch (routeErr) {
          logger.error('Error in /graph route, returning empty graph payload', routeErr);
          resource = { packages: [] };
        }
      } else if (req.url?.startsWith('/modules') && req.method === 'GET') {
        let packageId: string | undefined;
        try {
          const urlString = req.url.includes('?') ? req.url.split('?')[1] : '';
          const params = new URLSearchParams(urlString);
          packageId = params.get('packageId') ?? undefined;
        } catch (error) {
          logger.error('Failed to parse URL parameters:', error instanceof Error ? error.message : String(error));
          sendError(res, 400, 'Invalid URL parameters');
          return;
        }

        if (!packageId) {
          logger.error('Missing required packageId parameter');
          sendError(res, 400, 'Missing packageId');
          return;
        }

        // Get modules, optionally filtered by packageId
        try {
          resource = await apiServerResponder.getModules(packageId);
        } catch (routeErr) {
          logger.error('Error in /modules route, returning empty array', routeErr);
          resource = [];
        }
      } else if (req.url?.startsWith('/module-details') && req.method === 'GET') {
        let moduleId: string | undefined;
        try {
          const urlString = req.url.includes('?') ? req.url.split('?')[1] : '';
          const params = new URLSearchParams(urlString);
          moduleId = params.get('moduleId') ?? undefined;
        } catch (error) {
          logger.error('Failed to parse URL parameters:', error instanceof Error ? error.message : String(error));
          sendError(res, 400, 'Invalid URL parameters');
          return;
        }

        if (!moduleId) {
          logger.error('Missing required moduleId parameter');
          sendError(res, 400, 'Missing moduleId');
          return;
        }

        try {
          const module = await apiServerResponder.getModuleDetails(moduleId);
          if (!module) {
            sendError(res, 404, 'Module not found');
            return;
          }
          resource = { module };
        } catch (routeErr) {
          logger.error('Error in /module-details route', routeErr);
          sendError(res, 500, 'Failed to load module details');
          return;
        }
      } else if (req.url === '/issues' && req.method === 'GET') {
        try {
          resource = await apiServerResponder.getCodeIssues();
        } catch (routeErr) {
          logger.error('Error in /issues route, returning empty array', routeErr);
          resource = [];
        }
      } else if (req.url?.startsWith('/insights') && req.method === 'GET') {
        try {
          let packageId: string | undefined;
          const qIdx = req.url.indexOf('?');
          if (qIdx !== -1) {
            const params = new URLSearchParams(req.url.slice(qIdx + 1));
            packageId = params.get('packageId') ?? undefined;
          }
          resource = await apiServerResponder.getInsights(packageId);
        } catch (routeErr) {
          logger.error('Error in /insights route', routeErr);
          sendError(res, 500, routeErr instanceof Error ? routeErr.message : 'Insight computation failed');
          return;
        }
      } else if (req.url === '/refactor' && req.method === 'POST') {
        try {
          const body = await readRequestBody(req);
          const parsed = JSON.parse(body) as { issueId?: string; preview?: boolean };

          if (!parsed.issueId || typeof parsed.issueId !== 'string') {
            sendError(res, 400, 'Missing required field: issueId');
            return;
          }

          const issue = await apiServerResponder.getCodeIssueById(parsed.issueId);
          if (!issue) {
            sendError(res, 404, 'Issue not found');
            return;
          }

          if (!issue.refactor_action || !issue.refactor_context) {
            sendError(res, 400, 'Issue does not have a refactoring action');
            return;
          }

          const { RefactorEngine } = await import('./server/refactors/RefactorEngine');
          const engine = new RefactorEngine();
          const request = {
            filePath: issue.file_path,
            action: issue.refactor_action,
            context: issue.refactor_context,
          };

          resource = parsed.preview
            ? await engine.preview(request)
            : await engine.execute(request);
        } catch (routeErr) {
          logger.error('Error in /refactor route', routeErr);
          sendError(res, 500, routeErr instanceof Error ? routeErr.message : 'Refactoring failed');
          return;
        }
      } else {
        logger.debug('Not found:', req.method, req.url);
        sendError(res, 404, 'Not Found');
        return;
      }

      sendResource(res, resource);
    } catch (err: unknown) {
      handleServerError(err, res);
    }
  })();
});

// Update error handling for the server
server.on('error', (err: NodeJS.ErrnoException) => {
  logger.error('Server error:', {
    message: err.message,
    code: err.code,
    syscall: err.syscall,
  });
});

// Update connection handling with logging
server.on('connection', (socket) => {
  socket.setKeepAlive(true);
  socket.setTimeout(60000);
  logger.debug('New connection established');
});

// Update graceful shutdown with logging
process.on('SIGTERM', () => {
  logger.info('Graceful shutdown initiated');
  server.close(() => {
    logger.info('Server shutdown complete');
    process.exit(0);
  });
});

const port = process.env['PORT'] ?? 4001;
server.listen(port, () => {
  logger.info(`Server listening on port ${port.toString()}`);
});
