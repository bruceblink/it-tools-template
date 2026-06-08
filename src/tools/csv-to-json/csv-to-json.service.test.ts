import { describe, expect, it } from 'vitest';
import { convertCsvToJson } from './csv-to-json.service';

describe('csv-to-json service', () => {
  it('converts CSV rows with headers to JSON objects', () => {
    expect(convertCsvToJson('name,age\nAlice,30\nBob,25')).toMatchInlineSnapshot(`
      "[
        {
          "name": "Alice",
          "age": "30"
        },
        {
          "name": "Bob",
          "age": "25"
        }
      ]"
    `);
  });

  it('generates column names when the CSV has no header', () => {
    expect(convertCsvToJson('Alice,30', { hasHeader: false })).toMatchInlineSnapshot(`
      "[
        {
          "column1": "Alice",
          "column2": "30"
        }
      ]"
    `);
  });

  it('deduplicates blank and repeated headers', () => {
    expect(convertCsvToJson('name,name,\nAlice,A.,admin')).toMatchInlineSnapshot(`
      "[
        {
          "name": "Alice",
          "name_2": "A.",
          "column3": "admin"
        }
      ]"
    `);
  });

  it('can infer primitive JSON values', () => {
    expect(convertCsvToJson('name,age,active,deleted\nAlice,30,true,null', { inferTypes: true }))
      .toMatchInlineSnapshot(`
        "[
          {
            "name": "Alice",
            "age": 30,
            "active": true,
            "deleted": null
          }
        ]"
      `);
  });

  it('supports custom delimiters and quoted fields', () => {
    expect(convertCsvToJson('name;note\nAlice;"hello; world"', { delimiter: ';' }))
      .toMatchInlineSnapshot(`
        "[
          {
            "name": "Alice",
            "note": "hello; world"
          }
        ]"
      `);
  });
});
