/* =========================================================================
   TONA — CSV (parsing RFC4180 simplifié + génération)
   ========================================================================= */

export function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  text = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += c;
    }
  }
  row.push(field);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

function csvField(s) {
  s = String(s ?? "");
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCSV(rows) {
  return rows.map((r) => r.map(csvField).join(",")).join("\r\n");
}
