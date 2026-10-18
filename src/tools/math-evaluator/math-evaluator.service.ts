import { parse, type MathNode } from 'mathjs';

const maxExpressionNodes = 4_096;
const maxExpressionDepth = 2_048;
const maxCollectionElements = 100_000;
const maxDiagonalSize = Math.floor(Math.sqrt(maxCollectionElements));

interface MathNodeShape {
  type?: string
  value?: unknown
  name?: string
  op?: string
  fn?: MathNodeShape
  args?: MathNodeShape[]
  items?: MathNodeShape[]
  content?: MathNodeShape
  start?: MathNodeShape
  end?: MathNodeShape
  step?: MathNodeShape | null
}

export class MathExpressionLimitError extends Error {
  constructor() {
    super('Expression exceeds the calculation limits.');
    this.name = 'MathExpressionLimitError';
  }
}

function nodeShape(node: unknown): MathNodeShape {
  return node as MathNodeShape;
}

function numericConstant(node: MathNodeShape | undefined): number | undefined {
  if (!node) { return undefined; }
  if (node.type === 'ConstantNode' && typeof node.value === 'number') { return node.value; }
  if (node.type === 'ParenthesisNode') { return numericConstant(node.content); }
  if (node.type !== 'OperatorNode' || !node.args) { return undefined; }

  const values = node.args.map(argument => numericConstant(argument));
  if (values.some(value => value === undefined)) { return undefined; }
  const left = values[0];

  if (node.args.length === 1) {
    if (left === undefined) { return undefined; }
    if (node.op === '+') { return left; }
    if (node.op === '-') { return -left; }
    return undefined;
  }

  const right = values[1];
  if (left === undefined || right === undefined) { return undefined; }

  switch (node.op) {
    case '+': return left + right;
    case '-': return left - right;
    case '*': return left * right;
    case '/': return left / right;
    case '%': return left % right;
    case '^': return left ** right;
    default: return undefined;
  }
}

function checkedElementCount(dimensions: number[]): number {
  if (dimensions.length === 0 || dimensions.some(dimension => !Number.isSafeInteger(dimension) || dimension < 0 || dimension > maxCollectionElements)) {
    throw new MathExpressionLimitError();
  }

  const elementCount = dimensions.reduce((total, dimension) => total * dimension, 1);
  if (!Number.isSafeInteger(elementCount) || elementCount > maxCollectionElements) {
    throw new MathExpressionLimitError();
  }
  return elementCount;
}

function rangeLength(startNode: MathNodeShape | undefined, endNode: MathNodeShape | undefined, stepNode?: MathNodeShape | null): number {
  const start = numericConstant(startNode);
  const end = numericConstant(endNode);
  const step = stepNode ? numericConstant(stepNode) : 1;
  if (start === undefined || end === undefined || step === undefined || !Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(step) || step === 0) {
    throw new MathExpressionLimitError();
  }

  const distance = end - start;
  if ((distance > 0 && step < 0) || (distance < 0 && step > 0)) { return 0; }
  const length = Math.floor(Math.abs(distance / step)) + 1;
  if (!Number.isSafeInteger(length) || length > maxCollectionElements) {
    throw new MathExpressionLimitError();
  }
  return length;
}

function argumentDimensions(args: MathNodeShape[]): number[] {
  const dimensionNodes = args.length === 1 && args[0]?.type === 'ArrayNode'
    ? args[0].items ?? []
    : args;
  const dimensions = dimensionNodes.map(argument => numericConstant(argument));
  if (dimensions.length === 0 || dimensions.some(dimension => dimension === undefined)) {
    throw new MathExpressionLimitError();
  }
  return dimensions as number[];
}

function functionName(node: MathNodeShape): string | undefined {
  return node.fn?.name?.toLowerCase();
}

function functionDimensions(name: string, args: MathNodeShape[]): number[] | undefined {
  if (name === 'ones' || name === 'zeros') {
    return argumentDimensions(args);
  }
  if (name === 'eye' || name === 'identity') {
    const dimensions = argumentDimensions(args);
    return dimensions.length === 1 ? [dimensions[0]!, dimensions[0]!] : dimensions;
  }
  if (name === 'range' && args.length > 0) {
    if (args.length === 1) {
      const end = numericConstant(args[0]);
      if (end === undefined) { throw new MathExpressionLimitError(); }
      return [Math.ceil(Math.abs(end))];
    }
    return [rangeLength(args[0], args[1], args[2])];
  }
  if (name === 'linspace') {
    const count = args.length >= 3 ? numericConstant(args[2]) : 100;
    if (count === undefined) { throw new MathExpressionLimitError(); }
    return [count];
  }

  return undefined;
}

function arrayDimensions(node: MathNodeShape): number[] | undefined {
  const items = node.items ?? [];
  if (items.length === 0) { return [0]; }
  const childDimensions = items.map(item => expressionDimensions(item));
  if (childDimensions.some(dimensions => dimensions === undefined)) { return undefined; }
  const firstDimensions = childDimensions[0]!;
  if (!childDimensions.every(dimensions => dimensions?.length === firstDimensions.length && dimensions.every((dimension, index) => dimension === firstDimensions[index]))) {
    return undefined;
  }
  return [items.length, ...firstDimensions];
}

function expressionDimensions(node: MathNodeShape | undefined): number[] | undefined {
  if (!node) { return undefined; }
  if (node.type === 'ConstantNode' || node.type === 'SymbolNode') { return []; }
  if (node.type === 'ParenthesisNode') { return expressionDimensions(node.content); }
  if (node.type === 'ArrayNode') { return arrayDimensions(node); }
  if (node.type === 'RangeNode') { return [rangeLength(node.start, node.end, node.step)]; }

  if (node.type === 'FunctionNode') {
    const name = functionName(node);
    const args = node.args ?? [];
    const knownDimensions = name ? functionDimensions(name, args) : undefined;
    if (knownDimensions) {
      if (name === 'diag') {
        const sourceDimensions = expressionDimensions(args[0]);
        if (!sourceDimensions) { return undefined; }
        if (sourceDimensions.length === 1) { return [sourceDimensions[0]!, sourceDimensions[0]!]; }
        if (sourceDimensions.length === 2) { return [Math.min(sourceDimensions[0]!, sourceDimensions[1]!)]; }
        return undefined;
      }
      return knownDimensions;
    }
    if (name === 'diag') {
      const sourceDimensions = expressionDimensions(args[0]);
      if (!sourceDimensions) { return undefined; }
      if (sourceDimensions.length === 0) { return [1, 1]; }
      if (sourceDimensions.length === 1) { return [sourceDimensions[0]!, sourceDimensions[0]!]; }
      if (sourceDimensions.length === 2) { return [Math.min(sourceDimensions[0]!, sourceDimensions[1]!)]; }
      return undefined;
    }
    if (name === 'transpose' || name === 'ctranspose') {
      const dimensions = expressionDimensions(args[0]);
      return dimensions?.length === 2 ? [dimensions[1]!, dimensions[0]!] : dimensions;
    }
    if (name && ['abs', 'acos', 'acosh', 'asin', 'asinh', 'atan', 'atanh', 'ceil', 'cos', 'cosh', 'exp', 'fix', 'floor', 'log', 'log10', 'round', 'sign', 'sin', 'sinh', 'sqrt', 'tan', 'tanh'].includes(name)) {
      return expressionDimensions(args[0]);
    }
    if (name && ['all', 'any', 'mean', 'min', 'max', 'prod', 'sum'].includes(name)) { return []; }
    return undefined;
  }

  if (node.type === 'OperatorNode') {
    const args = node.args ?? [];
    const dimensions = args.map(argument => expressionDimensions(argument));
    if (dimensions.some(value => value === undefined)) { return undefined; }
    if (dimensions.length === 1) { return dimensions[0]; }
    const left = dimensions[0];
    const right = dimensions[1];
    if (!left || !right) { return undefined; }
    if (left.length === 0) { return right; }
    if (right.length === 0) { return left; }
    if (left.length === right.length && left.every((dimension, index) => dimension === right[index])) { return left; }
    return undefined;
  }

  return undefined;
}

function checkFunctionResources(node: MathNodeShape): void {
  const name = functionName(node);
  const args = node.args ?? [];
  if (!name) { return; }

  if (name === 'ones' || name === 'zeros' || name === 'eye' || name === 'identity') {
    const dimensions = functionDimensions(name, args)!;
    checkedElementCount(name === 'eye' || name === 'identity'
      ? dimensions.length === 1 ? [dimensions[0]! * dimensions[0]!] : dimensions
      : dimensions);
  }

  if (name === 'linspace' || name === 'range') {
    const dimensions = functionDimensions(name, args);
    if (dimensions) { checkedElementCount(dimensions); }
  }

  if (name === 'diag' && args.length > 0) {
    const dimensions = expressionDimensions(args[0]);
    if (!dimensions || dimensions.length > 2) { throw new MathExpressionLimitError(); }
    if (dimensions.length === 1 && dimensions[0]! > maxDiagonalSize) { throw new MathExpressionLimitError(); }
  }
}

function assertExpressionResources(root: MathNode): void {
  let nodeCount = 0;
  try {
    root.traverse((node, path) => {
      nodeCount++;
      const depth = (path?.match(/[.\[]/g)?.length ?? 0) + 1;
      if (nodeCount > maxExpressionNodes || depth > maxExpressionDepth) {
        throw new MathExpressionLimitError();
      }

      const shape = nodeShape(node);
      if (shape.type === 'RangeNode') {
        checkedElementCount([rangeLength(shape.start, shape.end, shape.step)]);
      }
      if (shape.type === 'FunctionNode') {
        checkFunctionResources(shape);
      }
    });
  }
  catch (error) {
    if (error instanceof MathExpressionLimitError) { throw error; }
    if (error instanceof RangeError) { throw new MathExpressionLimitError(); }
    throw error;
  }
}

export function evaluateMathExpression(expression: string): string {
  let root: MathNode;
  try {
    root = parse(expression);
  }
  catch (error) {
    if (error instanceof RangeError) { throw new MathExpressionLimitError(); }
    throw error;
  }

  assertExpressionResources(root);
  let result: unknown;
  try {
    result = root.evaluate();
  }
  catch (error) {
    if (error instanceof RangeError) { throw new MathExpressionLimitError(); }
    throw error;
  }
  return result === undefined || result === null ? '' : String(result);
}
