import { Alert, Pressable, View } from "react-native";
import { Tabs } from "expo-router";
import { ChartColumn, CircleUser, FileText, StickyNote, Users } from "lucide-react-native";
import { SyncBadge } from "@/components/SyncBadge";
import { wipeLocalData } from "@/db/database";
import { useAuth } from "@/lib/auth";
import { font, usePalette } from "@/lib/theme";
import { syncSummary } from "@/sync/status";
import { useSync } from "@/sync/SyncProvider";
import { useUpdate } from "@/update/UpdateProvider";

/**
 * Signing out on purpose also clears the notes from this phone. Changes that
 * have not reached the server would go with them, so that is asked first.
 */
function AccountButton() {
  const { state, signOut } = useAuth();
  const { status, pending } = useSync();
  const update = useUpdate();
  const c = usePalette();
  const email = state.status === "signed-in" ? state.email : null;

  const checkForUpdates = async () => {
    const result = await update.check(true);
    if (result === "error") {
      Alert.alert("Couldn't check for updates", "Check your connection and try again.");
    } else if (result === "current") {
      Alert.alert("You're up to date", `book. ${update.installed.name} is the latest version.`);
    } else if (update.state.status !== "downloading" && update.state.status !== "ready") {
      Alert.alert("Update available", "Download it now? You can keep using the app meanwhile.", [
        { text: "Later", style: "cancel" },
        { text: "Download", onPress: () => void update.download() },
      ]);
    }
  };

  const leave = async () => {
    await signOut();
    await wipeLocalData().catch((err) => console.warn("[account] wipe", err));
  };

  const confirmSignOut = () => {
    if (pending === 0) return void leave();
    Alert.alert(
      "Unsynced changes",
      `${pending === 1 ? "1 change hasn't" : `${pending} changes haven't`} reached the server yet. Signing out deletes ${pending === 1 ? "it" : "them"} from this phone.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Sign out anyway", style: "destructive", onPress: () => void leave() },
      ]
    );
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Account"
      testID="account-button"
      hitSlop={10}
      style={{ marginRight: 16 }}
      onPress={() =>
        Alert.alert(
          email ?? "Signed in",
          `This phone is signed in to book.\n\n${syncSummary(status, pending, new Date())}\n\nVersion ${update.installed.name} (${update.installed.code})`,
          [
            { text: "Check for updates", onPress: () => void checkForUpdates() },
            { text: "Cancel", style: "cancel" },
            { text: "Sign out", style: "destructive", onPress: confirmSignOut },
          ]
        )
      }
    >
      <CircleUser size={24} color={c.ink} strokeWidth={1.8} />
    </Pressable>
  );
}

function HeaderRight() {
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <SyncBadge />
      <AccountButton />
    </View>
  );
}

export default function TabsLayout() {
  const c = usePalette();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: c.bg },
        headerShadowVisible: false,
        headerTitleAlign: "left",
        headerTitleStyle: { fontFamily: font.bold, fontSize: 24, color: c.ink },
        headerRight: () => <HeaderRight />,
        sceneStyle: { backgroundColor: c.bg },
        tabBarStyle: { backgroundColor: c.bg, borderTopColor: c.line },
        tabBarActiveTintColor: c.ink,
        tabBarInactiveTintColor: c.faint,
        tabBarLabelStyle: { fontFamily: font.medium, fontSize: 11 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Notes", tabBarIcon: ({ color }) => <StickyNote size={22} color={color} /> }} />
      <Tabs.Screen name="invoices" options={{ title: "Invoices", tabBarIcon: ({ color }) => <FileText size={22} color={color} /> }} />
      <Tabs.Screen name="salaries" options={{ title: "Salaries", tabBarIcon: ({ color }) => <Users size={22} color={color} /> }} />
      <Tabs.Screen name="metrics" options={{ title: "Metrics", tabBarIcon: ({ color }) => <ChartColumn size={22} color={color} /> }} />
    </Tabs>
  );
}
