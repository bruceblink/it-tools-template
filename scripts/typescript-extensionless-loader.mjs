const validatorModule = new URL('../src/shared/external-plugin-v2.ts', import.meta.url).href;

/** 只补齐 v2 清单校验模块对能力目录和工具元数据模块的内部导入。 */
export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL === validatorModule
    && (specifier === './plugin-capabilities' || specifier === './plugin-tool-metadata')) {
    return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
}
