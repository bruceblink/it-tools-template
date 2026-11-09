export interface PluginBuildWorkflowInput {
  sourceDirectory: string;
  privateKeyPath: string;
  keyId: string;
  outputPath: string;
  tsconfigPath?: string;
}

export interface PluginBuildTypecheckReport {
  status: 'passed' | 'skipped';
  configPath?: string;
  reason?: string;
}

export interface PluginBuildWorkflowReport {
  sourceDirectory: string;
  pluginId: string;
  version: string;
  fileCount: number;
  expandedBytes: number;
  typecheck: PluginBuildTypecheckReport;
  package: {
    outputPath: string;
    pluginId: string;
    version: string;
    archiveBytes: number;
  };
}

export function buildPluginWorkflow(input: PluginBuildWorkflowInput): Promise<PluginBuildWorkflowReport>;
export function typecheckPluginProject(input: {
  sourceDirectory: string;
  tsconfigPath?: string;
}): Promise<PluginBuildTypecheckReport>;
