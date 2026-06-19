import { clearSendMemory, listSendMemory, rememberSendMemory } from "../../../tauri";

const maxSendHistory = 20;

export async function loadSendHistory() {
  return listSendMemory();
}

export async function saveSendHistoryItem(text: string) {
  return rememberSendMemory({ text });
}

export async function clearSavedSendHistory() {
  await clearSendMemory();
}

export function rememberSendHistoryItem(history: string[], text: string) {
  const value = text.trim();
  if (!value) {
    return history;
  }
  return [value, ...history.filter((item) => item !== value)].slice(0, maxSendHistory);
}
