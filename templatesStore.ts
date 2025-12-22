import Dexie, { Table } from "dexie";

export type TemplateRecord = {
  id: string;
  name: string;
  size: number;
  createdAt: number;
  bytes: Uint8Array;
};

const DB_NAME = "hm_pdf_templates_v1";
const MAX_TEMPLATE_MB = 15;

class TemplatesDB extends Dexie {
  templates!: Table<TemplateRecord, string>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({
      templates: "id",
    });
  }
}

const db = new TemplatesDB();

const sanitizeName = (name: string) =>
  (name || "plantilla")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_\-\.]/g, "")
    .slice(0, 80) || "plantilla";

const newId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `tpl_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
};

export async function addTemplateFromFile(file: File): Promise<TemplateRecord> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sizeMb = bytes.length / (1024 * 1024);
  if (sizeMb > MAX_TEMPLATE_MB) {
    throw new Error(`El PDF pesa ${sizeMb.toFixed(1)} MB. Límite: ${MAX_TEMPLATE_MB} MB.`);
  }

  const rec: TemplateRecord = {
    id: newId(),
    name: sanitizeName(file.name.replace(/\.pdf$/i, "")),
    size: bytes.length,
    createdAt: Date.now(),
    bytes,
  };

  await db.templates.put(rec);
  return rec;
}

export async function listTemplates(): Promise<TemplateRecord[]> {
  const items = await db.templates.toArray();
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getTemplateBytes(id: string): Promise<Uint8Array | null> {
  const rec = await db.templates.get(id);
  return rec ? rec.bytes : null;
}

export async function deleteTemplate(id: string): Promise<void> {
  await db.templates.delete(id);
}
