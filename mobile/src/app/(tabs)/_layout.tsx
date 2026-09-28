import { Alert, Pressable, View } from "react-native";
import { Tabs } from "expo-router";
import { ChartColumn, CircleUser, FileText, StickyNote, Users } from "lucide-react-native";
import { SyncBadge } from "@/components/SyncBadge";
import { wipeLocalData } from "@/db/database";
import { useAuth } from "@/lib/auth";
import { font, usePalette } from "@/lib/theme";
import { syncSummary } from "@/sync/status";
import { useSync } from "@/sync/SyncProvider";
import { sendTestNotification } from "@/push/PushManager";
import { useToast } from "@/components/Toast";

/**
 * Signing out on purpose also clears the notes from this phone. Changes that
 * have not reached the server would go with them, so that is asked first.
 */
function AccountButton() {
  const { state, signOut } = useAuth();
  const { status, pending } = useSync();
  const c = usePalette();
  const email = state.status === "signed-in" ? state.email : null;
  const toast = useToast();

  // Now, or in 10 s — time to close the app and see a push arrive in the
  // background, the way the daily reminders will.
  const testNotification = () => {
    if (state.status !== "signed-in") return;
    const token = state.token;
    const run = (delay: 0 | 10) => void sendTestNotification(token, delay).then((m) => toast(m));
    Alert.alert("Test notification", "Send a test push to this phone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Now", onPress: () => run(0) },
      { text: "In 10 s", onPress: () => run(10) },
    ]);
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
        Alert.alert(email ?? "Signed in", `This phone is signed in to book.\n\n${syncSummary(status, pending, new Date())}`, [
          { text: "Test notification", onPress: testNotification },
          { text: "Cancel", style: "cancel" },
          { text: "Sign out", style: "destructive", onPress: confirmSignOut },
        ])
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
