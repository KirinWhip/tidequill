import { useState } from 'react'
import { Check, Loader2, XCircle } from 'lucide-react'
import type { Settings } from '../../shared/types'
import { useT } from '../i18n'
import { listModels } from '../../shared/providers'
import { ProviderError } from '../../shared/errors'
import { bridgeFetch } from '../api'

/** first-run: pick provider, enter key, test connection */
export function Onboarding({ settings, onDone }: { settings: Settings; onDone(s: Settings): void }) {
  const t = useT()
  const [pid, setPid] = useState(settings.providers[0]?.id)
  const prov = settings.providers.find(p => p.id === pid)!
  const [key, setKey] = useState('')
  const [url, setUrl] = useState(prov?.baseURL || '')
  const [state, setState] = useState<{ k: '' | 'busy' | 'ok' | 'err'; text?: string; models?: string[] }>({ k: '' })
  const pick = (id: string) => { setPid(id); const p = settings.providers.find(x => x.id === id)!; setUrl(p.baseURL); setState({ k: '' }) }
  const cfg = () => ({ ...prov, apiKey: key, baseURL: url })
  const test = async () => {
    setState({ k: 'busy' })
    try { const models = await listModels(cfg(), bridgeFetch); setState({ k: 'ok', models, text: t.onbOk + models.length }) }
    catch (e: any) { setState({ k: 'err', text: e instanceof ProviderError ? ((t as any)['err_' + e.code] || t.err_unknown) : t.err_unknown }) }
  }
  const finish = () => {
    const models = state.models?.length ? state.models : prov.models
    onDone({ ...settings, providers: settings.providers.map(p => p.id === pid ? { ...cfg(), models } : p), defaultProviderId: pid, defaultModel: models.includes(settings.defaultModel) ? settings.defaultModel : models[0] || settings.defaultModel })
  }
  return (
    <div className="overlay onboarding">
      <div className="modal narrow" role="dialog" aria-label={t.onbTitle}>
        <div className="panel">
          <div className="onb-head"><img src="./logo.png" alt="" width={56} height={56} /><h2>{t.onbTitle}</h2><p className="meta">{t.onbSubtitle}</p></div>
          <div className="form">
            <div className="meta">{t.onbPick}</div>
            <div className="provgrid">{settings.providers.map(p => <button key={p.id} className={'provcard' + (p.id === pid ? ' on' : '')} onClick={() => pick(p.id)}>{p.name}</button>)}</div>
            {prov.type !== 'ollama' && <label>{t.apiKey}<input type="password" data-testid="onb-key" value={key} onChange={e => setKey(e.target.value)} /></label>}
            <label>{t.baseURL}<input data-testid="onb-url" value={url} onChange={e => setUrl(e.target.value)} /></label>
            <div className="row">
              <button className="btn" data-testid="onb-test" onClick={test} disabled={state.k === 'busy'}>{state.k === 'busy' ? <Loader2 size={14} className="spin" /> : null}{state.k === 'busy' ? t.onbTesting : t.onbTest}</button>
              {state.k === 'ok' && <span className="okmsg" data-testid="onb-result"><Check size={14} />{state.text}</span>}
              {state.k === 'err' && <span className="errmsg" data-testid="onb-result"><XCircle size={14} />{state.text}</span>}
            </div>
            <div className="row end">
              <button className="btn" onClick={() => onDone(settings)}>{t.onbSkip}</button>
              <button className="btn primary" data-testid="onb-start" disabled={prov.type !== 'ollama' && !key} onClick={finish}>{t.onbStart}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
