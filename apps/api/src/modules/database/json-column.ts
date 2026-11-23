import type { ValueTransformer } from 'typeorm';

// SQL Server JSON functions accept nvarchar(max). Keep SQL NULL distinct from JSON text.
export const jsonColumn: ValueTransformer = {
  to: (value: unknown) => (value == null ? value : JSON.stringify(value)),
  from: (value: unknown) =>
    typeof value === 'string' ? JSON.parse(value) : value,
};
