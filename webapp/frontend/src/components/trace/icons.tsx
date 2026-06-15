export function Chev() {
  return (
    <svg className="chev" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M6 4 L10 8 L6 12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconCopy() {
  return (
    <svg className="iconbtn-icon" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect
        x="4"
        y="4"
        width="9"
        height="9"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M11.5 4 V3.5 a1.5 1.5 0 0 0 -1.5 -1.5 H4 a1.5 1.5 0 0 0 -1.5 1.5 V10 a1.5 1.5 0 0 0 1.5 1.5 H4.5"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </svg>
  );
}

export function IconLink() {
  return (
    <svg className="iconbtn-icon" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M6.5 9.5 L9.5 6.5 M7 4 L9 2 a2.83 2.83 0 0 1 4 4 L11 8 M9 12 L7 14 a2.83 2.83 0 0 1 -4 -4 L5 8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

// The X (Twitter) wordmark glyph, filled to read at icon size.
export function IconX() {
  return (
    <svg className="iconbtn-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M9.27 6.94 14.32 1h-1.2L8.74 6.16 5.23 1H1.18l5.3 7.78L1.18 15h1.2l4.63-5.43L10.77 15h4.05L9.27 6.94Zm-1.64 1.93-.54-.78L2.8 1.91h1.84l3.45 5 .54.78 4.48 6.5h-1.84l-3.66-5.3Z" />
    </svg>
  );
}

export function IconSun() {
  return (
    <svg className="iconbtn-icon" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 1.5 V3 M8 13 V14.5 M1.5 8 H3 M13 8 H14.5 M3.4 3.4 L4.5 4.5 M11.5 11.5 L12.6 12.6 M12.6 3.4 L11.5 4.5 M4.5 11.5 L3.4 12.6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconMoon() {
  return (
    <svg className="iconbtn-icon" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M13.5 9.5 A6 6 0 1 1 6.5 2.5 A4.6 4.6 0 0 0 13.5 9.5 Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconFile() {
  return (
    <svg className="icon" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M4 1.5 H9.5 L13 5 V14 a0.5 0.5 0 0 1 -0.5 0.5 H4 a0.5 0.5 0 0 1 -0.5 -0.5 V2 a0.5 0.5 0 0 1 0.5 -0.5 z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M9.5 1.5 V5 H13" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function IconPR() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="4" cy="3.5" r="1.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="4" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M4 5 V10.5 M12 10.5 V7 a2 2 0 0 0 -2 -2 H8 M8 5 L10 3 M8 5 L10 7"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconSkill() {
  return (
    <svg className="icon" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 1.5 L10 6 L14.5 6 L11 9 L12.5 13.5 L8 11 L3.5 13.5 L5 9 L1.5 6 L6 6 Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TaskStatusIcon({
  status,
}: {
  status: "pending" | "in_progress" | "active" | "completed" | string;
}) {
  if (status === "completed") {
    return (
      <svg className="task-status-icon" viewBox="0 0 16 16" fill="none">
        <circle
          cx="8"
          cy="8"
          r="6.5"
          fill="var(--accent)"
          stroke="var(--accent)"
        />
        <path
          d="M5 8 L7 10 L11 6"
          stroke="var(--accent-fg)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    );
  }
  if (status === "in_progress" || status === "active") {
    return (
      <svg className="task-status-icon" viewBox="0 0 16 16" fill="none">
        <circle
          cx="8"
          cy="8"
          r="6.5"
          stroke="var(--accent)"
          strokeWidth="1.5"
        />
        <circle cx="8" cy="8" r="3" fill="var(--accent)" />
      </svg>
    );
  }
  return (
    <svg className="task-status-icon" viewBox="0 0 16 16" fill="none">
      <circle
        cx="8"
        cy="8"
        r="6.5"
        stroke="var(--text-faint)"
        strokeWidth="1.3"
        strokeDasharray="2 2"
      />
    </svg>
  );
}
