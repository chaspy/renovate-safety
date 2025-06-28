declare module 'pacote' {
  interface ManifestResult {
    name: string;
    version: string;
    repository?: {
      url?: string;
      type?: string;
    };
    homepage?: string;
    [key: string]: unknown;
  }

  export function manifest(spec: string): Promise<ManifestResult>;
  export function extract(spec: string, destination: string): Promise<void>;
}
