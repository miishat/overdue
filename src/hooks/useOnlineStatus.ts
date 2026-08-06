"use client";

import { useEffect, useState } from "react";

/**
 * Whether the browser thinks it has a network connection.
 *
 * Starts at true and corrects in an effect rather than reading
 * navigator.onLine during render. The server has no navigator, so reading it
 * during render would either throw or produce markup that disagrees with the
 * server's, and React would report a hydration mismatch on every load. The
 * cost is one frame in which an offline page claims to be online, which
 * nobody will see.
 *
 * navigator.onLine is famously weak: it reports true for a machine attached
 * to a network that reaches nothing. That is fine here. This drives an
 * informational banner, not a decision about whether to fetch, and a false
 * "you are online" simply shows nothing, which is the pre-M4 behaviour.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOnline(navigator.onLine);

    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}
