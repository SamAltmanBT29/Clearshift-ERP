/**
 * ERP-2 browser-journey host (ERP2-29).
 *
 * A minimal Vite dev server used ONLY by the Playwright journey:
 *   - serves the real ERP-2 web routes (`erp2Routes`) from ./host
 *   - mounts the real ERP-2 Fastify app (in-memory repository, synthetic data)
 *     under /api via `app.inject`, so no database or network is needed
 *   - exposes POST /__e2e/reset to start every test from an empty store
 *
 * Aliases are reused from the root vitest config, so module resolution is
 * identical to the unit tests. Run from the repository root.
 */
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import vitestConfig from '../../../../../vitest.config.js';

// Minimal local shapes for the two Vite objects used here. Importing types from
// 'vite' is avoided on purpose: they resolve differently under the root tsconfig.
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
const BROWSER_CONTRACTS = path.resolve(REPO_ROOT, 'apps/erp/modules/erp-2/e2e/host/contracts-browser.ts');
const BROWSER_UI = path.resolve(REPO_ROOT, 'apps/erp/modules/erp-2/e2e/host/ui-browser.ts');
const APP_MODULE = path.resolve(REPO_ROOT, 'apps/erp/modules/erp-2/src/app.ts');
const REPOSITORY_MODULE = path.resolve(
  REPO_ROOT,
  'apps/erp/modules/erp-2/src/services/repository.ts',
);

/** Synthetic ERP-1 product ids the test resolver accepts. */
export const E2E_PRODUCT_IDS: readonly string[] = [
  '5eed0000-0000-4000-8000-0000000000a1',
  '5eed0000-0000-4000-8000-0000000000a2',
];

interface InjectResult {
  statusCode: number;
  headers: Record<string, unknown>;
  rawPayload: Buffer;
}

interface Erp2TestApp {
  ready(): Promise<unknown>;
  close(): Promise<unknown>;
  inject(options: {
    method: string;
    url: string;
    headers: Record<string, string>;
    payload?: Buffer;
  }): Promise<InjectResult>;
}

interface Erp2AppModule {
  buildApp(options: { repository: unknown; referenceResolver: unknown }): Erp2TestApp;
}

interface Erp2RepositoryModule {
  InMemoryErp2Repository: new (seed: boolean) => unknown;
}

const productResolver = {
  async exists(entity: string, id: string): Promise<boolean> {
    return entity === 'product' && E2E_PRODUCT_IDS.includes(id);
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

function erp2E2eApi(): E2ePlugin {
  return {
    name: 'erp2-e2e-api',
    enforce: 'pre',
    // Browser requests only (ssr false): the Fastify app keeps the full real packages.
    resolveId(source, _importer, options) {
      if (options?.ssr) return null;
      // The shared alias list has already rewritten the bare names to these index files.
      if (source === '@clearshift/contracts' || source === CONTRACTS_INDEX) return BROWSER_CONTRACTS;
      if (source === '@cs/ui' || source === UI_INDEX) return BROWSER_UI;
      return null;
    },
    configureServer(server: DevServerLike) {
      let appModule: Erp2AppModule | undefined;
      let repositoryModule: Erp2RepositoryModule | undefined;
      let app: Erp2TestApp | undefined;

      const fresh = async (): Promise<Erp2TestApp> => {
        appModule ??= (await server.ssrLoadModule(APP_MODULE)) as unknown as Erp2AppModule;
        repositoryModule ??= (await server.ssrLoadModule(
          REPOSITORY_MODULE,
        )) as unknown as Erp2RepositoryModule;
        if (app) {
          await app.close();
        }
        const next = appModule.buildApp({
          repository: new repositoryModule.InMemoryErp2Repository(false),
          referenceResolver: productResolver,
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
          console.error('[erp2-e2e-api] request failed:', url, error);
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
  root: path.resolve(REPO_ROOT, 'apps/erp/modules/erp-2/e2e/host'),
  cacheDir: path.resolve(REPO_ROOT, 'node_modules/.vite-erp2-e2e'),
  resolve: { alias: vitestConfig.resolve?.alias ?? [] },
  esbuild: { jsx: 'automatic' },
  // Pre-bundle up front so Vite never reloads the page mid-test.
  optimizeDeps: { include: ['react', 'react-dom/client', 'react-router-dom', 'zod'] },
  plugins: [erp2E2eApi()],
  server: {
    host: '127.0.0.1',
    fs: { allow: [REPO_ROOT] },
  },
};
