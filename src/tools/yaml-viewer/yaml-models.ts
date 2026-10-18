import yaml from 'yaml';

export { formatYaml };

function formatYaml({
  rawYaml,
  sortKeys = false,
  indentSize = 2,
}: {
  rawYaml: string
  sortKeys?: boolean
  indentSize?: number
}) {
  const parsedYaml = yaml.parse(rawYaml);

  const formattedYAML = yaml.stringify(parsedYaml, {
    sortMapEntries: sortKeys,
    indent: indentSize,
  });

  return formattedYAML;
}
