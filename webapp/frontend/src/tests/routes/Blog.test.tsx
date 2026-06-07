import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Blog } from "../../routes/Blog";
import { BlogPost } from "../../routes/BlogPost";
import { POSTS } from "../../blog/posts";

vi.mock("../../auth/AuthContext", () => ({
  useAuth: vi.fn(() => ({
    loading: false,
    user: null,
    refresh: vi.fn(),
    signOut: vi.fn(),
  })),
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/blog" element={<Blog />} />
        <Route path="/blog/:slug" element={<BlogPost />} />
      </Routes>
    </MemoryRouter>,
  );
}

const post = POSTS[0];

describe("Blog index", () => {
  it("renders the blog heading", () => {
    renderAt("/blog");
    expect(
      screen.getByRole("heading", { level: 1, name: /the vibeshub blog/i }),
    ).toBeInTheDocument();
  });

  it("lists each post with a link to its page", () => {
    renderAt("/blog");
    const link = screen.getByRole("link", { name: new RegExp(post.title.slice(0, 20), "i") });
    expect(link).toHaveAttribute("href", `/blog/${post.slug}`);
  });
});

describe("BlogPost", () => {
  it("renders the post title and byline", () => {
    renderAt(`/blog/${post.slug}`);
    expect(
      screen.getByRole("heading", { level: 1, name: new RegExp(post.title.slice(0, 20), "i") }),
    ).toBeInTheDocument();
    expect(screen.getByText(post.author)).toBeInTheDocument();
  });

  it("renders the workflow section headings", () => {
    renderAt(`/blog/${post.slug}`);
    for (const name of [
      /review that starts from intent/i,
      /onboarding without the shoulder-tap/i,
      /a searchable archive/i,
      /every agent, one place/i,
      /the governance answer/i,
    ]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
  });

  it("embeds the three product screenshots as figures", () => {
    renderAt(`/blog/${post.slug}`);
    expect(screen.getByRole("img", { name: /trace viewer/i })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /pull request comment/i })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /repository page/i })).toBeInTheDocument();
  });

  it("renders NotFound for an unknown slug", () => {
    renderAt("/blog/does-not-exist");
    expect(
      screen.getByRole("heading", { level: 1, name: /not found/i }),
    ).toBeInTheDocument();
  });
});
