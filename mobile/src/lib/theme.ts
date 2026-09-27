import { useColorScheme } from "react-native";

/**
 * The web's zinc palette with the brand's violet, in both themes. The app
 * follows the system setting.
 */
const light = {
  bg: "#FFFFFF",
  surface: "#F4F4F5",
  raised: "#FFFFFF",
  line: "#E4E4E7",
  ink: "#18181B",
  muted: "#71717A",
  faint: "#A1A1AA",
  primary: "#18181B",
  onPrimary: "#FAFAFA",
  accent: "#8B5CF6",
  soon: "#D97706",
  overdue: "#DC2626",
  danger: "#DC2626",
};

const dark: typeof light = {
  bg: "#0C0C0E",
  surface: "#18181B",
  raised: "#1C1C20",
  line: "#27272A",
  ink: "#F4F4F5",
  muted: "#A1A1AA",
  faint: "#71717A",
  primary: "#F4F4F5",
  onPrimary: "#18181B",
  accent: "#8B5CF6",
  soon: "#FBBF24",
  overdue: "#F87171",
  danger: "#F87171",
};

export type Palette = typeof light;

export function usePalette(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}

export function useIsDark(): boolean {
  return useColorScheme() === "dark";
}

/** Inter, as on the web. Loaded in the root layout before anything renders. */
export const font = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
} as const;

/** Task status colours — the same values the web's board uses. */
export const statusColor: Record<string, string> = {
  pending: "#94A3B8",
  in_progress: "#3B82F6",
  blocked: "#F97316",
  done: "#10B981",
};

export const statusLabel: Record<string, string> = {
  pending: "Pending",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};
