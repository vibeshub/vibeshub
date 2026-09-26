import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { ErrorBoundary } from "../../components/ErrorBoundary";

function Boom(): never {
  throw new Error("bad record");
}

describe("ErrorBoundary", () => {
  it("renders children when nothing throws", () => {
    const { getByText } = render(
      <ErrorBoundary label="Thing">
        <span>fine</span>
      </ErrorBoundary>,
    );
    expect(getByText("fine")).toBeInTheDocument();
  });

  it("swaps a crashed subtree for the error panel instead of unmounting", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { getByRole } = render(
      <div>
        <span>still here</span>
        <ErrorBoundary label="Thing">
          <Boom />
        </ErrorBoundary>
      </div>,
    );
    const alert = getByRole("alert");
    expect(alert.textContent).toContain("Thing could not be rendered");
    expect(alert.textContent).toContain("bad record");
    expect(document.body.textContent).toContain("still here");
    spy.mockRestore();
  });
});
