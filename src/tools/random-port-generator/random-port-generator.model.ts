import { randIntFromInterval } from '@/utils/random';

export interface PortRange {
  min: number
  max: number
}

export interface PortRangeSummary extends PortRange {
  size: number
  valid: boolean
  warning?: string
}

export const DEFAULT_PORT_RANGE: PortRange = {
  min: 1024,
  max: 65535,
};

export const PORT_RANGE_PRESETS = {
  registered: { min: 1024, max: 49151 },
  dynamic: { min: 49152, max: 65535 },
  allUnprivileged: DEFAULT_PORT_RANGE,
} as const satisfies Record<string, PortRange>;

export function getPortRangeSummary({ min, max }: PortRange): PortRangeSummary {
  const valid = Number.isInteger(min) && Number.isInteger(max) && min >= 0 && max <= 65535 && min <= max;

  return {
    min,
    max,
    size: valid ? max - min + 1 : 0,
    valid,
    warning: valid ? undefined : 'Port range must use integers from 0 to 65535 and min must be less than or equal to max.',
  };
}

export function generatePort(range: PortRange = DEFAULT_PORT_RANGE) {
  const summary = getPortRangeSummary(range);
  if (!summary.valid) {
    throw new Error(summary.warning);
  }

  return randIntFromInterval(summary.min, summary.max);
}
