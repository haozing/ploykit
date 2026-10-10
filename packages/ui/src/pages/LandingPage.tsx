
import { Link } from 'react-router'

export interface Feature { icon: string; title: string; desc: string }
export interface Plan {
  name: string; price: string; period?: string; recommended?: boolean
  features: string[]; cta: string
}

export function LandingPage({ brand, tagline, description, features, plans, registerPath = '/register', loginPath = '/login' }: {
  brand: string
  tagline: string
  description: string
  features: Feature[]
  plans: Plan[]
  
  registerPath?: string
  
  loginPath?: string
}) {
  return (
    <div className="min-h-screen bg-card">
      <header className="border-b border-border">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <span className="text-xl font-bold text-foreground">{brand}</span>
          <div className="flex items-center gap-3">
            <Link to={loginPath} className="px-4 py-2 text-sm font-medium text-foreground rounded-lg hover:bg-muted">
              登录
            </Link>
            <Link to={registerPath} className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/80">
              免费注册
            </Link>
          </div>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-4 pt-20 pb-16 text-center">
        <h1 className="text-5xl font-bold text-foreground tracking-tight">{tagline}</h1>
        <p className="mt-4 text-xl text-muted-foreground max-w-2xl mx-auto">{description}</p>
        <Link to={registerPath} className="mt-8 inline-block px-6 py-3 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/80 text-lg">
          免费开始
        </Link>
      </section>

      <section className="bg-muted py-16">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-center text-foreground mb-12">核心功能</h2>
          <div className="grid md:grid-cols-3 gap-8">
            {features.map((f, i) => (
              <div key={`${i}-${f.title}`} className="p-6 bg-card rounded-xl border border-border">
                <div className="text-3xl mb-3">{f.icon}</div>
                <h3 className="text-lg font-semibold text-foreground">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-center text-foreground mb-12">定价</h2>
          <div className="grid md:grid-cols-2 gap-8 max-w-3xl mx-auto">
            {plans.map((p, i) => (
              <div key={`${i}-${p.name}`} className={`p-8 bg-card rounded-xl ${p.recommended ? 'border-2 border-primary relative' : 'border border-border'}`}>
                {p.recommended && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-primary text-primary-foreground text-xs font-medium rounded-full">推荐</span>
                )}
                <h3 className="text-lg font-semibold text-foreground">{p.name}</h3>
                <p className="mt-1 text-3xl font-bold text-foreground">{p.price}<span className="text-sm text-muted-foreground">{p.period ?? '/月'}</span></p>
                <ul className="mt-6 space-y-3 text-sm text-muted-foreground">
                  {p.features.map((f, j) => <li key={`${j}-${f}`}>✓ {f}</li>)}
                </ul>
                <Link to={registerPath} className={`mt-6 block text-center py-2.5 rounded-lg font-medium ${p.recommended ? 'bg-primary text-primary-foreground hover:bg-primary/80' : 'border border-input text-foreground hover:bg-muted'}`}>
                  {p.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        © 2026 {brand}. All rights reserved.
      </footer>
    </div>
  )
}
