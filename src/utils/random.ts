const random = () => Math.random();

const randFromArray = <T>(array: T[]): T | undefined => array[Math.floor(random() * array.length)];

const randIntFromInterval = (min: number, max: number) => Math.floor(random() * (max - min) + min);

// Durstenfeld shuffle
function shuffleArrayMutate<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    // Both indexes are bounded by the current length, including arrays of optional values.
    [array[i], array[j]] = [array[j] as T, array[i] as T];
  }

  return array;
}

const shuffleArray = <T>(array: T[]): T[] => shuffleArrayMutate([...array]);

const shuffleString = (str: string, delimiter = ''): string => shuffleArrayMutate(str.split(delimiter)).join(delimiter);

const generateRandomId = () => `id-${random().toString(36).substring(2, 12)}`;

export {
  randFromArray,
  randIntFromInterval,
  random,
  shuffleArray,
  shuffleArrayMutate,
  shuffleString,
  generateRandomId,
};
