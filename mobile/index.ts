// The push task must exist before anything else loads: a push that arrives
// with the app closed starts this bundle headless, with no screens, and only
// what module scope registered runs. Then the router, as before.
import "./src/push/task";
import "expo-router/entry";
