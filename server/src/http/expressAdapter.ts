// ============================================================================
// Express adapter — the ONLY code coupled to the web framework. It translates
// Express requests into the neutral HttpRequest, invokes the handler, and
// writes the neutral HttpResult back onto the Express response. Swapping to
// Azure Functions means writing an equivalent ~40-line adapter; the handlers,
// routes, services and repositories are untouched.
// ============================================================================
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import { HttpError } from '../services/errors.js';
import type { HttpRequest, HttpResult } from './http.js';
import type { RouteDef } from './routes.js';

function toHttpRequest(req: Request): HttpRequest {
  const query: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(req.query)) {
    query[key] = typeof value === 'string' ? value : undefined;
  }
  const file = req.file
    ? { originalName: req.file.originalname, buffer: req.file.buffer }
    : undefined;
  return { params: req.params as Record<string, string>, query, body: req.body, file };
}

function sendResult(res: Response, result: HttpResult): void {
  if (result.download) {
    res.status(result.status);
    res.setHeader('Content-Type', result.download.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(result.download.fileName)}"`,
    );
    res.send(result.download.data);
    return;
  }
  if (result.status === 204 || result.json === undefined) {
    res.status(result.status).end();
    return;
  }
  res.status(result.status).json(result.json);
}

/** Build the Express app from a neutral route table. */
export function createExpressApp(routes: RouteDef[], maxUploadBytes: number): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '4mb' }));

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxUploadBytes } });

  for (const route of routes) {
    const method = route.method.toLowerCase() as 'get' | 'post' | 'patch' | 'put' | 'delete';
    const middleware = route.upload ? [upload.single('file')] : [];
    app[method](route.path, ...middleware, async (req: Request, res: Response, next: NextFunction) => {
      try {
        sendResult(res, await route.handler(toHttpRequest(req)));
      } catch (err) {
        next(err);
      }
    });
  }

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  // Central error translation: HttpError → its status, everything else → 500.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  });

  return app;
}
