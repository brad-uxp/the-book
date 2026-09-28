/**
 * When the phone counts as online, for the sync engine.
 *
 * Only whether Android has a network — not NetInfo's "internet reachable"
 * check. That check requests a Google URL (clients3.google.com/generate_204)
 * every so often, which book. does not want its app doing; and after a
 * network comes back it keeps reporting the old "unreachable" until its next
 * probe, up to a minute later, so the sync waited that long to start. The
 * engine switches the probe off (NetInfo.configure) and lets its own request
 * to book. find out whether the internet is really there: if it isn't, the
 * run fails and is retried like any other failure.
 */
export function isOnline(state: { isConnected: boolean | null }): boolean {
  // null = not known yet (the first event): assume online and let the request tell.
  return state.isConnected !== false;
}
