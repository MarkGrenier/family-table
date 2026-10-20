import { describe, expect, it } from "vitest";
import { groceryKey, shoppingAmount, singularize } from "../src/ingredients";

describe("grocery names and purchase amounts", () => {
  it("singularizes the last word so plurals share a key", () => {
    expect(singularize("lemons")).toBe("lemon");
    expect(singularize("lemon")).toBe("lemon");
    expect(singularize("cucumbers")).toBe("cucumber");
    expect(singularize("tomatoes")).toBe("tomato");
    expect(singularize("berries")).toBe("berry");
    expect(singularize("asparagus")).toBe("asparagus");
    expect(groceryKey("Lemons")).toBe(groceryKey("Lemon"));
    expect(groceryKey("English cucumbers")).toBe(groceryKey("English cucumber"));
    expect(groceryKey("English cucumbers")).toBe("english cucumber");
  });

  it("sums only compatible purchase units", () => {
    expect(shoppingAmount([{ quantity: 1, unit: "lb" }, { quantity: 1, unit: "lb" }], 2)).toBe("2 lb");
    expect(shoppingAmount([{ quantity: 8, unit: "oz" }, { quantity: 8, unit: "oz" }], 2)).toBe("1 lb");
    expect(shoppingAmount([{ quantity: 1, unit: "lb" }, { quantity: 8, unit: "oz" }], 2)).toBe("1 ½ lb");
    expect(shoppingAmount([{ quantity: 2, unit: "clove" }, { quantity: 2, unit: "clove" }], 1)).toBe("4 cloves");
    expect(shoppingAmount([{ quantity: 2, unit: null }, { quantity: 1, unit: null }], 2)).toBe("3");
    expect(shoppingAmount([{ quantity: 8.5, unit: "tsp" }], 1)).toBeNull();
    expect(shoppingAmount([{ quantity: 8.5, unit: "tsp" }, { quantity: 1, unit: "tsp" }], 2)).toBe("for 2 recipes");
    expect(shoppingAmount([{ quantity: 0.5, unit: "cup" }], 1)).toBeNull();
    expect(shoppingAmount([{ quantity: 1, unit: "tbsp" }], 1)).toBeNull();
    expect(shoppingAmount([{ quantity: 4, unit: "cube" }], 1)).toBeNull();
    expect(
      shoppingAmount(
        [
          { quantity: 1, unit: "bag" },
          { quantity: 1.5, unit: "cup" },
        ],
        2,
      ),
    ).toBe("for 2 recipes");
    expect(shoppingAmount([{ quantity: 1, unit: "bag" }], 1)).toBe("1 bag");
  });
});