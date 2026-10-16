export type SecurityHeaderConfig = {
  directives: Record<string, string[]>;
  plausibleApiOrigin: string | null;
  responseHeaders: Array<[string, string]>;
};

export function loadSecurityHeaderConfig(path?: string): Promise<SecurityHeaderConfig>;
export function buildResponseHeaders(config: SecurityHeaderConfig): Array<[string, string]>;
