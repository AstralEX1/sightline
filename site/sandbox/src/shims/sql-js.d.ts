// The part of sql.js that sqlite.ts uses (the package ships no types).
declare module 'sql.js' {
  type Value = null | number | string | Uint8Array
  interface Statement { bind(values: Value[]): boolean; step(): boolean; getAsObject(): Record<string, Value>; free(): boolean }
  interface Database { exec(sql: string): unknown; prepare(sql: string): Statement; getRowsModified(): number; close(): void }
  export default function initSqlJs(config: { locateFile(file: string): string }): Promise<{ Database: new () => Database }>
}
