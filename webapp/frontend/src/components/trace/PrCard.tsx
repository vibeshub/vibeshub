import type { PrLinkEvent } from "./types";
import { IconPR } from "./icons";

interface Props {
  event: PrLinkEvent;
}

export function PrCard({ event }: Props) {
  const p = event.payload;
  return (
    <div className="pr-card">
      <div className="pr-card-icon">
        <IconPR />
      </div>
      <div className="pr-card-body">
        <div className="pr-card-label">Pull request opened</div>
        <div className="pr-card-title">
          {p.prRepository} #{p.prNumber}
        </div>
      </div>
      <a
        className="pr-card-link"
        href={p.prUrl}
        target="_blank"
        rel="noreferrer"
      >
        view on GitHub →
      </a>
    </div>
  );
}
