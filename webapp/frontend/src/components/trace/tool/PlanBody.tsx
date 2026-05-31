interface Props {
  input: Record<string, unknown>;
}

function symbolFor(status: unknown): string {
  if (status === "completed") return "✓";
  if (status === "in_progress") return "◐";
  return "○";
}

export function PlanBody({ input }: Props) {
  const plan = (input.plan as Array<{ step?: string; status?: string }>) || [];
  if (plan.length === 0) return null;
  return (
    <ol className="plan-body">
      {plan.map((p, i) => (
        <li key={i} className={`plan-item plan-${p.status ?? "pending"}`}>
          <span className="plan-status">{symbolFor(p.status)}</span>
          <span className="plan-step">{p.step ?? ""}</span>
        </li>
      ))}
    </ol>
  );
}
