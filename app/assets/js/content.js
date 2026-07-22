/* =========================================================================
   TONA — Rendu de contenu (Markdown léger + LaTeX + Cloze deletions)
   ========================================================================= 
   Ce module ne dépend d'aucune bibliothèque externe : il produit du HTML sûr
   (tout est échappé avant transformation, aucune injection de HTML brut n'est
   jamais autorisée) à partir d'un sous-ensemble de Markdown. Les formules
   LaTeX ($...$ et $$...$$) sont préservées telles quelles dans le texte
   rendu : c'est KaTeX (chargé à part, voir index.html) qui les repère et les
   compile après l'insertion dans le DOM, via son extension "auto-render".
   ========================================================================= */

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Extrait les zones LaTeX ($$...$$ puis $...$) et les remplace par des jetons, pour les protéger des
 * transformations Markdown (ex: un simple '*' dans une formule ne doit pas être lu comme de l'italique). */
function extractMathSpans(raw) {
  const spans = [];
  const stash = (s) => {
    const token = `\u0000MATH${spans.length}\u0000`;
    spans.push(s);
    return token;
  };
  let text = String(raw ?? "");
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, inner) => stash(`$$${inner}$$`));
  text = text.replace(/\$([^\$\n]+?)\$/g, (_, inner) => stash(`$${inner}$`));
  return { text, spans };
}

function restoreMathSpans(html, spans) {
  return html.replace(/\u0000MATH(\d+)\u0000/g, (_, i) => escapeHtml(spans[Number(i)]));
}

/** Sous-ensemble volontairement restreint de Markdown : gras, italique, code, citations, listes, paragraphes. */
function renderMarkdownLite(raw) {
  const { text: withPlaceholders, spans } = extractMathSpans(raw);
  let text = escapeHtml(withPlaceholders);

  // Blocs de code ```...``` (protégés avant tout le reste)
  const codeBlocks = [];
  text = text.replace(/```([\s\S]*?)```/g, (_, code) => {
    const token = `\u0001CODEBLOCK${codeBlocks.length}\u0001`;
    codeBlocks.push(code);
    return token;
  });

  // Code inline `texte`
  text = text.replace(/`([^`\n]+?)`/g, "<code>$1</code>");
  // Gras puis italique (dans cet ordre, pour ne pas confondre ** et *)
  text = text.replace(/\*\*([^\n]+?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^\n]+?)__/g, "<strong>$1</strong>");
  text = text.replace(/(?<!\*)\*([^\n*]+?)\*(?!\*)/g, "<em>$1</em>");
  text = text.replace(/(?<!_)_([^\n_]+?)_(?!_)/g, "<em>$1</em>");

  // Découpage en blocs séparés par une ligne vide
  const blocks = text.split(/\n{2,}/);
  const html = blocks
    .map((block) => {
      const lines = block.split("\n").map((l) => l.trim()).filter((l) => l.length);
      if (!lines.length) return "";
      if (lines.every((l) => /^[-*]\s+/.test(l))) {
        return "<ul>" + lines.map((l) => `<li>${l.replace(/^[-*]\s+/, "")}</li>`).join("") + "</ul>";
      }
      if (lines.every((l) => /^\d+[.)]\s+/.test(l))) {
        return "<ol>" + lines.map((l) => `<li>${l.replace(/^\d+[.)]\s+/, "")}</li>`).join("") + "</ol>";
      }
      if (lines.every((l) => /^>\s?/.test(l))) {
        return "<blockquote>" + lines.map((l) => l.replace(/^>\s?/, "")).join("<br>") + "</blockquote>";
      }
      return "<p>" + lines.join("<br>") + "</p>";
    })
    .join("");

  let result = restoreMathSpans(html, spans);
  result = result.replace(/\u0001CODEBLOCK(\d+)\u0001/g, (_, i) => `<pre><code>${escapeHtml(codeBlocks[Number(i)].trim())}</code></pre>`);
  return result;
}

export { renderMarkdownLite as renderMarkdown };

/* ----- Cloze deletions : {{c1::texte::indice}} ---------------------------
   Limite connue et assumée : si le texte masqué contient lui-même la
   séquence littérale "}}" (très rare), le motif non-glouton peut se refermer
   trop tôt. Les accolades simples des formules LaTeX (\frac{a}{b}) ne posent
   pas de problème car elles ne comportent jamais de double accolade fermante.
   --------------------------------------------------------------------- */
const CLOZE_RE = /\{\{c(\d+)::(.+?)(?:::(.*?))?\}\}/g;

/** Liste les numéros de cloze distincts (1, 2, ...) présents dans une note. */
export function clozeNumbers(noteText) {
  const nums = new Set();
  let m;
  const re = new RegExp(CLOZE_RE);
  while ((m = re.exec(noteText))) nums.add(Number(m[1]));
  return [...nums].sort((a, b) => a - b);
}

export function hasCloze(noteText) {
  return new RegExp(CLOZE_RE).test(String(noteText ?? ""));
}

/**
 * Construit, pour un numéro de cloze donné, le texte brut (encore en Markdown/LaTeX,
 * pas encore rendu en HTML) du recto et du verso.
 * - Recto : le cloze ciblé est masqué ("[...]", ou son indice s'il existe) ; les autres clozes de la même
 *   note sont affichés normalement (résolus), pour conserver le contexte.
 * - Verso : le cloze ciblé est révélé (mis en évidence) ; les autres sont résolus comme sur le recto.
 */
export function buildClozeSides(noteText, targetNumber) {
  const re = new RegExp(CLOZE_RE);
  const front = String(noteText ?? "").replace(re, (_, num, answer, hint) => {
    if (Number(num) !== targetNumber) return answer;
    return hint ? `**[…${hint}]**` : "**[...]**";
  });
  const re2 = new RegExp(CLOZE_RE);
  const back = String(noteText ?? "").replace(re2, (_, num, answer) => {
    if (Number(num) !== targetNumber) return answer;
    return `**${answer}**`;
  });
  return { front, back };
}

/**
 * À partir d'une note contenant un ou plusieurs cloze, génère les cartes {front, back} à créer
 * (une par numéro de cloze distinct). Retourne [] si la note ne contient aucun cloze.
 */
export function buildClozeCards(noteText) {
  return clozeNumbers(noteText).map((n) => ({ clozeNumber: n, ...buildClozeSides(noteText, n) }));
}
