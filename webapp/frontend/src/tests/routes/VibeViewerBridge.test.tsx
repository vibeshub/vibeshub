import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { VibeViewer } from "../../routes/VibeViewer";

vi.mock("../../auth/AuthContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../api", () => ({
  uploadTrace: vi.fn(),
  fetchTrace: vi.fn(),
  claimTrace: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public body: string,
    ) {
      super(`API ${status}: ${body}`);
    }
  },
}));

import { useAuth } from "../../auth/AuthContext";

const mockUseAuth = useAuth as unknown as Mock;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/vibeviewer"]}>
      <Routes>
        <Route path="vibeviewer" element={<VibeViewer />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("VibeViewer 'no transcript handy?' bridge", () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    mockUseAuth.mockReturnValue({ loading: false, user: null });
    // jsdom doesn't implement scrollIntoView; stub it so jumpToCard no-ops.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("surfaces the bridge with deep links to each acquisition method", () => {
    renderPage();
    expect(screen.getByText(/No transcript handy/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Jump to the \/export/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Jump to the local session file/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Jump to the plugin/i }),
    ).toBeInTheDocument();
  });

  it("flashes only the matching how-to card when a bridge link is clicked", () => {
    renderPage();
    expect(document.getElementById("how-plugin")?.className).not.toContain(
      "flash",
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Jump to the plugin/i }),
    );

    expect(document.getElementById("how-plugin")?.className).toContain("flash");
    expect(document.getElementById("how-export")?.className).not.toContain(
      "flash",
    );
  });
});
