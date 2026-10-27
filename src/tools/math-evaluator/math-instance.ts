// Math.js does not publish declarations for its individual ESM factory modules.
// The direct imports keep the initial calculator Worker smaller than the full entrypoint.
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { create as createMathInstance } from '../../../node_modules/mathjs/lib/esm/core/create.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createI } from '../../../node_modules/mathjs/lib/esm/constants.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createAdd } from '../../../node_modules/mathjs/lib/esm/function/arithmetic/add.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createAddScalar } from '../../../node_modules/mathjs/lib/esm/function/arithmetic/addScalar.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createDivide } from '../../../node_modules/mathjs/lib/esm/function/arithmetic/divide.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createDivideScalar } from '../../../node_modules/mathjs/lib/esm/function/arithmetic/divideScalar.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createMultiply } from '../../../node_modules/mathjs/lib/esm/function/arithmetic/multiply.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createMultiplyScalar } from '../../../node_modules/mathjs/lib/esm/function/arithmetic/multiplyScalar.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createPow } from '../../../node_modules/mathjs/lib/esm/function/arithmetic/pow.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createSqrt } from '../../../node_modules/mathjs/lib/esm/function/arithmetic/sqrt.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createSubtract } from '../../../node_modules/mathjs/lib/esm/function/arithmetic/subtract.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createSubtractScalar } from '../../../node_modules/mathjs/lib/esm/function/arithmetic/subtractScalar.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createConj } from '../../../node_modules/mathjs/lib/esm/function/complex/conj.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createComplex } from '../../../node_modules/mathjs/lib/esm/type/complex/function/complex.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createComplexClass } from '../../../node_modules/mathjs/lib/esm/type/complex/Complex.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createBigNumberClass } from '../../../node_modules/mathjs/lib/esm/type/bignumber/BigNumber.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createFractionClass } from '../../../node_modules/mathjs/lib/esm/type/fraction/Fraction.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createMatrix } from '../../../node_modules/mathjs/lib/esm/type/matrix/function/matrix.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createDenseMatrixClass } from '../../../node_modules/mathjs/lib/esm/type/matrix/DenseMatrix.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createMatrixClass } from '../../../node_modules/mathjs/lib/esm/type/matrix/Matrix.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createSparseMatrixClass } from '../../../node_modules/mathjs/lib/esm/type/matrix/SparseMatrix.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createConcat } from '../../../node_modules/mathjs/lib/esm/function/matrix/concat.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createDet } from '../../../node_modules/mathjs/lib/esm/function/matrix/det.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createDiag } from '../../../node_modules/mathjs/lib/esm/function/matrix/diag.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createDot } from '../../../node_modules/mathjs/lib/esm/function/matrix/dot.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createIdentity } from '../../../node_modules/mathjs/lib/esm/function/matrix/identity.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createOnes } from '../../../node_modules/mathjs/lib/esm/function/matrix/ones.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createRange } from '../../../node_modules/mathjs/lib/esm/function/matrix/range.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createSize } from '../../../node_modules/mathjs/lib/esm/function/matrix/size.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createSubset } from '../../../node_modules/mathjs/lib/esm/function/matrix/subset.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createTranspose } from '../../../node_modules/mathjs/lib/esm/function/matrix/transpose.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createZeros } from '../../../node_modules/mathjs/lib/esm/function/matrix/zeros.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createSum } from '../../../node_modules/mathjs/lib/esm/function/statistics/sum.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createParse } from '../../../node_modules/mathjs/lib/esm/expression/parse.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createEvaluate } from '../../../node_modules/mathjs/lib/esm/expression/function/evaluate.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createTyped } from '../../../node_modules/mathjs/lib/esm/core/function/typed.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createNumeric } from '../../../node_modules/mathjs/lib/esm/function/utils/numeric.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createAccessorNode } from '../../../node_modules/mathjs/lib/esm/expression/node/AccessorNode.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createNode } from '../../../node_modules/mathjs/lib/esm/expression/node/Node.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createResultSet } from '../../../node_modules/mathjs/lib/esm/type/resultset/ResultSet.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createArrayNode } from '../../../node_modules/mathjs/lib/esm/expression/node/ArrayNode.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createAssignmentNode } from '../../../node_modules/mathjs/lib/esm/expression/node/AssignmentNode.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createBlockNode } from '../../../node_modules/mathjs/lib/esm/expression/node/BlockNode.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createConditionalNode } from '../../../node_modules/mathjs/lib/esm/expression/node/ConditionalNode.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createConstantNode } from '../../../node_modules/mathjs/lib/esm/expression/node/ConstantNode.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createFunctionAssignmentNode } from '../../../node_modules/mathjs/lib/esm/expression/node/FunctionAssignmentNode.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createFunctionNode } from '../../../node_modules/mathjs/lib/esm/expression/node/FunctionNode.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createIndexNode } from '../../../node_modules/mathjs/lib/esm/expression/node/IndexNode.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createObjectNode } from '../../../node_modules/mathjs/lib/esm/expression/node/ObjectNode.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createOperatorNode } from '../../../node_modules/mathjs/lib/esm/expression/node/OperatorNode.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createParenthesisNode } from '../../../node_modules/mathjs/lib/esm/expression/node/ParenthesisNode.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createRangeNode } from '../../../node_modules/mathjs/lib/esm/expression/node/RangeNode.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createRelationalNode } from '../../../node_modules/mathjs/lib/esm/expression/node/RelationalNode.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createSymbolNode } from '../../../node_modules/mathjs/lib/esm/expression/node/SymbolNode.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createEqualScalar } from '../../../node_modules/mathjs/lib/esm/function/relational/equalScalar.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createIsInteger } from '../../../node_modules/mathjs/lib/esm/function/utils/isInteger.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createEqual } from '../../../node_modules/mathjs/lib/esm/function/relational/equal.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createIsBounded } from '../../../node_modules/mathjs/lib/esm/function/utils/isBounded.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createNumber } from '../../../node_modules/mathjs/lib/esm/type/number.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createBignumber } from '../../../node_modules/mathjs/lib/esm/type/bignumber/function/bignumber.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createFraction } from '../../../node_modules/mathjs/lib/esm/type/fraction/function/fraction.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createIsZero } from '../../../node_modules/mathjs/lib/esm/function/utils/isZero.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { createUnaryMinus } from '../../../node_modules/mathjs/lib/esm/function/arithmetic/unaryMinus.js';

// Keep common arithmetic, matrix, and complex expressions in the initial Worker.
// Less common functions are supplied by the full Math.js fallback in the service.
export const mathInstance = createMathInstance({
  createI,
  createAdd,
  createAddScalar,
  createDivide,
  createDivideScalar,
  createMultiply,
  createMultiplyScalar,
  createPow,
  createSqrt,
  createSubtract,
  createSubtractScalar,
  createConj,
  createComplex,
  createComplexClass,
  createBigNumberClass,
  createFractionClass,
  createMatrix,
  createDenseMatrixClass,
  createMatrixClass,
  createSparseMatrixClass,
  createConcat,
  createDet,
  createDiag,
  createDot,
  createIdentity,
  createOnes,
  createRange,
  createSize,
  createSubset,
  createSum,
  createTranspose,
  createZeros,
  createParse,
  createEvaluate,
  createTyped,
  createNumeric,
  createAccessorNode,
  createNode,
  createResultSet,
  createArrayNode,
  createAssignmentNode,
  createBlockNode,
  createConditionalNode,
  createConstantNode,
  createFunctionAssignmentNode,
  createFunctionNode,
  createIndexNode,
  createObjectNode,
  createOperatorNode,
  createParenthesisNode,
  createRangeNode,
  createRelationalNode,
  createSymbolNode,
  createEqualScalar,
  createIsInteger,
  createEqual,
  createIsBounded,
  createNumber,
  createBignumber,
  createFraction,
  createIsZero,
  createUnaryMinus,
});
