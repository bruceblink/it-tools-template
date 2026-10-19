interface ImportMetaEnv {
  readonly ELECTRON: boolean
}

declare module '*.yml' {
  import type { LocaleMessageValue, VueMessageType } from 'vue-i18n';

  const messages: Record<string, LocaleMessageValue<VueMessageType>>;
  export default messages;
}

declare module '*.vue' {
  import type {  ComponentOptions } from 'vue';
  const Component: ComponentOptions;
  export default Component;
}

declare module '*.md' {
  import type {  ComponentOptions } from 'vue';
  const Component: ComponentOptions;
  export default Component;
}

declare module 'iarna-toml-esm' {
  export const parse: (toml: string) => any;
  export const stringify: (obj: any) => string;
}

declare module 'emojilib' {
  const lib: Record<string, string[]>;
  export default lib;
}

declare module 'unicode-emoji-json' {
  const emoji: Record<string, {
    name: string;
    slug: string;
    group: string;
    emoji_version: string;
    unicode_version: string;
    skin_tone_support: boolean;
    skin_tone_support_unicode_version: string;
  }>;
  
  export default emoji;
}

declare module 'pdf-signature-reader' {
  const verifySignature: (pdf: ArrayBuffer) => ({signatures: SignatureInfo[]});

  export default verifySignature;
}

/**
 * `@it-tools/oggen@1.3.0` ships this declaration but omits the `types` condition
 * from its package exports, so TypeScript cannot resolve the package-root type.
 */
declare module '@it-tools/oggen' {
  export type MetadataValue = boolean | string | Date | number;

  export interface MetadataConfig {
    [key: string]: MetadataValue | MetadataValue[] | MetadataConfig
  }

  export interface MetadataFlat {
    key: string
    value: string
  }

  export function generateMeta(
    metadata: MetadataConfig,
    options?: {
      indentation?: number
      indentWith?: string
      generateTwitterCompatibleMeta?: boolean
    },
  ): string;
}
