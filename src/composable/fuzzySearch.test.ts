import { nextTick, ref } from 'vue';
import { describe, expect, it } from 'vitest';
import { useFuzzySearch } from './fuzzySearch';

describe('fuzzy search', () => {
  it('rebuilds its search index when a reactive collection changes', async () => {
    const search = ref('json lines');
    const data = ref([{ name: 'Roman numeral converter' }]);
    const { searchResult } = useFuzzySearch({
      search,
      data,
      options: { keys: ['name'], threshold: 0.3 },
    });

    expect(searchResult.value).toEqual([]);
    data.value = [{ name: 'Open JSON Lines converter' }];
    await nextTick();

    expect(searchResult.value).toEqual([{ name: 'Open JSON Lines converter' }]);
  });
});
