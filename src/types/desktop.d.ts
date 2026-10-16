export {};

declare global {
  interface Window {
    itToolsDesktop: {
      getRuntimeInfo(): Promise<{
        platform: string;
        version: string;
      }>;
    };
  }
}
