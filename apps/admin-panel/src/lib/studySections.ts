import {
  CarFront,
  Database,
  FileText,
  GalleryThumbnails,
  ScanEye,
  TestTubeDiagonal,
  Users,
  Activity
} from "lucide-svelte";

export type StudySectionKey =
  | "overview"
  | "participants"
  | "conditions"
  | "simulator"
  | "sensors"
  | "participant-view"
  | "sessions"
  | "active-study";

type StudySection = {
  path: string;
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon?: any;
};

/**
 * Single source of truth for per-study navigation labels. StudyTabs and the
 * Overview page's Quick Start checklist both read from this so the two
 * cannot drift into different names for the same feature.
 */
export const STUDY_SECTIONS: Record<StudySectionKey, StudySection> = {
  overview: { path: "overview", label: "Overview", icon: FileText },
  participants: { path: "participants", label: "Participants", icon: Users },
  conditions: {
    path: "conditions",
    label: "Conditions",
    icon: TestTubeDiagonal,
  },
  simulator: {
    path: "carla-config",
    label: "Simulator Setup",
    icon: CarFront,
  },
  sensors: { path: "sensors", label: "Sensors", icon: ScanEye },
  "participant-view": {
    path: "participant-view",
    label: "Participant View",
    icon: GalleryThumbnails,
  },
  sessions: { path: "sessions", label: "Sessions", icon: Database },
  "active-study": { path: "active-study", label: "Active Study", icon: Activity },
};

export const STUDY_SECTION_ORDER: StudySectionKey[] = [
  "overview",
  "participants",
  "conditions",
  "simulator",
  "sensors",
  "participant-view",
  "sessions",
  "active-study",
];

export function studySectionHref(studyId: string, key: StudySectionKey) {
  return `/user-studies/${studyId}/${STUDY_SECTIONS[key].path}`;
}
