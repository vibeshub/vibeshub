import { Component, type ErrorInfo, type ReactNode } from "react";
import { ErrorState } from "./ErrorState";

interface Props {
  /** Shown in place of the crashed subtree; keep it short. */
  label: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches a render-time throw in its subtree and swaps in the app's usual
 * error panel instead of letting React unmount the whole page. Wrap large,
 * data-driven subtrees (the trace viewer) so one malformed record degrades
 * a section rather than the site.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[vibeshub] ${this.props.label} crashed`, error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorState
          message={`${this.props.label} could not be rendered: ${
            this.state.error.message || "unexpected error"
          }`}
        />
      );
    }
    return this.props.children;
  }
}
