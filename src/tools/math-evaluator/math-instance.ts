import { create as createMathInstance } from 'mathjs';

// @ts-expect-error Math.js runtime factories are omitted from its declarations.
import { createAbs, createAcos, createAccessorNode, createAdd, createAddScalar } from 'mathjs';
// @ts-expect-error Math.js runtime factories are omitted from its declarations.
import { createArg, createArrayNode, createAsin, createAssignmentNode, createAtan } from 'mathjs';
// @ts-expect-error Math.js runtime factories are omitted from its declarations.
import { createBigNumberClass, createBignumber, createBlockNode, createCeil, createComplex } from 'mathjs';
// @ts-expect-error Math.js runtime factories are omitted from its declarations.
import { createComplexClass, createConcat, createConditionalNode, createConj, createConstantNode } from 'mathjs';
// @ts-expect-error Math.js runtime factories are omitted from its declarations.
import { createCos, createDenseMatrixClass, createDet, createDiag, createDivide } from 'mathjs';
// @ts-expect-error Math.js runtime factories are omitted from its declarations.
import { createDivideScalar, createDot, createE, createEqual, createEqualScalar } from 'mathjs';
// @ts-expect-error Math.js runtime factories are omitted from its declarations.
import { createEvaluate, createExp, createFalse, createFloor, createFraction } from 'mathjs';
// @ts-expect-error Math.js runtime factories are omitted from its declarations.
import { createFractionClass, createFunctionAssignmentNode, createFunctionNode, createI, createIdentity } from 'mathjs';
// @ts-expect-error Math.js runtime factories are omitted from its declarations.
import { createIm, createIndexNode, createInfinity, createInv, createIsBounded } from 'mathjs';
// @ts-expect-error Math.js runtime factories are omitted from its declarations.
import { createIsInteger, createIsNaN, createIsPositive, createIsZero, createLarger } from 'mathjs';
// @ts-expect-error Math.js runtime factories are omitted from its declarations.
import { createLargerEq, createLog, createLog10, createLog2, createMatrix } from 'mathjs';
// @ts-expect-error Math.js runtime factories are omitted from its declarations.
import { createMatrixClass, createMax, createMean, createMin, createMod } from 'mathjs';
// @ts-expect-error Math.js runtime factories are omitted from its declarations.
import { createMultiply, createMultiplyScalar, createNaN, createNode, createNumber } from 'mathjs';
// @ts-expect-error Math.js runtime factories are omitted from its declarations.
import { createNumeric, createObjectNode, createOnes, createOperatorNode, createParenthesisNode } from 'mathjs';
// @ts-expect-error Math.js runtime factories are omitted from its declarations.
import { createParse, createPi, createPow, createProd, createRange } from 'mathjs';
// @ts-expect-error Math.js runtime factories are omitted from its declarations.
import { createRangeNode, createRe, createRelationalNode, createResultSet, createRound } from 'mathjs';
// @ts-expect-error Math.js runtime factories are omitted from its declarations.
import { createSin, createSize, createSmaller, createSmallerEq, createSparseMatrixClass } from 'mathjs';
// @ts-expect-error Math.js runtime factories are omitted from its declarations.
import { createSqrt, createSubset, createSubtract, createSubtractScalar, createSum } from 'mathjs';
// @ts-expect-error Math.js runtime factories are omitted from its declarations.
import { createSymbolNode, createTan, createTau, createTranspose, createTrue } from 'mathjs';
// @ts-expect-error Math.js runtime factories are omitted from its declarations.
import { createTypeOf, createTyped, createUnaryMinus, createUnaryPlus, createZeros } from 'mathjs';

// Keep common numeric, matrix, and complex expressions in the initial Worker.
// The service lazily loads full Math.js when an expression needs another built-in.
export const mathInstance = createMathInstance({
  createAbs: createAbs,
  createAcos: createAcos,
  createAccessorNode: createAccessorNode,
  createAdd: createAdd,
  createAddScalar: createAddScalar,
  createArg: createArg,
  createArrayNode: createArrayNode,
  createAsin: createAsin,
  createAssignmentNode: createAssignmentNode,
  createAtan: createAtan,
  createBigNumberClass: createBigNumberClass,
  createBignumber: createBignumber,
  createBlockNode: createBlockNode,
  createCeil: createCeil,
  createComplex: createComplex,
  createComplexClass: createComplexClass,
  createConcat: createConcat,
  createConditionalNode: createConditionalNode,
  createConj: createConj,
  createConstantNode: createConstantNode,
  createCos: createCos,
  createDenseMatrixClass: createDenseMatrixClass,
  createDet: createDet,
  createDiag: createDiag,
  createDivide: createDivide,
  createDivideScalar: createDivideScalar,
  createDot: createDot,
  createE: createE,
  createEqual: createEqual,
  createEqualScalar: createEqualScalar,
  createEvaluate: createEvaluate,
  createExp: createExp,
  createFalse: createFalse,
  createFloor: createFloor,
  createFraction: createFraction,
  createFractionClass: createFractionClass,
  createFunctionAssignmentNode: createFunctionAssignmentNode,
  createFunctionNode: createFunctionNode,
  createI: createI,
  createIdentity: createIdentity,
  createIm: createIm,
  createIndexNode: createIndexNode,
  createInfinity: createInfinity,
  createInv: createInv,
  createIsBounded: createIsBounded,
  createIsInteger: createIsInteger,
  createIsNaN: createIsNaN,
  createIsPositive: createIsPositive,
  createIsZero: createIsZero,
  createLarger: createLarger,
  createLargerEq: createLargerEq,
  createLog: createLog,
  createLog10: createLog10,
  createLog2: createLog2,
  createMatrix: createMatrix,
  createMatrixClass: createMatrixClass,
  createMax: createMax,
  createMean: createMean,
  createMin: createMin,
  createMod: createMod,
  createMultiply: createMultiply,
  createMultiplyScalar: createMultiplyScalar,
  createNaN: createNaN,
  createNode: createNode,
  createNumber: createNumber,
  createNumeric: createNumeric,
  createObjectNode: createObjectNode,
  createOnes: createOnes,
  createOperatorNode: createOperatorNode,
  createParenthesisNode: createParenthesisNode,
  createParse: createParse,
  createPi: createPi,
  createPow: createPow,
  createProd: createProd,
  createRange: createRange,
  createRangeNode: createRangeNode,
  createRe: createRe,
  createRelationalNode: createRelationalNode,
  createResultSet: createResultSet,
  createRound: createRound,
  createSin: createSin,
  createSize: createSize,
  createSmaller: createSmaller,
  createSmallerEq: createSmallerEq,
  createSparseMatrixClass: createSparseMatrixClass,
  createSqrt: createSqrt,
  createSubset: createSubset,
  createSubtract: createSubtract,
  createSubtractScalar: createSubtractScalar,
  createSum: createSum,
  createSymbolNode: createSymbolNode,
  createTan: createTan,
  createTau: createTau,
  createTranspose: createTranspose,
  createTrue: createTrue,
  createTypeOf: createTypeOf,
  createTyped: createTyped,
  createUnaryMinus: createUnaryMinus,
  createUnaryPlus: createUnaryPlus,
  createZeros: createZeros,
});
