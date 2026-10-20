import { afterAll, expect, it } from "vitest";
import { pool } from "./index";
afterAll(() => pool.end());
it("bounds connection acquisition and server statements during an outage", () => {
  expect(pool.options.connectionTimeoutMillis).toBe(5000);
  expect(pool.options.statement_timeout).toBe(15000);
});
