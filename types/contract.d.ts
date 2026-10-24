export interface Endpoint {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  headers?: Record<string, string>;
  /** Zod schema description (as plain JSON) – the test will convert to Zod at runtime */
  responseSchema: Record<string, any>;
}
