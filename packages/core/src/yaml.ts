import { CORE_SCHEMA, mergeTag } from 'js-yaml'

export const YAML_LOAD_OPTIONS = {
  schema: CORE_SCHEMA.withTags(mergeTag),
  maxDepth: 100,
  maxAliases: 100,
  maxTotalMergeKeys: 10_000,
} as const
