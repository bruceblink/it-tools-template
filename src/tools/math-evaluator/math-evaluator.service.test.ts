import { describe, expect, it } from 'vitest';
import { evaluateMathExpression, MathExpressionLimitError } from './math-evaluator.service';

describe('math evaluator service', () => {
  it('evaluates a scalar math expression', async () => {
    await expect(evaluateMathExpression('2 * sqrt(6)')).resolves.toBe('4.898979485566356');
  });

  it('evaluates bounded matrix expressions with the common function set', async () => {
    await expect(evaluateMathExpression('sum(ones(2, 3))')).resolves.toBe('6');
    await expect(evaluateMathExpression('det([[1, 2], [3, 4]])')).resolves.toBe('-2');
    await expect(evaluateMathExpression('diag([1, 2])')).resolves.toBe('[[1, 0], [0, 2]]');
  });

  it('keeps complex numbers in the common function set', async () => {
    await expect(evaluateMathExpression('sqrt(-4)')).resolves.toBe('2i');
    await expect(evaluateMathExpression('1 + i')).resolves.toBe('1 + i');
  });

  it('loads less common Math.js built-ins only when an expression needs them', async () => {
    await expect(evaluateMathExpression('2 cm to mm')).resolves.toBe('20 mm');
  });

  it('rejects a matrix before allocating more than the collection budget', async () => {
    await expect(evaluateMathExpression('sum(ones(1000, 1000))')).rejects.toThrow(MathExpressionLimitError);
    await expect(evaluateMathExpression('sum(ones(0, 100001))')).rejects.toThrow(MathExpressionLimitError);
  });

  it('rejects diagonal expansion from a vector before creating a dense matrix', async () => {
    await expect(evaluateMathExpression('diag(ones(1000))')).rejects.toThrow(MathExpressionLimitError);
    await expect(evaluateMathExpression('diag(ones(317) + zeros(317))')).rejects.toThrow(MathExpressionLimitError);
  });

  it('rejects oversized ranges and deeply nested parser input', async () => {
    await expect(evaluateMathExpression('sum(1:100001)')).rejects.toThrow(MathExpressionLimitError);
    const longAddition = Array.from({ length: 5_000 }, () => '1').join('+');
    await expect(evaluateMathExpression(longAddition)).rejects.toThrow(MathExpressionLimitError);
  });

  it('keeps small vector diagonal expressions available', async () => {
    await expect(evaluateMathExpression('diag([1, 2])')).resolves.toBe('[[1, 0], [0, 2]]');
  });
});
