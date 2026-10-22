// The site search in the browser (#433): opens the dialog from the header's
// button, `/` or Ctrl+K, loads dist/search.json once, and lists what
// search() in src/lib/search.mjs ranks. Results are plain links, so a
// keyboard, a screen reader and a middle click all treat them as links; the
// arrow keys only move focus between them. The search runs on the page and
// asks no one else, which is the one kind of search that needs no approval.
import { search, words, type SearchRecord } from '../lib/search.mjs';

const dialog = document.getElementById('site-search') as HTMLDialogElement | null;
const input = document.getElementById('site-search-q') as HTMLInputElement | null;
const list = document.getElementById('site-search-results') as HTMLUListElement | null;
const status = document.getElementById('site-search-status');

if (dialog && input && list && status) {
  const base = dialog.dataset.base ?? '';
  let records: SearchRecord[] | undefined;
  let loading: Promise<void> | undefined;
  let opener: HTMLElement | null = null;

  const load = () =>
    (loading ??= fetch(dialog.dataset.index!)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<SearchRecord[]>;
      })
      .then((data) => {
        records = data;
        render();
      })
      .catch(() => {
        loading = undefined;
        status.textContent = import.meta.env.DEV
          ? 'The dev server has no search index: npm run build makes it, and npm run preview serves it.'
          : "The search index didn't load. Reload the page to try again; every page is also linked from the footer.";
      }));

  /** The title, with each query word underlined where it appears. */
  const titleOf = (r: SearchRecord, terms: string[]) => {
    const el = document.createElement('span');
    el.className = r.k === 'Command' || r.k === 'Setting' ? 'search__t search__t--code' : 'search__t';
    const lower = r.t.toLowerCase();
    const marks: [number, number][] = [];
    for (const t of terms) {
      const at = lower.indexOf(t);
      if (at >= 0) marks.push([at, at + t.length]);
    }
    marks.sort((a, b) => a[0] - b[0]);
    let from = 0;
    for (const [start, end] of marks) {
      if (start < from) continue;
      el.append(r.t.slice(from, start));
      const mark = document.createElement('mark');
      mark.textContent = r.t.slice(start, end);
      el.append(mark);
      from = end;
    }
    el.append(r.t.slice(from));
    return el;
  };

  const part = (cls: string, text: string) => {
    const el = document.createElement('span');
    el.className = cls;
    el.textContent = text;
    return el;
  };

  function render() {
    const query = input!.value.trim();
    list!.replaceChildren();
    if (!query) {
      status!.textContent = '';
      return;
    }
    if (!records) {
      status!.textContent = 'Loading the index…';
      return;
    }
    const found = search(records, query, 30);
    const terms = words(query);
    status!.textContent = found.length === 0 ? `Nothing matches “${query}”.` : `${found.length === 30 ? 'Top 30' : found.length} result${found.length === 1 ? '' : 's'}`;
    for (const r of found) {
      const a = document.createElement('a');
      a.href = `${base}${r.u}`;
      a.append(titleOf(r, terms), part('search__k', r.k));
      if (r.p) a.append(part('search__p', r.p));
      if (r.d) a.append(part('search__d', r.d));
      const li = document.createElement('li');
      li.append(a);
      list!.append(li);
    }
  }

  const open = () => {
    if (dialog.open) return;
    opener = document.activeElement as HTMLElement | null;
    dialog.showModal();
    input.select();
    void load();
  };

  // Following a result to a heading on the same page doesn't unload it, so close first.
  list.addEventListener('click', (e) => {
    if ((e.target as Element).closest('a')) dialog.close();
  });
  dialog.addEventListener('close', () => opener?.focus());
  // A click on the backdrop lands on the dialog itself, outside its panel.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  input.addEventListener('input', render);

  const links = () => [...list.querySelectorAll('a')];
  dialog.addEventListener('keydown', (e) => {
    const all = links();
    const at = all.indexOf(document.activeElement as HTMLAnchorElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      all[Math.min(at + 1, all.length - 1)]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (at <= 0) input.focus();
      else all[at - 1]!.focus();
    } else if (e.key === 'Enter' && document.activeElement === input) {
      // The form would close the dialog; Enter in the box opens the best match instead.
      e.preventDefault();
      all[0]?.click();
    }
  });

  for (const button of document.querySelectorAll<HTMLElement>('[data-search-open]')) {
    button.hidden = false;
    button.addEventListener('click', open);
  }

  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    const typing = target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
    if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey) && !e.altKey) {
      e.preventDefault();
      open();
    } else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      open();
    }
  });
}
