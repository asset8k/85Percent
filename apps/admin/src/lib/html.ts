/**
 * html — tiny server-rendering helpers. No template engine: just tagged strings
 * with auto-escaping, plus a shared minimal page shell. Functionality over UI,
 * but clean and readable.
 */

/** Escape a value for safe interpolation into HTML text/attributes. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Raw, pre-trusted HTML (skips escaping). Use only for already-built fragments. */
export class Raw {
  constructor(public readonly html: string) {}
}
export const raw = (html: string) => new Raw(html)

/** Tagged template that escapes interpolations (Raw and arrays pass through). */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = strings[0] ?? ''
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    out += render(v) + (strings[i + 1] ?? '')
  }
  return new Raw(out)
}

function render(v: unknown): string {
  if (v instanceof Raw) return v.html
  if (Array.isArray(v)) return v.map(render).join('')
  if (v == null || v === false) return ''
  return esc(v)
}

const STYLES = `
  :root { --b:#e2e8f0; --bg:#f8fafc; --muted:#64748b; --accent:#7c3aed; --danger:#dc2626; --ok:#16a34a; --amber:#d97706; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif; color:#0f172a; background:var(--bg); }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  header.top { display:flex; align-items:center; gap:20px; padding:12px 24px; background:#fff; border-bottom:1px solid var(--b); }
  header.top .brand { font-weight:700; letter-spacing:-.01em; }
  header.top nav { display:flex; gap:16px; }
  header.top .spacer { flex:1; }
  main { max-width: 1100px; margin: 24px auto; padding: 0 24px; }
  h1 { font-size:20px; margin:0 0 4px; }
  h2 { font-size:15px; margin:24px 0 10px; }
  .muted { color: var(--muted); }
  .card { background:#fff; border:1px solid var(--b); border-radius:10px; padding:18px; margin-bottom:16px; }
  table { width:100%; border-collapse:collapse; background:#fff; border:1px solid var(--b); border-radius:10px; overflow:hidden; }
  th, td { text-align:left; padding:10px 12px; border-bottom:1px solid var(--b); vertical-align:middle; }
  th { background:#f1f5f9; font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); }
  tr:last-child td { border-bottom:0; }
  .num { font-variant-numeric: tabular-nums; }
  label { display:block; font-size:12px; color:var(--muted); margin:10px 0 4px; }
  input, select { width:100%; padding:8px 10px; border:1px solid var(--b); border-radius:8px; font:inherit; background:#fff; }
  .row { display:flex; gap:12px; flex-wrap:wrap; }
  .row > * { flex:1; min-width:160px; }
  button, .btn { display:inline-flex; align-items:center; gap:6px; padding:8px 14px; border-radius:8px; border:1px solid var(--accent); background:var(--accent); color:#fff; font:inherit; font-weight:600; cursor:pointer; }
  button.secondary, .btn.secondary { background:#fff; color:#0f172a; border-color:var(--b); }
  button.danger, .btn.danger { background:var(--danger); border-color:var(--danger); }
  form.inline { display:inline; }
  .pill { display:inline-block; padding:2px 8px; border-radius:999px; font-size:12px; font-weight:600; }
  .pill.ok { background:#dcfce7; color:#15803d; }
  .pill.run { background:#e0e7ff; color:#4338ca; }
  .pill.fail { background:#fee2e2; color:#b91c1c; }
  .pill.low { background:#fef3c7; color:#b45309; }
  .flash { padding:10px 14px; border-radius:8px; margin-bottom:16px; }
  .flash.ok { background:#dcfce7; color:#166534; }
  .flash.err { background:#fee2e2; color:#991b1b; }
  pre { background:#0f172a; color:#e2e8f0; padding:14px; border-radius:8px; overflow:auto; font-size:12px; line-height:1.5; }
  .actions { display:flex; gap:8px; flex-wrap:wrap; }
`

/** Full page shell with the top nav. `flash` shows a transient banner. */
export function page(opts: {
  title: string
  body: Raw
  active?: 'users' | 'jobs'
  flash?: { kind: 'ok' | 'err'; message: string }
}): string {
  const nav = (key: string, href: string, label: string) =>
    html`<a href="${href}" ${opts.active === key ? raw('style="font-weight:700"') : raw('')}>${label}</a>`
  return (
    '<!doctype html>' +
    html`
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>${opts.title} · 85Percent Admin</title>
          <style>${raw(STYLES)}</style>
        </head>
        <body>
          <header class="top">
            <span class="brand">85Percent Admin</span>
            <nav>${nav('users', '/users', 'Users')} ${nav('jobs', '/jobs', 'Jobs')}</nav>
            <span class="spacer"></span>
            <form class="inline" method="post" action="/logout">
              <button class="secondary" type="submit">Sign out</button>
            </form>
          </header>
          <main>
            ${opts.flash ? html`<div class="flash ${opts.flash.kind}">${opts.flash.message}</div>` : ''}
            ${opts.body}
          </main>
        </body>
      </html>
    `.html
  )
}
