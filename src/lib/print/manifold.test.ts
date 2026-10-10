import { describe, expect, it } from "vitest";
import { loadManifold } from "./manifold";

describe("loadManifold", () => {
  it("a failed load is not cached: the next call can succeed", async () => {
    await expect(loadManifold("/nonexistent/manifold.wasm")).rejects.toBeTruthy();
    const M = await loadManifold();
    expect(M.Manifold.cube(1).volume()).toBeCloseTo(1, 6);
  });
});
