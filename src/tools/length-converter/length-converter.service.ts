export interface LengthUnit {
  key: string
  label: string
  symbol: string
  meters: number
}

export const lengthUnits = [
  { key: 'nanometer', label: 'Nanometer', symbol: 'nm', meters: 0.000000001 },
  { key: 'micrometer', label: 'Micrometer', symbol: 'um', meters: 0.000001 },
  { key: 'millimeter', label: 'Millimeter', symbol: 'mm', meters: 0.001 },
  { key: 'centimeter', label: 'Centimeter', symbol: 'cm', meters: 0.01 },
  { key: 'meter', label: 'Meter', symbol: 'm', meters: 1 },
  { key: 'kilometer', label: 'Kilometer', symbol: 'km', meters: 1_000 },
  { key: 'inch', label: 'Inch', symbol: 'in', meters: 0.0254 },
  { key: 'foot', label: 'Foot', symbol: 'ft', meters: 0.3048 },
  { key: 'yard', label: 'Yard', symbol: 'yd', meters: 0.9144 },
  { key: 'mile', label: 'Mile', symbol: 'mi', meters: 1_609.344 },
  { key: 'nautical-mile', label: 'Nautical mile', symbol: 'nmi', meters: 1_852 },
] as const satisfies readonly LengthUnit[];

export type LengthUnitKey = typeof lengthUnits[number]['key'];

function getUnit(unitKey: LengthUnitKey): LengthUnit {
  const unit = lengthUnits.find(({ key }) => key === unitKey);
  if (!unit) {
    throw new Error(`Unsupported length unit: ${unitKey}`);
  }

  return unit;
}

export function convertLength(value: number, fromUnit: LengthUnitKey, toUnit: LengthUnitKey): number {
  const meters = value * getUnit(fromUnit).meters;
  return meters / getUnit(toUnit).meters;
}

export function formatLengthValue(value: number): string {
  if (!Number.isFinite(value)) {
    return '';
  }

  if (value === 0) {
    return '0';
  }

  const absoluteValue = Math.abs(value);
  if (absoluteValue >= 1_000_000_000 || absoluteValue < 0.000001) {
    return value.toExponential(8).replace(/\.?0+e/, 'e');
  }

  return Number(value.toFixed(10)).toString();
}

export function getLengthConversions(value: number, fromUnit: LengthUnitKey) {
  return lengthUnits.map(unit => ({
    unit: unit.label,
    symbol: unit.symbol,
    value: formatLengthValue(convertLength(value, fromUnit, unit.key)),
  }));
}
