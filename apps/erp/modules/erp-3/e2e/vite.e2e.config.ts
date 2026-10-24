/**
 * ERP-3 browser-journey host (ERP3-29).
 *
 * A minimal Vite dev server used ONLY by the Playwright journey:
 *   - serves the real ERP-3 web routes (`erp3Routes`) from ./host
 *   - mounts the real ERP-3 Fastify app (in-memory repository, synthetic data)
 *     under /api via `app.inject`, so no database or network is needed
 *   - exposes POST /__e2e/reset to start every test from an empty store
 *
 * Aliases are reused from the root vitest config, so module resolution is
 * identical to the unit tests. Run from the repository root.
 */
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import vitestConfig from '../../../../../vitest.config.js';

// Minimal local shapes for the two Vite objects used here.
interface DevServerLike {
  ssrLoadModule(url: string): Promise<Record<string, unknown>>;
  middlewares: {
    use(
      handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void | Promise<void>,
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
const CORE_INDEX = path.resolve(REPO_ROOT, 'packages/core/src/index.ts');
const CORE_PERMISSIONS = path.resolve(REPO_ROOT, 'packages/core/src/auth/permissions.ts');
const BROWSER_CONTRACTS = path.resolve(REPO_ROOT, 'apps/erp/modules/erp-3/e2e/host/contracts-browser.ts');
const BROWSER_UI = path.resolve(REPO_ROOT, 'apps/erp/modules/erp-3/e2e/host/ui-browser.ts');
const APP_MODULE = path.resolve(REPO_ROOT, 'apps/erp/modules/erp-3/src/app.ts');
const REPOSITORY_MODULE = path.resolve(
  REPO_ROOT,
  'apps/erp/modules/erp-3/src/services/repository.ts',
);

/** Synthetic CRM-1 customer Golden IDs the test resolver accepts. */
export const E2E_CUSTOMER_IDS: readonly string[] = [
  '55555555-0003-4000-8000-000000000001',
  '55555555-0003-4000-8000-000000000002',
];

/** Synthetic ERP-1 product ids the test resolver accepts. */
export const E2E_PRODUCT_IDS: readonly string[] = [
  '11111111-0001-4000-8000-000000000001',
  '11111111-0001-4000-8000-000000000002',
];

interface InjectResult {
  statusCode: number;
  headers: Record<string, unknown>;
  rawPayload: Buffer;
}

interface Erp3TestApp {
  ready(): Promise<unknown>;
  close(): Promise<unknown>;
  inject(options: {
    method: string;
    url: string;
    headers: Record<string, string>;
    payload?: Buffer;
  }): Promise<InjectResult>;
}

interface Erp3AppModule {
  buildApp(options: {
    repository: unknown;
    referenceResolver: unknown;
    authRequired?: boolean;
  }): Erp3TestApp;
}

interface Erp3RepositoryModule {
  InMemoryErp3Repository: new (seed: boolean) => unknown;
}

const referenceResolver = {
  async exists(entity: string, id: string): Promise<boolean> {
    if (entity === 'customer') return E2E_CUSTOMER_IDS.includes(id);
    if (entity === 'product') return E2E_PRODUCT_IDS.includes(id);
    return false;
  },
  async get(): Promise<null> {
    return null;
  },
};

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

function erp3E2eApi(): E2ePlugin {
  return {
    name: 'erp3-e2e-api',
    enforce: 'pre',
    resolveId(source, _importer, options) {
      if (options?.ssr) return null;
      if (source === '@clearshift/contracts' || source === CONTRACTS_INDEX) return BROWSER_CONTRACTS;
      if (source === '@cs/ui' || source === UI_INDEX) return BROWSER_UI;
      if (source === '@cs/core' || source === CORE_INDEX) return CORE_PERMISSIONS;
      return null;
    },
    configureServer(server: DevServerLike) {
      let appModule: Erp3AppModule | undefined;
      let repositoryModule: Erp3RepositoryModule | undefined;
      let app: Erp3TestApp | undefined;

      const fresh = async (): Promise<Erp3TestApp> => {
        appModule ??= (await server.ssrLoadModule(APP_MODULE)) as unknown as Erp3AppModule;
        repositoryModule ??= (await server.ssrLoadModule(
          REPOSITORY_MODULE,
        )) as unknown as Erp3RepositoryModule;
        if (app) {
          await app.close();
        }
        const next = appModule.buildApp({
          repository: new repositoryModule.InMemoryErp3Repository(false),
          referenceResolver,
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
            if (
              typeof value === 'string' &&
              key !== 'host' &&
              key !== 'connection' &&
              key !== 'authorization'
            ) {
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
          console.error('[erp3-e2e-api] request failed:', url, error);
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              statusCode: 500,
              error: 'Internal Server Error',
              code: 'E2E_HOST_ERROR',
              message: error instanceof Error ? error.message : 'E2E host failure',
              details: [],
            }),
          );
        }
      });
    },
  };
}

export default {
  root: path.resolve(REPO_ROOT, 'apps/erp/modules/erp-3/e2e/host'),
  cacheDir: path.resolve(REPO_ROOT, 'node_modules/.vite-erp3-e2e'),
  resolve: { alias: vitestConfig.resolve?.alias ?? [] },
  esbuild: { jsx: 'automatic' },
  optimizeDeps: { include: ['react', 'react-dom/client', 'react-router-dom', 'zod'] },
  plugins: [erp3E2eApi()],
  server: {
    host: '127.0.0.1',
    fs: { allow: [REPO_ROOT] },
  },
};
