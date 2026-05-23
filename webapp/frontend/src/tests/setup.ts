import "@testing-library/jest-dom";

// localStorage persists within a test file's jsdom; clear it between tests
// so persisted preferences (theme, trace Expand tool calls mode) don't leak.
afterEach(() => {
  localStorage.clear();
});
