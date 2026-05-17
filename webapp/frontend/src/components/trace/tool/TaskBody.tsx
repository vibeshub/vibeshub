import { TaskStatusIcon } from "../icons";

interface Props {
  mode: "create" | "update";
  input: Record<string, unknown>;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function TaskBody({ mode, input }: Props) {
  if (mode === "create") {
    const subject = asString(input.subject) || asString(input.activeForm);
    const description = asString(input.description);
    return (
      <>
        <h4>New task</h4>
        <div className="task-row">
          <span className="task-status">
            <TaskStatusIcon status="pending" />
          </span>
          <span className="task-text">{subject}</span>
        </div>
        {description && <div className="task-description">{description}</div>}
      </>
    );
  }

  const status = asString(input.status);
  const taskId = asString(input.taskId);
  return (
    <div className="task-row">
      <span className="task-status">
        <TaskStatusIcon status={status} />
      </span>
      <span
        className={"task-text" + (status === "completed" ? " done" : "")}
      >
        Task {taskId} → <strong>{status}</strong>
      </span>
    </div>
  );
}
