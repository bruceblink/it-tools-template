import Fuse, { type IFuseOptions } from 'fuse.js';
import { type MaybeRef, computed, shallowRef, unref, watch } from 'vue';

export { useFuzzySearch };

function useFuzzySearch<Data>({
  search,
  data,
  options = {},
}: {
  search: MaybeRef<string>
  data: MaybeRef<Data[]>
  options?: IFuseOptions<Data> & { filterEmpty?: boolean }
}) {
  const fuse = shallowRef(new Fuse(unref(data), options));
  watch(() => unref(data), (collection) => {
    fuse.value = new Fuse(collection, options);
  });
  const filterEmpty = options.filterEmpty ?? true;

  const searchResult = computed<Data[]>(() => {
    const query = unref(search);

    if (!filterEmpty && query === '') {
      return unref(data);
    }

    return fuse.value.search(query).map(({ item }) => item);
  });

  return { searchResult };
}
