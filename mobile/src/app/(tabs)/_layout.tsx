import { Alert, Pressable } from "react-native";
import { Tabs } from "expo-router";
import { ChartColumn, CircleUser, FileText, StickyNote, Users } from "lucide-react-native";
import { useAuth } from "@/lib/auth";
import { font, usePalette } from "@/lib/theme";

function AccountButton() {
  const { state, signOut } = useAuth();
  const c = usePalette();
  const email = state.status === "signed-in" ? state.email : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Account"
      hitSlop={10}
      style={{ marginRight: 16 }}
      onPress={() =>
        Alert.alert(email ?? "Signed in", "This phone is signed in to book.", [
          { text: "Cancel", style: "cancel" },
          { text: "Sign out", style: "destructive", onPress: () => signOut() },
        ])
      }
    >
      <CircleUser size={24} color={c.ink} strokeWidth={1.8} />
    </Pressable>
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
        headerRight: () => <AccountButton />,
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
