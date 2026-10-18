// The installed Bun runner has no @types/bun dependency. Declare only the API
// this suite uses so the offline project type-check includes the tests.
declare module "bun:test" {
  export function test(
    name: string,
    run: () => unknown | Promise<unknown>,
  ): void;
  // A test written ahead of the change that makes it pass; reported, not run.
  export namespace test {
    function todo(name: string, run?: () => unknown | Promise<unknown>): void;
  }
  export function afterEach(run: () => unknown | Promise<unknown>): void;
  interface Matchers<T> {
    not: Matchers<T>;
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toContain(expected: unknown): void;
    toBeGreaterThan(expected: number): void;
    toBeDefined(): void;
    toBeUndefined(): void;
    toMatch(expected: RegExp | string): void;
  }
  export function expect<T>(actual: T, message?: string): Matchers<T>;
  export const mock: {
    module(path: string, factory: () => Record<string, unknown>): void;
  };
}
