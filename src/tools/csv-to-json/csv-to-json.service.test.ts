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

  it('keeps dotted headers flat by default', () => {
    expect(convertCsvToJson('user.name,user.age\nAlice,30')).toMatchInlineSnapshot(`
      "[
        {
          "user.name": "Alice",
          "user.age": "30"
        }
      ]"
    `);
  });

  it('can expand dotted headers into nested JSON objects', () => {
    expect(convertCsvToJson('user.name,user.age,active\nAlice,30,true', {
      expandDotNotation: true,
      inferTypes: true,
    })).toMatchInlineSnapshot(`
      "[
        {
          "user": {
            "name": "Alice",
            "age": 30
          },
          "active": true
        }
      ]"
    `);
  });
});
