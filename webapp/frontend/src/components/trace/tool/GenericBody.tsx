import type { ToolResult } from "../types";
import { clip, stringifyToolInput } from "../format";

interface Props {
  input: Record<string, unknown>;
  result: ToolResult | null;
}

export function GenericBody({ input, result }: Props) {
  return (
    <>
      <h4>Input</h4>
      <div className="json-block">{stringifyToolInput(input)}</div>
      {result?.content != null && (
        <>
          <h4>Result</h4>
          <div className="json-block">
            {typeof result.content === "string"
              ? clip(result.content, 6000)
              : stringifyToolInput(result.content)}
          </div>
        </>
      )}
    </>
  );
}
