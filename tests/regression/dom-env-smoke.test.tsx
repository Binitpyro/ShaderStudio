// @vitest-environment happy-dom
import "../setup/rtl";
import { useEffect, useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

function Counter() {
  const [count, setCount] = useState(0);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return (
    <div>
      <span data-testid="effect">{mounted ? "effect:ran" : "effect:pending"}</span>
      <span data-testid="count">{`count:${count}`}</span>
      <button type="button" onClick={() => setCount((c) => c + 1)}>
        increment
      </button>
    </div>
  );
}

describe("happy-dom + React Testing Library smoke", () => {
  it("runs useEffect on mount and re-renders state on click", async () => {
    const user = userEvent.setup();
    render(<Counter />);

    expect(screen.getByTestId("effect").textContent).toBe("effect:ran");
    expect(screen.getByTestId("count").textContent).toBe("count:0");

    await user.click(screen.getByRole("button", { name: "increment" }));

    expect(screen.getByTestId("count").textContent).toBe("count:1");
  });
});
