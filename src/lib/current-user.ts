// v1 has no login. This is the single choke point for identity: when real
// authentication is added, this function is the only one that changes, and
// every route that calls it keeps working unmodified.
export const LOCAL_USER_ID = "00000000-0000-4000-8000-000000000001";

export async function getCurrentUserId(): Promise<string> {
  return LOCAL_USER_ID;
}
