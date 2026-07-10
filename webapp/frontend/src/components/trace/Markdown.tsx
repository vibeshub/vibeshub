import { Fragment, useMemo } from "react";
import { inlineFormat, renderMarkdownish, splitRedactions } from "./format";

interface Props {
  text: string;
}

export function RedactedText({ text }: { text: string }) {
  const spans = splitRedactions(text);
  if (spans.length === 1 && spans[0].t === "text") return <>{text}</>;
  return (
    <>
      {spans.map((s, i) =>
        s.t === "redacted" ? (
          <span
            key={i}
            className="redaction-chip"
            title="Removed when this trace was uploaded"
          >
            {s.text}
          </span>
        ) : (
          <Fragment key={i}>{s.text}</Fragment>
        ),
      )}
    </>
  );
}

function InlineSpans({ text, kp = "" }: { text: string; kp?: string }) {
  const parts = inlineFormat(text);
  return (
    <>
      {parts.map((p, j) => {
        if (p.t === "strong") return <strong key={kp + j}>{p.text}</strong>;
        if (p.t === "em") return <em key={kp + j}>{p.text}</em>;
        if (p.t === "code") return <code key={kp + j}>{p.text}</code>;
        return <RedactedText key={kp + j} text={p.text} />;
      })}
    </>
  );
}

export function Markdown({ text }: Props) {
  const blocks = useMemo(() => renderMarkdownish(text), [text]);
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === "h2") {
          return (
            <h2 key={i}>
              <InlineSpans text={b.text} kp={`${i}-`} />
            </h2>
          );
        }
        if (b.type === "h3") {
          return (
            <h3 key={i}>
              <InlineSpans text={b.text} kp={`${i}-`} />
            </h3>
          );
        }
        if (b.type === "code") {
          return (
            <pre key={i} className="code-block" data-lang={b.lang}>
              <code>{b.text}</code>
            </pre>
          );
        }
        if (b.type === "ul") {
          return (
            <ul key={i}>
              {b.items.map((it, j) => (
                <li key={j}>
                  <InlineSpans text={it} kp={`${i}-${j}-`} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i}>
            <InlineSpans text={b.text} kp={`${i}-`} />
          </p>
        );
      })}
    </>
  );
}
