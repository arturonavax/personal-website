import { atom } from "nanostores";

export const isSearchOpen = atom<boolean>(false);
export const isShortcutsOpen = atom<boolean>(false);
export const isSponsorshipModalOpen = atom<boolean>(false);

export function toggleSearchModal(forceState?: boolean) {
  isSearchOpen.set(forceState !== undefined ? forceState : !isSearchOpen.get());
}

export function toggleShortcutsModal(forceState?: boolean) {
  isShortcutsOpen.set(
    forceState !== undefined ? forceState : !isShortcutsOpen.get(),
  );
}

export function toggleSponsorshipModal(forceState?: boolean) {
  isSponsorshipModalOpen.set(
    forceState !== undefined ? forceState : !isSponsorshipModalOpen.get(),
  );
}
