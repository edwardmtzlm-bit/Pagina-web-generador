export type HistoryItem = {
  id: string;
  title: string;
  bodyPreview: string;
  bodyFull: string; // recortado (máx. 20k chars)
  protected: boolean;
  templateName: string | null;
  createdAt: string; // ISO
  pages?: number;
};

export const HISTORY_KEY = "hm_pdf_history_v1";

export function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as HistoryItem[];
  } catch {
    return [];
  }
}

export function saveHistory(items: HistoryItem[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
  } catch {
    // si se llena el localStorage, no rompemos la app
  }
}

export function clearAllHistory() {
  saveHistory([]);
}

export function deleteHistoryItem(id: string) {
  const items = loadHistory();
  const next = items.filter((x) => x.id !== id);
  saveHistory(next);
  return next;
}
