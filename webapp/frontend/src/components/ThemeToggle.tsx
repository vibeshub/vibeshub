import { useTheme } from "../useTheme";
import { IconMoon, IconSun } from "./trace/icons";

// Sun/moon theme toggle, shared by every topbar (PageTopbar + the trace
// viewer's ViewerTopbar) so dark/light is reachable site-wide. The theme state,
// persistence and OS-preference default all live in useTheme.
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const label =
    theme === "dark" ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button
      className="iconbtn"
      onClick={toggleTheme}
      type="button"
      aria-label={label}
      title={label}
    >
      {theme === "dark" ? <IconSun /> : <IconMoon />}
    </button>
  );
}
