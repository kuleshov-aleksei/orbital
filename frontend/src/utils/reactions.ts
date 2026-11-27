/** Reactor ids with the current user first, the rest in reaction order. */
export function orderReactors(userIds: string[], myUserId: string): string[] {
  if (!myUserId || !userIds.includes(myUserId)) return [...userIds]
  return [myUserId, ...userIds.filter((id) => id !== myUserId)]
}
