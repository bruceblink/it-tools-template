export type SortOrder = 'asc' | 'desc' | null;

export interface ConvertOptions {
  lowerCase: boolean
  trimItems: boolean
  itemPrefix: string
  itemSuffix: string
  listPrefix: string
  listSuffix: string
  reverseList: boolean
  sortList: SortOrder
  removeDuplicates: boolean
  separator: string
  keepLineBreaks: boolean
}

export function createDefaultConvertOptions(): ConvertOptions {
  return {
    lowerCase: false,
    trimItems: true,
    itemPrefix: '',
    itemSuffix: '',
    listPrefix: '',
    listSuffix: '',
    reverseList: false,
    sortList: null,
    removeDuplicates: true,
    separator: ', ',
    keepLineBreaks: false,
  };
}
