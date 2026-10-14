/** Lets the connected layer hear about contest switches without the store importing it. */
let hook: ((id: string) => void) | null = null;
export function setContestSwitchHook(fn: (id: string) => void) {
  hook = fn;
}
export function contestSwitched(id: string) {
  hook?.(id);
}
