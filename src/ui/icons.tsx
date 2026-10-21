// A handful of inline icons, drawn in the current text colour. Decorative only: every icon sits beside text that says
// the same thing, so each is hidden from assistive technology (kanban-board: "Visual design follows the grey and indigo
// token set"). No icon package and nothing fetched: the path data is copied from Lucide 1.47.0 (lucide-static),
// ISC License, Copyright (c) 2026 Lucide Icons and Contributors.
import type { ComponentChildren } from "preact";

function Icon({ size = 14, children }: { size?: number; children: ComponentChildren }) {
  return (
    <svg
      class="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconSearch = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="m21 21-4.34-4.34" />
    <circle cx="11" cy="11" r="8" />
  </Icon>
);

/** An issue: a dot in a ring (lucide `circle-dot`). */
export const IconCircleDot = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="1" />
  </Icon>
);

export const IconGitPullRequest = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="18" cy="18" r="3" />
    <circle cx="6" cy="6" r="3" />
    <path d="M13 6h3a2 2 0 0 1 2 2v7" />
    <line x1="6" x2="6" y1="9" y2="21" />
  </Icon>
);

export const IconPlus = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M5 12h14" />
    <path d="M12 5v14" />
  </Icon>
);

export const IconRefresh = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M8 16H3v5" />
  </Icon>
);

export const IconSun = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2" />
    <path d="M12 20v2" />
    <path d="m4.93 4.93 1.41 1.41" />
    <path d="m17.66 17.66 1.41 1.41" />
    <path d="M2 12h2" />
    <path d="M20 12h2" />
    <path d="m6.34 17.66-1.41 1.41" />
    <path d="m19.07 4.93-1.41 1.41" />
  </Icon>
);

export const IconMoon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />
  </Icon>
);

export const IconMonitor = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect width="20" height="14" x="2" y="3" rx="2" />
    <line x1="8" x2="16" y1="21" y2="21" />
    <line x1="12" x2="12" y1="17" y2="21" />
  </Icon>
);

export const IconChevronRight = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="m9 18 6-6-6-6" />
  </Icon>
);

export const IconX = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </Icon>
);

export const IconChevronDown = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);

export const IconRotateCcw = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </Icon>
);

export const IconClock = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </Icon>
);

export const IconArchive = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect width="20" height="5" x="2" y="3" rx="1" />
    <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
    <path d="M10 12h4" />
  </Icon>
);

export const IconFolderGit = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M18 19a5 5 0 0 1-5-5v8" />
    <path d="M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5" />
    <circle cx="13" cy="12" r="2" />
    <circle cx="20" cy="19" r="2" />
  </Icon>
);

export const IconFolder = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </Icon>
);

export const IconCheck = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
);

export const IconCopy = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </Icon>
);

export const IconLayoutGrid = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect width="7" height="7" x="3" y="3" rx="1" />
    <rect width="7" height="7" x="14" y="3" rx="1" />
    <rect width="7" height="7" x="14" y="14" rx="1" />
    <rect width="7" height="7" x="3" y="14" rx="1" />
  </Icon>
);

export const IconKanban = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M8 7v7" />
    <path d="M12 7v4" />
    <path d="M16 7v9" />
  </Icon>
);

export const IconActivity = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />
  </Icon>
);

export const IconSettings = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

export const IconHelp = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <path d="M12 17h.01" />
  </Icon>
);

/** Details: an i in a circle (lucide `info`). */
export const IconInfo = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </Icon>
);

export const IconGitBranch = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M15 6a9 9 0 0 0-9 9V3" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
  </Icon>
);

export const IconColumns = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M9 3v18" />
    <path d="M15 3v18" />
  </Icon>
);

export const IconRows = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M21 9H3" />
    <path d="M21 15H3" />
  </Icon>
);

export const IconTerminal = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M12 19h8" />
    <path d="m4 17 6-6-6-6" />
  </Icon>
);

export const IconFilePlus = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M11.35 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5.35" />
    <path d="M14 2v5a1 1 0 0 0 1 1h5" />
    <path d="M14 19h6" />
    <path d="M17 16v6" />
  </Icon>
);

export const IconEyeOff = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
    <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
    <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
    <path d="m2 2 20 20" />
  </Icon>
);

/** Lucide `scan`: marks a label the scan detected, as opposed to one the user gave. */
export const IconScan = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M3 7V5a2 2 0 0 1 2-2h2" />
    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
    <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
  </Icon>
);

/** Lucide `pencil`: Rename on an overview row or tile. */
export const IconPencil = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
    <path d="m15 5 4 4" />
  </Icon>
);

/** Lucide `tag`: a project's labels dialog on the overview. */
export const IconTag = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
    <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
  </Icon>
);

/** Lucide `gift`: the What's new button and dialog. */
export const IconGift = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect x="3" y="8" width="18" height="4" rx="1" />
    <path d="M12 8v13" />
    <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
    <path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" />
  </Icon>
);
