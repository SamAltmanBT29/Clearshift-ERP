/**
 * ERP-5 browser-journey host (ERP5-29).
 *
 * A minimal Vite dev server used ONLY by the Playwright journey:
 *   - serves the real ERP-5 web routes (`erp5Routes`) from ./host
 *   - mounts the real ERP-5 Fastify app (in-memory repository, synthetic data)
 *     under /api via `app.inject`, so no live database or network is needed
 *   - exposes POST /__e2e/reset to start every test from an empty store
 */
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import vitestConfig from '../../../../../vitest.config.js';

interface DevServerLike {
  ssrLoadModule(url: string): Promise<Record<string, unknown>>;
  middlewares: {
    use(
      handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void | Promise<void>
    ): unknown;
  };
}

interface E2ePlugin {
  name: string;
  enforce?: 'pre';
  resolveId?(source: string, importer: string | undefined, options?: { ssr?: boolean }): string | null;
  configureServer(server: DevServerLike): void;
}

const REPO_ROOT = process.cwd();
const CONTRACTS_INDEX = path.resolve(REPO_ROOT, 'packages/contracts/src/index.ts');
const UI_INDEX = path.resolve(REPO_ROOT, 'packages/ui/src/index.ts');
const BROWSER_CONTRACTS = path.resolve(REPO_ROOT, 'apps/erp/modules/erp-5/e2e/host/contracts-browser.ts');
const BROWSER_UI = path.resolve(REPO_ROOT, 'apps/erp/modules/erp-5/e2e/host/ui-browser.ts');
const APP_MODULE = path.resolve(REPO_ROOT, 'apps/erp/modules/erp-5/src/app.ts');
const REPOSITORY_MODULE = path.resolve(
  REPO_ROOT,
  'apps/erp/modules/erp-5/src/services/in-memory.repository.ts'
);

interface InjectResult {
  statusCode: number;
  headers: Record<string, unknown>;
  rawPayload: Buffer;
}

interface Erp5TestApp {
  ready(): Promise<unknown>;
  close(): Promise<unknown>;
  inject(options: {
    method: string;
    url: string;
    headers: Record<string, string>;
    payload?: Buffer;
  }): Promise<InjectResult>;
}

interface Erp5AppModule {
  buildApp(options?: { repository?: unknown; authRequired?: boolean }): Erp5TestApp;
}

interface Erp5RepositoryModule {
  InMemoryHrRepository: new () => unknown;
}

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

function erp5E2eApi(): E2ePlugin {
  return {
    name: 'erp5-e2e-api',
    enforce: 'pre',
    resolveId(source, _importer, options) {
      if (options?.ssr) return null;
      if (source === '@clearshift/contracts' || source === CONTRACTS_INDEX) return BROWSER_CONTRACTS;
      if (source === '@cs/ui' || source === UI_INDEX) return BROWSER_UI;
      return null;
    },
    configureServer(server: DevServerLike) {
      let appModule: Erp5AppModule | undefined;
      let repositoryModule: Erp5RepositoryModule | undefined;
      let app: Erp5TestApp | undefined;

      const fresh = async (): Promise<Erp5TestApp> => {
        appModule ??= (await server.ssrLoadModule(APP_MODULE)) as unknown as Erp5AppModule;
        repositoryModule ??= (await server.ssrLoadModule(
          REPOSITORY_MODULE
        )) as unknown as Erp5RepositoryModule;
        if (app) {
          await app.close();
        }
        const next = appModule.buildApp({
          repository: new repositoryModule.InMemoryHrRepository(),
          authRequired: false,
        });
        await next.ready();
        app = next;
        return next;
      };

      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = req.url ?? '';
        try {
          if (url === '/__e2e/reset' && req.method === 'POST') {
            await fresh();
            res.statusCode = 204;
            res.end();
            return;
          }
          if (!url.startsWith('/api/')) {
            next();
            return;
          }

          const current = app ?? (await fresh());
          const payload = await readBody(req);
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === 'string' && key !== 'host' && key !== 'connection') {
              headers[key] = value;
            }
          }

          const result = await current.inject({
            method: req.method ?? 'GET',
            url,
            headers,
            ...(payload ? { payload } : {}),
          });

          res.statusCode = result.statusCode;
          for (const [key, value] of Object.entries(result.headers)) {
            if (value !== undefined && key.toLowerCase() !== 'transfer-encoding') {
              res.setHeader(key, value as string | string[] | number);
            }
          }
          res.end(result.rawPayload);
        } catch (error) {
          console.error('[erp5-e2e-api] request failed:', url, error);
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              statusCode: 500,
              error: 'Internal Server Error',
              code: 'E2E_HOST_ERROR',
              message: error instanceof Error ? error.message : 'E2E host failure',
              details: [],
            })
          );
        }
      });
    },
  };
}

export default {
  root: path.resolve(REPO_ROOT, 'apps/erp/modules/erp-5/e2e/host'),
  cacheDir: path.resolve(REPO_ROOT, 'node_modules/.vite-erp5-e2e'),
  resolve: { alias: vitestConfig.resolve?.alias ?? [] },
  esbuild: { jsx: 'automatic' },
  optimizeDeps: { include: ['react', 'react-dom/client', 'react-router-dom', 'zod'] },
  plugins: [erp5E2eApi()],
  server: {
    host: '127.0.0.1',
    fs: { allow: [REPO_ROOT] },
  },
};
