import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, ArrowRight, BookOpen, ExternalLink, Info, Search, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { helpArticles, helpGroups, searchHelp, type HelpArticle, type HelpBlock } from "@/lib/help-docs"

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

function Block({ block }: { block: HelpBlock }) {
  if (block.kind === "p") return <p className="leading-7 text-foreground/90">{block.text}</p>
  if (block.kind === "note") return <p className="flex gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm leading-6"><Info className="mt-0.5 size-4 shrink-0 text-primary" /><span>{block.text}</span></p>
  if (block.kind === "steps") return <ol className="space-y-2">{block.items.map((item, index) => <li key={item} className="flex gap-3 leading-7"><span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums">{index + 1}</span><span>{item}</span></li>)}</ol>
  if (block.kind === "list") return <ul className="list-disc space-y-1.5 pl-5 leading-7 marker:text-muted-foreground">{block.items.map((item) => <li key={item}>{item}</li>)}</ul>
  return <div className="overflow-x-auto rounded-lg border"><Table><TableHeader><TableRow>{block.head.map((cell) => <TableHead key={cell}>{cell}</TableHead>)}</TableRow></TableHeader><TableBody>{block.rows.map((row) => <TableRow key={row.join("|")}>{row.map((cell, index) => <TableCell key={`${index}-${cell}`} className={`whitespace-normal align-top ${index === 0 ? "font-medium" : ""}`}>{cell}</TableCell>)}</TableRow>)}</TableBody></Table></div>
}

function Sidebar({ current, onPick }: { current?: string; onPick?: () => void }) {
  return <nav aria-label="Help topics" className="space-y-5 text-sm">
    {helpGroups.map((group) => <div key={group}>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</p>
      <ul className="space-y-0.5 border-l">{helpArticles.filter((article) => article.group === group).map((article) => <li key={article.id}>
        <Link to={`/help/${article.id}`} onClick={onPick} aria-current={article.id === current ? "page" : undefined} className={`-ml-px block border-l-2 py-1 pl-3 pr-2 transition-colors ${article.id === current ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground"}`}>{article.title}</Link>
      </li>)}</ul>
    </div>)}
  </nav>
}

function ArticleView({ article }: { article: HelpArticle }) {
  const index = helpArticles.findIndex((item) => item.id === article.id)
  const previous = helpArticles[index - 1]
  const next = helpArticles[index + 1]
  const headings = article.sections.filter((section) => section.heading).map((section) => section.heading as string)
  return <div className="flex gap-10">
    <article className="min-w-0 flex-1 space-y-6">
      <header className="space-y-2 border-b pb-5">
        <p className="text-sm font-medium text-primary">{article.group}</p>
        <h1 className="text-3xl font-semibold tracking-tight">{article.title}</h1>
        <p className="text-lg text-muted-foreground">{article.summary}</p>
        {article.path ? <Button asChild variant="outline" size="sm" className="mt-2"><Link to={article.path}>{article.pathLabel || "Open page"}<ExternalLink /></Link></Button> : null}
      </header>
      {article.sections.map((section, sectionIndex) => <section key={section.heading || sectionIndex} id={section.heading ? slug(section.heading) : undefined} className="scroll-mt-24 space-y-3">
        {section.heading ? <h2 className="text-xl font-semibold">{section.heading}</h2> : null}
        {section.blocks.map((block, blockIndex) => <Block key={blockIndex} block={block} />)}
      </section>)}
      <footer className="grid gap-3 border-t pt-6 sm:grid-cols-2">
        {previous ? <Link to={`/help/${previous.id}`} className="rounded-lg border p-4 transition-colors hover:bg-muted/50"><span className="flex items-center gap-1 text-xs text-muted-foreground"><ArrowLeft className="size-3" />Previous</span><span className="mt-1 block font-medium">{previous.title}</span></Link> : <span />}
        {next ? <Link to={`/help/${next.id}`} className="rounded-lg border p-4 text-right transition-colors hover:bg-muted/50"><span className="flex items-center justify-end gap-1 text-xs text-muted-foreground">Next<ArrowRight className="size-3" /></span><span className="mt-1 block font-medium">{next.title}</span></Link> : null}
      </footer>
    </article>
    {headings.length > 1 ? <aside className="sticky top-24 hidden w-48 shrink-0 self-start xl:block"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">On this page</p><ul className="space-y-1.5 text-sm">{headings.map((heading) => <li key={heading}><a href={`#${slug(heading)}`} className="text-muted-foreground hover:text-foreground">{heading}</a></li>)}</ul></aside> : null}
  </div>
}

function Home() {
  return <div className="space-y-8">
    <div className="space-y-2"><h1 className="text-3xl font-semibold tracking-tight">How can we help?</h1><p className="text-muted-foreground">Search above, or browse a topic.</p></div>
    <div className="grid gap-4 sm:grid-cols-2">{helpGroups.map((group) => <section key={group} className="rounded-xl border p-5">
      <h2 className="font-semibold">{group}</h2>
      <ul className="mt-3 space-y-2 text-sm">{helpArticles.filter((article) => article.group === group).map((article) => <li key={article.id}><Link to={`/help/${article.id}`} className="group block"><span className="font-medium group-hover:text-primary group-hover:underline">{article.title}</span><span className="block text-muted-foreground">{article.summary}</span></Link></li>)}</ul>
    </section>)}</div>
  </div>
}

export function HelpPage() {
  const { articleId } = useParams()
  const navigate = useNavigate()
  const [query, setQuery] = useState("")
  const [menuOpen, setMenuOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const article = helpArticles.find((item) => item.id === articleId)
  const results = useMemo(() => searchHelp(query), [query])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName || "") && !target?.isContentEditable) { event.preventDefault(); searchRef.current?.focus() }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  useEffect(() => { window.scrollTo({ top: 0 }) }, [articleId])
  useEffect(() => { if (articleId && !article) navigate("/help", { replace: true }) }, [articleId, article, navigate])

  const open = (id: string) => { setQuery(""); navigate(`/help/${id}`) }

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center gap-3">
      <Link to="/help" className="flex items-center gap-2 font-semibold"><BookOpen className="size-5 text-primary" />Help & guides</Link>
      <div className="relative ml-auto w-full sm:w-96">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && results[0]) open(results[0].article.id); if (event.key === "Escape") setQuery("") }} placeholder="Search help, e.g. bulk upload, leave, Tally" aria-label="Search help" className="h-10 pl-9 pr-16" />
        {query ? <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"><X className="size-4" /></button> : <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border bg-muted px-1.5 text-xs text-muted-foreground sm:block">/</kbd>}
      </div>
      <Button variant="outline" size="sm" className="lg:hidden" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>Topics</Button>
    </div>
    {menuOpen ? <div className="rounded-xl border p-4 lg:hidden"><Sidebar current={article?.id} onPick={() => setMenuOpen(false)} /></div> : null}

    <div className="flex gap-10">
      <aside className="sticky top-24 hidden max-h-[calc(100vh-7rem)] w-56 shrink-0 self-start overflow-y-auto pb-6 lg:block"><Sidebar current={article?.id} /></aside>
      <main className="min-w-0 flex-1 pb-10">
        {query.trim() ? <section aria-live="polite" className="space-y-3">
          <p className="text-sm text-muted-foreground">{results.length ? `${results.length} result${results.length === 1 ? "" : "s"} for “${query.trim()}”` : `No results for “${query.trim()}”. Try a simpler word, such as invoice, payslip or GST.`}</p>
          <ul className="space-y-2">{results.map(({ article: match, snippet }) => <li key={match.id}><button type="button" onClick={() => open(match.id)} className="w-full rounded-lg border p-4 text-left transition-colors hover:bg-muted/50"><span className="text-xs text-muted-foreground">{match.group}</span><span className="block font-medium">{match.title}</span><span className="mt-1 block text-sm text-muted-foreground">{snippet}</span></button></li>)}</ul>
        </section> : article ? <ArticleView article={article} /> : <Home />}
      </main>
    </div>
  </div>
}
