import { describe, expect, it } from 'vitest';
import { evaluateMathExpression, MathExpressionLimitError } from './math-evaluator.service';

describe('math evaluator service', () => {
  it('evaluates a scalar math expression', () => {
    expect(evaluateMathExpression('2 * sqrt(6)')).toBe('4.898979485566356');
  });

  it('evaluates a bounded matrix reduction', () => {
    expect(evaluateMathExpression('sum(ones(2, 3))')).toBe('6');
  });

  it('rejects a matrix before allocating more than the collection budget', () => {
    expect(() => evaluateMathExpression('sum(ones(1000, 1000))')).toThrow(MathExpressionLimitError);
    expect(() => evaluateMathExpression('sum(ones(0, 100001))')).toThrow(MathExpressionLimitError);
  });

  it('rejects diagonal expansion from a vector before creating a dense matrix', () => {
    expect(() => evaluateMathExpression('diag(ones(1000))')).toThrow(MathExpressionLimitError);
    expect(() => evaluateMathExpression('diag(ones(317) + zeros(317))')).toThrow(MathExpressionLimitError);
  });

  it('rejects oversized ranges and deeply nested parser input', () => {
    expect(() => evaluateMathExpression('sum(1:100001)')).toThrow(MathExpressionLimitError);
    const longAddition = Array.from({ length: 5_000 }, () => '1').join('+');
    expect(() => evaluateMathExpression(longAddition)).toThrow(MathExpressionLimitError);
  });

  it('keeps small vector diagonal expressions available', () => {
    expect(evaluateMathExpression('diag([1, 2])')).toBe('[[1, 0], [0, 2]]');
  });
});
