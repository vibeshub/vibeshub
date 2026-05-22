import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { UploadPage } from "../../routes/UploadPage";

vi.mock("../../auth/AuthContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../api", () => ({
  uploadTrace: vi.fn(),
  fetchMyRepos: vi.fn(),
  fetchRepoPrs: vi.fn(),
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
import { uploadTrace, ApiError } from "../../api";

const mockUseAuth = useAuth as unknown as Mock;

const signedInAuth = {
  loading: false,
  user: { id: "u1", login: "alice", name: "Alice", avatar_url: null },
  refresh: vi.fn(),
  signOut: vi.fn(),
};

function renderUploadPage() {
  return render(
    <MemoryRouter initialEntries={["/upload"]}>
      <Routes>
        <Route path="upload" element={<UploadPage />} />
        <Route path="t/:shortId" element={<div>trace view sentinel</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("UploadPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockUseAuth.mockReset();
    (uploadTrace as Mock).mockReset();
  });

  it("shows a sign-in prompt and no form for anonymous visitors", () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: null,
      refresh: vi.fn(),
      signOut: vi.fn(),
    });
    renderUploadPage();
    expect(screen.getAllByText(/sign in/i).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText(/transcript/i)).not.toBeInTheDocument();
  });

  it("disables Submit until a transcript file is chosen", () => {
    mockUseAuth.mockReturnValue(signedInAuth);
    renderUploadPage();
    const submit = screen.getByRole("button", { name: /upload/i });
    expect(submit).toBeDisabled();
  });

  it("uploads a standalone trace and navigates to it", async () => {
    mockUseAuth.mockReturnValue(signedInAuth);
    (uploadTrace as Mock).mockResolvedValue({
      trace_id: "t1",
      short_id: "abc1234567",
      trace_url: "/t/abc1234567",
      created: true,
    });
    renderUploadPage();
    const file = new File(['{"type":"user"}\n'], "chat.jsonl");
    fireEvent.change(screen.getByLabelText(/transcript/i), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: /upload/i }));
    await waitFor(() =>
      expect(screen.getByText(/trace view sentinel/i)).toBeInTheDocument(),
    );
    expect(uploadTrace).toHaveBeenCalledWith(
      expect.objectContaining({ isPrivate: false }),
    );
  });

  it("shows a standalone-public notice when no repo or PR is picked", () => {
    mockUseAuth.mockReturnValue(signedInAuth);
    renderUploadPage();
    expect(screen.getByText(/public/i)).toBeInTheDocument();
  });

  it("shows the error message and stays on the form when upload fails", async () => {
    mockUseAuth.mockReturnValue(signedInAuth);
    (uploadTrace as Mock).mockRejectedValue(
      new ApiError(422, "bad transcript"),
    );
    renderUploadPage();
    const file = new File(['{"type":"user"}\n'], "chat.jsonl");
    fireEvent.change(screen.getByLabelText(/transcript/i), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: /upload/i }));
    await waitFor(() =>
      expect(screen.getByText(/bad transcript/i)).toBeInTheDocument(),
    );
    expect(screen.getByLabelText(/transcript/i)).toBeInTheDocument();
  });
});
