// UI Kit — visual catalog of every reusable element in Headroom.
// Imports the same component sources as the app so the kit can never drift.

function Section({ id, title, subtitle, children }) {
  return (
    <section id={id} className="scroll-mt-24">
      <header className="mb-6 flex items-center gap-3">
        <span className="inline-block w-1.5 h-7 rounded-full bg-violet-600" />
        <div>
          <h2 className="text-[22px] font-bold text-slate-900 tracking-tight leading-none">{title}</h2>
          {subtitle ? <p className="text-[13px] text-slate-500 mt-1.5">{subtitle}</p> : null}
        </div>
      </header>
      <div className="space-y-8">{children}</div>
    </section>
  );
}

function Spec({ title, note, children }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-[14px] font-semibold text-slate-900">{title}</h3>
        {note ? <span className="text-[12px] text-slate-400">{note}</span> : null}
      </div>
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        {children}
      </div>
    </div>
  );
}

function Code({ children }) {
  return (
    <code className="num text-[11.5px] text-violet-700 bg-violet-50 border border-violet-100 px-1.5 py-0.5 rounded">
      {children}
    </code>
  );
}

function CodeBlock({ children }) {
  return (
    <pre className="num text-[11.5px] text-slate-700 bg-slate-50 border border-slate-100 rounded-lg p-3 overflow-x-auto leading-relaxed whitespace-pre">
{children}
    </pre>
  );
}

// — Foundations -----------------------------------------------------------------

function Swatch({ name, hex, token, dark, role }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="h-16 rounded-lg border border-slate-200" style={{ background: hex }} />
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] font-medium text-slate-900">{name}</span>
        <span className="num text-[11px] text-slate-500">{hex}</span>
      </div>
      {token ? <span className="num text-[10.5px] text-slate-400">{token}</span> : null}
      {role ? <span className="text-[11px] text-slate-500 leading-snug">{role}</span> : null}
    </div>
  );
}

function ColorsSection() {
  return (
    <Section id="colors" title="Colour" subtitle="Purple is the brand. Status colours are reserved for regulatory meaning — never decoration.">
      <Spec title="Primary — Violet" note="Use sparingly. White space is the dominant surface.">
        <div className="grid grid-cols-6 gap-4">
          <Swatch name="violet-50"  hex="#f5f3ff" token="bg-violet-50" role="Hover tints, soft fills" />
          <Swatch name="violet-100" hex="#ede9fe" token="bg-violet-100" />
          <Swatch name="violet-200" hex="#ddd6fe" token="bg-violet-200" />
          <Swatch name="violet-600" hex="#7c3aed" token="bg-violet-600" role="Primary actions, accent bars" />
          <Swatch name="violet-700" hex="#6d28d9" token="text-violet-700" role="Headings, active nav" />
          <Swatch name="purple-800" hex="#5b21b6" token="text-purple-800" />
        </div>
      </Spec>

      <Spec title="Compliance status" note="Semantic — do not repurpose.">
        <div className="grid grid-cols-3 gap-4">
          <Swatch name="Green — compliant" hex="#16a34a" token="green-600" role="Within Green Threshold" />
          <Swatch name="Amber — levy risk" hex="#f59e0b" token="amber-500" role="Between Green & Red Thresholds" />
          <Swatch name="Red — points risk" hex="#dc2626" token="red-600" role="Above Red Threshold" />
        </div>
      </Spec>

      <Spec title="Neutrals" note="Slate scale only. No warm greys.">
        <div className="grid grid-cols-6 gap-4">
          <Swatch name="white"     hex="#ffffff" token="bg-white" role="Page surface" />
          <Swatch name="slate-50"  hex="#f8fafc" token="bg-slate-50" role="Subtle fills" />
          <Swatch name="slate-100" hex="#f1f5f9" token="border-slate-100" />
          <Swatch name="slate-200" hex="#e2e8f0" token="border-slate-200" role="Default card border" />
          <Swatch name="slate-400" hex="#94a3b8" token="text-slate-400" role="Meta labels, placeholders" />
          <Swatch name="slate-500" hex="#64748b" token="text-slate-500" role="Secondary text" />
          <Swatch name="slate-700" hex="#334155" token="text-slate-700" role="Body emphasis" />
          <Swatch name="slate-900" hex="#0f172a" token="text-slate-900" role="Primary text, headings" />
        </div>
      </Spec>
    </Section>
  );
}

// — Typography ------------------------------------------------------------------

function TypeRow({ label, sample, cls, usage }) {
  return (
    <div className="grid items-baseline py-4 border-b border-slate-100 last:border-0" style={{ gridTemplateColumns: '140px 1fr 200px' }}>
      <div className="meta-label">{label}</div>
      <div className={cls}>{sample}</div>
      <div className="text-[11.5px] text-slate-500 text-right">{usage}</div>
    </div>
  );
}

function TypographySection() {
  return (
    <Section id="type" title="Typography" subtitle="Inter for UI. JetBrains Mono for every financial figure, %, and date — no exceptions.">
      <Spec title="Inter — interface text">
        <TypeRow label="Display"     cls="text-[28px] font-bold text-slate-900 tracking-tight" sample="Compliance Simulator" usage="Page heading sub" />
        <TypeRow label="H1"          cls="text-[24px] font-bold text-slate-900 tracking-tight" sample="Simulation History"   usage="Page titles" />
        <TypeRow label="H2"          cls="text-[18px] font-semibold text-slate-900 tracking-tight" sample="New Transfer Simulation" usage="Form / card section heads" />
        <TypeRow label="H3"          cls="text-[15px] font-semibold text-slate-900" sample="Transfer Cost Breakdown" usage="In-card subsections" />
        <TypeRow label="Body"        cls="text-[14px] text-slate-700" sample="Enter the proposed transfer terms and run a check." usage="Default copy" />
        <TypeRow label="Body small"  cls="text-[13px] text-slate-500" sample="Results compute against your current squad position." usage="Subheads, helper" />
        <TypeRow label="Caption"     cls="text-[12px] text-slate-400" sample="Spread across contract years in SCR calculation" usage="Inline helper, hints" />
        <TypeRow label="Meta label"  cls="meta-label" sample="CURRENT SCR" usage="Uppercase metadata, 11px / 0.06em" />
      </Spec>

      <Spec title="JetBrains Mono — figures only" note="Tabular nums, nowrap by default">
        <TypeRow label="Stat huge"   cls="num text-[36px] font-semibold text-slate-900" sample="87.3%"        usage="After-transfer SCR" />
        <TypeRow label="Stat large"  cls="num text-[28px] font-semibold text-slate-900" sample="£14,820,000" usage="Threshold values" />
        <TypeRow label="Stat medium" cls="num text-[20px] font-medium text-slate-900"   sample="£2,000,000"  usage="Cost breakdown" />
        <TypeRow label="Stat row"    cls="num text-[14px] text-slate-900"               sample="+£480,000"   usage="Tables, comparison rows" />
        <TypeRow label="Inline"      cls="num text-[12px] text-slate-500"               sample="2026-27"     usage="Seasons, timestamps" />
      </Spec>

      <Spec title="Rules">
        <ul className="text-[13px] text-slate-700 space-y-2 list-none">
          <li className="flex gap-2"><span className="text-violet-600">→</span> Numbers always use <Code>.num</Code>. Inter for figures is forbidden.</li>
          <li className="flex gap-2"><span className="text-violet-600">→</span> Negative currency renders as <span className="num">−£220,000</span>, signed positives as <span className="num">+£480,000</span>.</li>
          <li className="flex gap-2"><span className="text-violet-600">→</span> Meta labels are always uppercase, slate-400, 11px, letter-spacing 0.06em.</li>
        </ul>
      </Spec>
    </Section>
  );
}

// — Spacing & Radius ------------------------------------------------------------

function SpacingSection() {
  const scale = [
    { token: '1', px: 4 }, { token: '2', px: 8 }, { token: '3', px: 12 },
    { token: '4', px: 16 }, { token: '5', px: 20 }, { token: '6', px: 24 },
    { token: '7', px: 28 }, { token: '8', px: 32 },
  ];
  const radii = [
    { name: 'rounded-md',  px: 6,  use: 'Inputs (compact)' },
    { name: 'rounded-lg',  px: 8,  use: 'Buttons, inputs' },
    { name: 'rounded-xl',  px: 12, use: 'Cards, banners, callouts' },
    { name: 'rounded-full',px: 999,use: 'Pills, avatars, dots' },
  ];
  return (
    <Section id="spacing" title="Spacing &amp; Radii" subtitle="8-point grid. Cards always have ≥24px internal padding.">
      <Spec title="Spacing scale">
        <div className="space-y-2.5">
          {scale.map((s) => (
            <div key={s.token} className="flex items-center gap-4">
              <span className="num text-[12px] text-slate-500 w-12">{s.px}px</span>
              <span className="num text-[11px] text-slate-400 w-16">space-{s.token}</span>
              <span className="inline-block h-3 bg-violet-600/80 rounded-sm" style={{ width: s.px * 2 }} />
            </div>
          ))}
        </div>
      </Spec>
      <Spec title="Radii">
        <div className="grid grid-cols-4 gap-4">
          {radii.map((r) => (
            <div key={r.name} className="flex flex-col gap-2">
              <div className="h-16 bg-violet-100 border border-violet-200" style={{ borderRadius: r.px }} />
              <span className="text-[12px] font-medium text-slate-900">{r.name}</span>
              <span className="text-[11px] text-slate-500">{r.use}</span>
            </div>
          ))}
        </div>
      </Spec>
      <Spec title="Elevation">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="h-16 bg-white border border-slate-200 rounded-xl shadow-sm" />
            <div className="mt-2 text-[12px] font-medium text-slate-900">shadow-sm</div>
            <div className="text-[11px] text-slate-500">Default for all cards. Never go heavier.</div>
          </div>
          <div>
            <div className="h-16 bg-white border border-slate-200 rounded-xl" />
            <div className="mt-2 text-[12px] font-medium text-slate-900">No shadow</div>
            <div className="text-[11px] text-slate-500">Inline panels, settings preview, sub-cards</div>
          </div>
        </div>
      </Spec>
    </Section>
  );
}

// — Buttons ---------------------------------------------------------------------

function ButtonsSection() {
  return (
    <Section id="buttons" title="Buttons" subtitle="Three variants. Primary for the single dominant action on a screen.">
      <Spec title="Variants">
        <div className="flex flex-wrap items-center gap-4">
          <Button>Run Compliance Check</Button>
          <Button variant="outline">Export as PDF</Button>
          <Button variant="ghost">Cancel</Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-x-8 gap-y-2 text-[11.5px] text-slate-500">
          <div><Code>variant="primary"</Code> — purple fill, white text</div>
          <div><Code>variant="outline"</Code> — purple border + text</div>
          <div><Code>variant="ghost"</Code> — slate text, hover bg</div>
        </div>
      </Spec>
      <Spec title="Sizing">
        <p className="text-[12.5px] text-slate-500 mb-4">All buttons share one size token: <Code>px-4 py-2.5 text-sm</Code>. No multiple sizes — keep the hit target consistent.</p>
        <div className="flex gap-4">
          <Button className="w-72">Full-width form submit</Button>
          <Button variant="outline">Inline action</Button>
        </div>
      </Spec>
    </Section>
  );
}

// — Form controls ---------------------------------------------------------------

function FormSection() {
  const [text, setText] = React.useState('Striker option A — January window');
  const [fee, setFee] = React.useState(8000000);
  const [years, setYears] = React.useState(4);
  const [feeErr, setFeeErr] = React.useState(0);
  const [tog, setTog] = React.useState(true);
  return (
    <Section id="form" title="Form controls" subtitle="All inputs share the same border, padding, and focus ring (violet-500 / 2px).">
      <Spec title="Inputs">
        <div className="grid grid-cols-2 gap-5">
          <Field label="Transfer Fee" helper="Enter 0 for a free transfer">
            <CurrencyInput value={fee} onChange={setFee} />
          </Field>
          <Field label="Contract Length" helper="0.5 increments accepted">
            <SuffixNumberInput value={years} onChange={setYears} suffix="years" step={0.5} min={0.5} max={5} />
          </Field>
          <Field label="Scenario Label">
            <TextInput value={text} onChange={setText} placeholder="Optional name" />
          </Field>
          <Field label="Validation error" error="Enter an amount of at least £0.">
            <CurrencyInput value={feeErr} onChange={setFeeErr} error />
          </Field>
        </div>
      </Spec>

      <Spec title="Toggle">
        <div className="flex items-center justify-between px-4 py-3.5 rounded-lg bg-slate-50/80 border border-slate-100">
          <div>
            <div className="text-[13px] font-medium text-slate-900">Simultaneously selling a player?</div>
            <div className="text-[12px] text-slate-500 mt-0.5">Reveals offset-side inputs when on.</div>
          </div>
          <Toggle on={tog} onChange={setTog} />
        </div>
      </Spec>

      <Spec title="Field wrapper anatomy">
        <CodeBlock>{`<Field label="TRANSFER FEE" helper="Enter 0 for a free transfer" error={errors.fee}>
  <CurrencyInput value={fee} onChange={setFee} />
</Field>`}</CodeBlock>
        <ul className="mt-4 text-[12.5px] text-slate-700 space-y-1.5">
          <li><Code>label</Code> — uppercase meta label, mandatory</li>
          <li><Code>helper</Code> — slate-400 micro-copy below input</li>
          <li><Code>error</Code> — red-600 micro-copy, replaces helper, switches input border</li>
        </ul>
      </Spec>
    </Section>
  );
}

// — Badges & Status -------------------------------------------------------------

function BadgesSection() {
  return (
    <Section id="badges" title="Badges &amp; status" subtitle="One pill style across the app. Use full label in banners, short label in tight contexts.">
      <Spec title="Status pills" note="Full vs short label">
        <div className="flex flex-wrap gap-3">
          <StatusBadge status="green">{statusLabel('green')}</StatusBadge>
          <StatusBadge status="amber">{statusLabel('amber')}</StatusBadge>
          <StatusBadge status="red">{statusLabel('red')}</StatusBadge>
          <span className="w-px h-6 bg-slate-200" />
          <StatusBadge status="green">{statusShort('green')}</StatusBadge>
          <StatusBadge status="amber">{statusShort('amber')}</StatusBadge>
          <StatusBadge status="red">{statusShort('red')}</StatusBadge>
        </div>
        <p className="text-[12px] text-slate-500 mt-4">Use full labels in headlines and the top-bar pill. Use short labels in dense rows (comparison cards, history tables, settings preview).</p>
      </Spec>
      <Spec title="Neutral / event pills" note="Calendar event types & misc">
        <div className="flex flex-wrap gap-3">
          <StatusBadge status="slate">CHECKPOINT</StatusBadge>
          <StatusBadge status="purple">COMPLIANCE TEST</StatusBadge>
          <StatusBadge status="blue">TRANSFER WINDOW</StatusBadge>
          <StatusBadge status="amber">DEADLINE</StatusBadge>
        </div>
      </Spec>
      <Spec title="Top-bar SCR pill (compound)">
        <div className="flex items-center gap-3 px-3 py-1.5 rounded-full bg-violet-50 border border-violet-100 whitespace-nowrap w-fit">
          <span className="meta-label text-violet-700">Current SCR</span>
          <span className="num text-[13px] text-slate-900 font-medium">82.1%</span>
          <span className="w-px h-3.5 bg-violet-200" />
          <StatusBadge status="green">
            <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5" style={{ background: '#16a34a' }} />
            COMPLIANT
          </StatusBadge>
        </div>
      </Spec>
    </Section>
  );
}

// — Cards & section heads -------------------------------------------------------

function CardsSection() {
  return (
    <Section id="cards" title="Cards &amp; section headers" subtitle="Cards are the single container primitive. Section heads always carry a violet accent.">
      <Spec title="Card primitive">
        <Card className="p-6">
          <div className="text-[14px] text-slate-700">Default card · <Code>p-6</Code> · <Code>rounded-xl</Code> · <Code>border-slate-200</Code> · <Code>shadow-sm</Code></div>
        </Card>
        <p className="text-[12px] text-slate-500 mt-4">Always 24px internal padding. Use sub-cards (no shadow) for nested groupings.</p>
      </Spec>

      <Spec title="Section header with accent bar" note="Use inside every card">
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="inline-block w-1 h-5 rounded-full bg-violet-600" />
              <div>
                <h3 className="text-[15px] font-semibold text-slate-900 leading-tight">Transfer Cost Breakdown</h3>
                <p className="text-[12px] text-slate-500 mt-0.5">Annualised for SCR</p>
              </div>
            </div>
            <Button variant="outline">Action</Button>
          </div>
        </Card>
        <CodeBlock>{`<div className="flex items-center gap-3">
  <span className="inline-block w-1 h-5 rounded-full bg-violet-600" />
  <h3 className="text-[15px] font-semibold text-slate-900">Title</h3>
</div>`}</CodeBlock>
      </Spec>

      <Spec title="Page heading">
        <div className="flex items-center gap-3">
          <span className="inline-block w-1.5 h-7 rounded-full bg-violet-600" />
          <div>
            <h1 className="text-[24px] font-bold text-slate-900 tracking-tight leading-none">Simulator</h1>
            <p className="text-[13px] text-slate-500 mt-1.5">Test a proposed signing against the Squad Cost Ratio rule before you commit.</p>
          </div>
        </div>
      </Spec>

      <Spec title="Accent-top card" note="Reserved for the live-preview / Calculated Thresholds card">
        <div className="bg-white border border-slate-200 rounded-xl relative overflow-hidden p-6 w-80">
          <div className="absolute top-0 left-0 right-0 h-1 bg-violet-600" />
          <h3 className="text-[13px] font-semibold tracking-wider text-violet-700 uppercase mt-1" style={{ letterSpacing: '0.08em' }}>Calculated Thresholds</h3>
          <p className="text-[12px] text-slate-500 mt-1.5">Live preview as the user types.</p>
          <div className="mt-4 num text-[24px] font-semibold text-green-700">£15,300,000</div>
          <div className="text-[11px] text-slate-400 num">85% of revenue</div>
        </div>
      </Spec>
    </Section>
  );
}

// — Data display ----------------------------------------------------------------

function DataSection() {
  return (
    <Section id="data" title="Data display" subtitle="Stat blocks, tables, and empty states share the same vocabulary across screens.">
      <Spec title="Stat block">
        <div className="grid grid-cols-3 gap-5">
          <div className="flex flex-col">
            <span className="meta-label mb-1.5">Annual Amortisation</span>
            <span className="num text-[20px] text-slate-900 font-medium leading-none">£2,000,000</span>
            <span className="text-[12px] text-slate-400 mt-1.5">£8M ÷ 4 years</span>
          </div>
          <div className="flex flex-col">
            <span className="meta-label mb-1.5">Annual Wage Cost</span>
            <span className="num text-[20px] text-slate-900 font-medium leading-none">£1,456,000</span>
            <span className="text-[12px] text-slate-400 mt-1.5">£28,000 / week × 52</span>
          </div>
          <div className="flex flex-col">
            <span className="meta-label mb-1.5">Agent Fee (per year)</span>
            <span className="num text-[20px] text-slate-900 font-medium leading-none">£100,000</span>
            <span className="text-[12px] text-slate-400 mt-1.5">£400k ÷ 4 years</span>
          </div>
        </div>
      </Spec>

      <Spec title="Table rows" note="Borders bottom-only, hover violet-50/60">
        <Card className="overflow-hidden">
          <table className="w-full">
            <thead className="border-b border-slate-100">
              <tr>
                <th className="px-5 py-3 text-left meta-label font-medium">Season</th>
                <th className="px-5 py-3 text-right meta-label font-medium">Amortisation</th>
                <th className="px-5 py-3 text-right meta-label font-medium">Remaining Book Value</th>
              </tr>
            </thead>
            <tbody>
              {[
                { s: '2026-27', a: '£2,000,000', r: '£6,000,000', current: true },
                { s: '2027-28', a: '£2,000,000', r: '£4,000,000' },
                { s: '2028-29', a: '£2,000,000', r: '£2,000,000' },
                { s: '2029-30', a: '£2,000,000', r: '£0' },
              ].map((row) => (
                <tr key={row.s} className={`border-b border-slate-100 last:border-0 ${row.current ? 'bg-violet-50/60' : ''}`}>
                  <td className={`num px-5 py-3 ${row.current ? 'text-violet-700 font-medium' : 'text-slate-600'}`}>
                    {row.s}{row.current ? <span className="ml-2 text-[10px] uppercase tracking-wider text-violet-600">Current</span> : null}
                  </td>
                  <td className={`num px-5 py-3 text-right ${row.current ? 'text-violet-700 font-medium' : 'text-slate-900'}`}>{row.a}</td>
                  <td className={`num px-5 py-3 text-right ${row.current ? 'text-violet-700' : 'text-slate-500'}`}>{row.r}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </Spec>

      <Spec title="Empty state">
        <EmptyResults />
      </Spec>
    </Section>
  );
}

// — Result Compositions ---------------------------------------------------------

function CompositionsSection() {
  // Build three mock simulations for the banner showcase
  const club = DEFAULT_CLUB;
  const green = simulate({ fee: 4_000_000, years: 4, weeklyWage: 18_000, agentFee: 200_000 }, club);
  const amber = simulate({ fee: 9_000_000, years: 4, weeklyWage: 32_000, agentFee: 500_000 }, club);
  const red   = simulate({ fee: 18_000_000, years: 5, weeklyWage: 55_000, agentFee: 1_200_000 }, club);

  return (
    <Section id="compositions" title="Result compositions" subtitle="Higher-order patterns built from the primitives. Use them whole — don't re-invent.">
      <Spec title="Status banner — all three states">
        <div className="space-y-3">
          <StatusBanner result={green} />
          <StatusBanner result={amber} />
          <StatusBanner result={red} />
        </div>
      </Spec>

      <Spec title="Before / After comparison cards">
        <ComparisonCards result={amber} />
        <p className="text-[12px] text-slate-500 mt-4">Before card uses subdued styling. After card picks up the projected status colour for border + headline number.</p>
      </Spec>

      <Spec title="Compliance gauge">
        <ComplianceGauge result={amber} />
      </Spec>

      <Spec title="Sanctions callouts" note="Conditional — only render when status ≠ green">
        <div className="space-y-3">
          <SanctionsPanel result={amber} />
          <SanctionsPanel result={red} />
        </div>
      </Spec>
    </Section>
  );
}

// — Layout pieces ---------------------------------------------------------------

function LayoutSection() {
  return (
    <Section id="layout" title="Layout pieces" subtitle="Frame chrome — wordmark, nav item, workspace block, top bar.">
      <Spec title="Wordmark">
        <div className="flex items-center gap-8">
          <Wordmark size={20} />
          <Wordmark size={28} />
          <Wordmark size={36} />
        </div>
        <p className="text-[12px] text-slate-500 mt-4">A custom <Code>H</Code> glyph + Inter 700. Never substituted with an icon set. Default colour <Code>#6d28d9</Code>.</p>
      </Spec>

      <Spec title="Sidebar nav item">
        <div className="w-64 bg-white border border-slate-200 rounded-xl py-2">
          <NavItemPreview label="Simulator" icon={Icons.Simulator} active />
          <NavItemPreview label="History" icon={Icons.History} />
          <NavItemPreview label="Calendar" icon={Icons.Calendar} />
          <NavItemPreview label="Settings" icon={Icons.Settings} />
        </div>
      </Spec>

      <Spec title="Workspace block">
        <div className="w-64 bg-white border border-slate-200 rounded-xl p-5">
          <div className="meta-label mb-2">Workspace</div>
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-violet-600 text-white text-[11px] font-semibold">SW</span>
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-slate-900 truncate">Sheffield Wednesday</div>
              <div className="text-[11px] text-slate-400">EFL Championship</div>
            </div>
          </div>
        </div>
      </Spec>

      <Spec title="Avatars">
        <div className="flex items-center gap-4">
          <Avatar initials="JM" size={24} />
          <Avatar initials="JM" size={28} />
          <Avatar initials="JM" size={32} />
          <Avatar initials="OK" size={36} />
        </div>
      </Spec>

      <Spec title="Calendar event card (timeline row)">
        <div className="flex items-start gap-0">
          <div className="w-[120px] flex-shrink-0 pt-5">
            <div className="num text-[13px] text-slate-500">01 Mar 2027</div>
          </div>
          <div className="relative flex-shrink-0" style={{ width: 28 }}>
            <div className="absolute left-1/2 top-7 -translate-x-1/2 w-3 h-3 rounded-full border-[2.5px] border-violet-600 bg-white" />
          </div>
          <Card className="flex-1 p-5 border-l-4 border-l-violet-600">
            <div className="flex items-center gap-2 mb-2">
              <StatusBadge status="purple">COMPLIANCE TEST</StatusBadge>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wider whitespace-nowrap bg-violet-600 text-white">KEY DATE</span>
            </div>
            <h3 className="text-[15px] font-semibold text-slate-900">Main SCR Compliance Test</h3>
            <p className="text-[13px] text-slate-500 mt-1.5 leading-relaxed">Primary regulatory checkpoint. Clubs must demonstrate squad costs are within the calculated threshold.</p>
          </Card>
        </div>
      </Spec>
    </Section>
  );
}

function NavItemPreview({ icon, label, active }) {
  return (
    <div className={`group relative w-full flex items-center gap-3 pl-5 pr-4 py-2.5 text-sm font-medium ${active ? 'text-violet-700' : 'text-slate-500'}`}>
      {active ? <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-violet-600" /> : null}
      <span className={active ? 'text-violet-600' : 'text-slate-400'}>{icon}</span>
      <span>{label}</span>
    </div>
  );
}

// — Sidebar TOC -----------------------------------------------------------------

const TOC = [
  { id: 'colors',       label: 'Colour' },
  { id: 'type',         label: 'Typography' },
  { id: 'spacing',      label: 'Spacing & Radii' },
  { id: 'buttons',      label: 'Buttons' },
  { id: 'form',         label: 'Form controls' },
  { id: 'badges',       label: 'Badges & status' },
  { id: 'cards',        label: 'Cards & sections' },
  { id: 'data',         label: 'Data display' },
  { id: 'compositions', label: 'Result compositions' },
  { id: 'layout',       label: 'Layout pieces' },
  { id: 'principles',   label: 'Principles' },
];

function TableOfContents() {
  const [active, setActive] = React.useState('colors');
  React.useEffect(() => {
    const onScroll = () => {
      for (let i = TOC.length - 1; i >= 0; i--) {
        const el = document.getElementById(TOC[i].id);
        if (!el) continue;
        if (el.getBoundingClientRect().top < 140) { setActive(TOC[i].id); return; }
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <nav className="space-y-0.5">
      {TOC.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          className={`relative block pl-4 pr-3 py-2 text-[13px] rounded-md transition-colors
            ${active === item.id ? 'text-violet-700 font-medium' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'}`}
        >
          {active === item.id ? <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-violet-600" /> : null}
          {item.label}
        </a>
      ))}
    </nav>
  );
}

// — Principles ------------------------------------------------------------------

function PrinciplesSection() {
  const dos = [
    'Use Inter for UI, JetBrains Mono for every figure.',
    'Use violet for actions and identity. Use status colours for compliance meaning.',
    'Pad cards to 24px minimum. Use the 8-pt grid.',
    'Use the full status label in banners and the top bar; the short label in dense rows.',
    'Stick to one purple element per visual hierarchy level.',
    'Add whitespace-nowrap to any .num or meta-label that could collide.',
  ];
  const donts = [
    'No gradients. No dark surfaces. No drop shadows heavier than shadow-sm.',
    'No emoji, no football imagery, no decorative SVGs.',
    'Never use Inter for financial figures.',
    'No donut or pie charts for the compliance position — horizontal scale only.',
    'No toast notifications for form errors — inline only.',
    'No mobile layout. Minimum viewport 1024px.',
  ];
  return (
    <Section id="principles" title="Principles" subtitle="Decision shortcuts when extending the system.">
      <div className="grid grid-cols-2 gap-4">
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-green-100 text-green-700 text-[14px] font-bold">✓</span>
            <h3 className="text-[14px] font-semibold text-slate-900">Do</h3>
          </div>
          <ul className="space-y-2.5 text-[13px] text-slate-700 leading-relaxed">
            {dos.map((d, i) => <li key={i} className="flex gap-2"><span className="text-green-600 mt-0.5 flex-shrink-0">→</span><span>{d}</span></li>)}
          </ul>
        </Card>
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-red-100 text-red-700 text-[14px] font-bold">×</span>
            <h3 className="text-[14px] font-semibold text-slate-900">Don't</h3>
          </div>
          <ul className="space-y-2.5 text-[13px] text-slate-700 leading-relaxed">
            {donts.map((d, i) => <li key={i} className="flex gap-2"><span className="text-red-500 mt-0.5 flex-shrink-0">→</span><span>{d}</span></li>)}
          </ul>
        </Card>
      </div>
    </Section>
  );
}

// — Page ------------------------------------------------------------------------

function UIKitPage() {
  return (
    <div className="min-h-screen bg-slate-50/40 text-slate-900">
      {/* Top bar — minimal, identifies the kit */}
      <header className="h-16 sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200 flex items-center px-8">
        <div className="flex items-center gap-4">
          <Wordmark size={20} />
          <span className="w-px h-5 bg-slate-200" />
          <span className="text-[13px] text-slate-700 font-medium">Design System</span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-4">
          <span className="num text-[11px] text-slate-400">v0.4.2 · 2026/27</span>
          <a href="Headroom.html" className="text-[12px] text-violet-600 hover:text-violet-700 font-medium inline-flex items-center gap-1.5">
            Open prototype
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 17 L17 7" /><path d="M8 7h9v9" />
            </svg>
          </a>
        </div>
      </header>

      <div className="max-w-[1280px] mx-auto px-8 py-10 grid gap-10" style={{ gridTemplateColumns: '220px 1fr' }}>
        <aside className="self-start sticky top-24">
          <div className="meta-label mb-3">Contents</div>
          <TableOfContents />
        </aside>

        <main className="min-w-0">
          {/* Hero */}
          <div className="mb-12">
            <div className="flex items-center gap-3 mb-4">
              <span className="inline-block w-1.5 h-9 rounded-full bg-violet-600" />
              <div>
                <span className="meta-label text-violet-700">Headroom Design System</span>
                <h1 className="text-[34px] font-bold text-slate-900 tracking-tight leading-none mt-2">UI Kit</h1>
              </div>
            </div>
            <p className="text-[14px] text-slate-600 max-w-2xl leading-relaxed">
              Every component, token, and pattern used across Headroom. Built for B2B financial software — clean, precise, never decorative. Reuse these primitives when extending the product so the visual system stays coherent.
            </p>
          </div>

          <div className="space-y-16">
            <ColorsSection />
            <TypographySection />
            <SpacingSection />
            <ButtonsSection />
            <FormSection />
            <BadgesSection />
            <CardsSection />
            <DataSection />
            <CompositionsSection />
            <LayoutSection />
            <PrinciplesSection />
          </div>

          <footer className="mt-20 pt-8 border-t border-slate-100 flex items-center justify-between">
            <p className="text-[11px] text-slate-400">Headroom Design System · Maintained alongside the application.</p>
            <p className="text-[11px] text-slate-400 num">v0.4.2</p>
          </footer>
        </main>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<UIKitPage />);
