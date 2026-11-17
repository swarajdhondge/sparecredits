declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    prepare(sql: string): {
      columns(): unknown[];
      all(...b: unknown[]): Record<string, unknown>[];
      run(...b: unknown[]): { changes: number | bigint };
    };
    exec(sql: string): void;
  }
}
