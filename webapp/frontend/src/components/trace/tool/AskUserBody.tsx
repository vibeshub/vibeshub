import type { ToolResult } from "../types";

interface Props {
  input: Record<string, unknown>;
  result: ToolResult | null;
  followingPrompt: string | null;
}

interface Option {
  label: string;
  description?: string;
}

interface Question {
  question: string;
  header?: string;
  options?: Array<string | Option>;
}

function normalizeOption(o: string | Option): Option {
  return typeof o === "string" ? { label: o } : o;
}

function pickChosen(result: ToolResult | null): string | null {
  if (!result) return null;
  const c = result.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    for (const b of c) {
      if (typeof b === "string") return b;
      if (b && typeof b === "object") {
        const o = b as Record<string, unknown>;
        if (typeof o.text === "string") return o.text;
      }
    }
  }
  return null;
}

export function AskUserBody({ input, result, followingPrompt }: Props) {
  const qs = (input.questions as Question[]) ?? [];
  const chosen = pickChosen(result);

  return (
    <>
      {qs.map((q, i) => (
        <div className="ask-question" key={i}>
          {q.header && <div className="ask-question-header">{q.header}</div>}
          <div className="ask-question-title">{q.question}</div>
          <div className="ask-options">
            {(q.options ?? []).map((raw, j) => {
              const o = normalizeOption(raw);
              const isChosen = Boolean(
                (chosen && chosen.includes(o.label)) ||
                  (followingPrompt && followingPrompt.includes(o.label)),
              );
              return (
                <div
                  className={"ask-option" + (isChosen ? " chosen" : "")}
                  key={j}
                >
                  <div className="ask-option-label">
                    {o.label}
                    {isChosen && (
                      <span className="ask-chosen-marker">picked</span>
                    )}
                  </div>
                  {o.description && (
                    <div className="ask-option-desc">{o.description}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}
