import { IconSkill } from "../icons";

interface Props {
  input: Record<string, unknown>;
}

export function SkillBody({ input }: Props) {
  const skill = typeof input.skill === "string" ? input.skill : "";
  return (
    <div className="file-card">
      <IconSkill />
      <span className="file-path mono">{skill}</span>
    </div>
  );
}
