// Math.js does not publish declarations for its individual ESM factory modules.
// The direct imports keep the initial calculator Worker smaller than the full entrypoint.
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import { create as createMathInstance } from '../../../node_modules/mathjs/lib/esm/core/create.js';
// @ts-expect-error Math.js does not publish declarations for this ESM entrypoint.
import * as numberFactories from '../../../node_modules/mathjs/lib/esm/factoriesNumber.js';
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

// Keep common arithmetic, matrix, and complex expressions in the initial Worker.
// Less common functions are supplied by the full Math.js fallback in the service.
export const mathInstance = createMathInstance({
  ...numberFactories,
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
});
