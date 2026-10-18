import type { FirstPartyExtensionModule } from '../extension.types';
import { dataConversionToolCategories } from './tool-definitions';

export const extension: FirstPartyExtensionModule = {
  activate() {
    return {
      tools: dataConversionToolCategories.flatMap(({ components }) => [...components]),
      commands: [{
        id: 'org.it-tools.data-conversion/summarize-json-lines',
        title: 'Summarize JSON Lines input',
        requiredCapabilities: [],
        execute(input, context) {
          if (typeof input !== 'string') {
            throw new TypeError('JSON Lines input must be text.');
          }
          const inputLines = input.split(/\r?\n/).filter(line => line.trim().length > 0);
          const maxRecords = context.getSetting('org.it-tools.data-conversion/max-records');
          if (typeof maxRecords !== 'number') {
            throw new TypeError('Maximum JSON Lines records must be numeric.');
          }
          const lines = inputLines.slice(0, maxRecords);
          let validRecords = 0;
          let invalidRecords = 0;
          for (const line of lines) {
            try {
              JSON.parse(line);
              validRecords++;
            }
            catch {
              invalidRecords++;
            }
          }
          const summary = { totalRecords: lines.length, validRecords, invalidRecords };
          return inputLines.length > lines.length
            ? { ...summary, skippedRecords: inputLines.length - lines.length }
            : summary;
        },
      }, {
        id: 'org.it-tools.data-conversion/open-json-lines',
        title: 'Open JSON Lines converter',
        requiredCapabilities: [],
        execute: () => undefined,
      }],
      settings: [{
        id: 'org.it-tools.data-conversion/max-records',
        type: 'number',
        defaultValue: 10_000,
        schemaVersion: 2,
        integer: true,
        minimum: 1,
        maximum: 100_000,
        migrations: [{
          fromVersion: 1,
          migrate(value) {
            if (typeof value !== 'number' || !Number.isFinite(value)) {
              throw new TypeError('Legacy record limit must be a finite number.');
            }
            return Math.floor(value);
          },
        }],
        presentation: {
          en: {
            label: 'Maximum JSON Lines records',
            description: 'Maximum number of records processed by the JSON Lines summary command.',
          },
          zh: {
            label: 'JSON Lines 最大记录数',
            description: '设置 JSON Lines 汇总命令最多处理的记录数。',
          },
        },
      }],
      dataProviders: [],
    };
  },
};
