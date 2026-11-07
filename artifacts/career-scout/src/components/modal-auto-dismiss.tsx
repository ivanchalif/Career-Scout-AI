import { createContext, useContext, useEffect, useRef } from "react";
import { startModalAutoDismiss } from "@/lib/modal-auto-dismiss";

export const ModalAutoDismissContext = createContext<{
  owner: string; open: boolean; paused: boolean; close: () => void;
} | null>(null);

export function useModalOwner() {
  return useContext(ModalAutoDismissContext)?.owner;
}

export function useModalAutoDismiss(element: HTMLDivElement | null) {
  const modal = useContext(ModalAutoDismissContext);
  const close = useRef(modal?.close);
  close.current = modal?.close;
  useEffect(() => {
    if (!modal?.open || modal.paused || !element) return;
    return startModalAutoDismiss(element, modal.owner, () => close.current?.());
  }, [modal?.open, modal?.paused, modal?.owner, element]);
}
