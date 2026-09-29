export interface GeneratedTypes {
  generated: string;
  strippedPaths: string[];
}

export function stripConstraintCombinators(schema: unknown): {
  schema: unknown;
  strippedPaths: string[];
};
export function generateTypes(schema: unknown): Promise<GeneratedTypes>;
