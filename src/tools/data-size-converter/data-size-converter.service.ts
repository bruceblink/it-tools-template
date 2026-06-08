export interface DataSizeUnit {
  key: string
  label: string
  symbol: string
  bits: number
}

export const dataSizeUnits = [
  { key: 'bit', label: 'Bit', symbol: 'b', bits: 1 },
  { key: 'byte', label: 'Byte', symbol: 'B', bits: 8 },
  { key: 'kilobit', label: 'Kilobit', symbol: 'kb', bits: 1_000 },
  { key: 'kibibit', label: 'Kibibit', symbol: 'Kib', bits: 1_024 },
  { key: 'kilobyte', label: 'Kilobyte', symbol: 'KB', bits: 8_000 },
  { key: 'kibibyte', label: 'Kibibyte', symbol: 'KiB', bits: 8_192 },
  { key: 'megabit', label: 'Megabit', symbol: 'Mb', bits: 1_000_000 },
  { key: 'mebibit', label: 'Mebibit', symbol: 'Mib', bits: 1_048_576 },
  { key: 'megabyte', label: 'Megabyte', symbol: 'MB', bits: 8_000_000 },
  { key: 'mebibyte', label: 'Mebibyte', symbol: 'MiB', bits: 8_388_608 },
  { key: 'gigabit', label: 'Gigabit', symbol: 'Gb', bits: 1_000_000_000 },
  { key: 'gibibit', label: 'Gibibit', symbol: 'Gib', bits: 1_073_741_824 },
  { key: 'gigabyte', label: 'Gigabyte', symbol: 'GB', bits: 8_000_000_000 },
  { key: 'gibibyte', label: 'Gibibyte', symbol: 'GiB', bits: 8_589_934_592 },
  { key: 'terabyte', label: 'Terabyte', symbol: 'TB', bits: 8_000_000_000_000 },
  { key: 'tebibyte', label: 'Tebibyte', symbol: 'TiB', bits: 8_796_093_022_208 },
] as const satisfies readonly DataSizeUnit[];

export type DataSizeUnitKey = typeof dataSizeUnits[number]['key'];

function getUnit(unitKey: DataSizeUnitKey): DataSizeUnit {
  const unit = dataSizeUnits.find(({ key }) => key === unitKey);
  if (!unit) {
    throw new Error(`Unsupported data size unit: ${unitKey}`);
  }

  return unit;
}

export function convertDataSize(value: number, fromUnit: DataSizeUnitKey, toUnit: DataSizeUnitKey): number {
  const bits = value * getUnit(fromUnit).bits;
  return bits / getUnit(toUnit).bits;
}

export function formatDataSizeValue(value: number): string {
  if (!Number.isFinite(value)) {
    return '';
  }

  if (value === 0) {
    return '0';
  }

  const absoluteValue = Math.abs(value);
  if (absoluteValue >= 1_000_000_000_000 || absoluteValue < 0.000001) {
    return value.toExponential(8).replace(/\.?0+e/, 'e');
  }

  return Number(value.toFixed(10)).toString();
}

export function getDataSizeConversions(value: number, fromUnit: DataSizeUnitKey) {
  return dataSizeUnits.map(unit => ({
    unit: unit.label,
    symbol: unit.symbol,
    value: formatDataSizeValue(convertDataSize(value, fromUnit, unit.key)),
  }));
}
